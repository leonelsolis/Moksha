"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte } from "drizzle-orm";

import { client, db } from "@/db";
import { appointments, professionals, services } from "@/db/schema";
import type {
  BookingState,
  CancelState,
  LookupResult,
  LookupState,
} from "@/lib/action-state";
import { isSlotBookable } from "@/lib/availability";
import { formatDateLong, formatMinute, minutesUntil, nowInTz } from "@/lib/dates";
import { sendBookingConfirmation, sendCancellationConfirmation } from "@/lib/email";
import {
  notifyProfessionalCancellation,
  notifyProfessionalNewBooking,
} from "@/lib/notify";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { getSettings, settingBool, settingInt } from "@/lib/settings";
import { siteOrigin } from "@/lib/site-url";
import { generateCancelToken, hashToken, looksLikeToken } from "@/lib/tokens";
import {
  normalizeDni,
  normalizeEmail,
  readCustomer,
  validateCustomer,
  type FieldErrors,
} from "@/lib/validation";

function fail(message: string, errors: FieldErrors = {}): BookingState {
  return { ok: false, message, errors };
}

/**
 * Confirma un turno.
 *
 * El punto delicado es que dos personas pueden confirmar el mismo horario en
 * el mismo instante. Se resuelve en dos capas:
 *
 *   1. La inserción es un único `INSERT … SELECT … WHERE NOT EXISTS`: la
 *      comprobación de choques y el alta viajan en la misma sentencia, y
 *      SQLite ejecuta cada sentencia de forma atómica. No hay ventana entre
 *      "miré si estaba libre" y "lo guardé", que es donde se cuelan las
 *      reservas dobles. Esto cubre el solapamiento entre servicios de distinta
 *      duración (uno de 60' a las 10:00 contra uno de 30' a las 10:30).
 *
 *      Se escribe a mano en vez de usar el constructor de consultas porque
 *      esa forma condicional no se puede expresar con él.
 *
 *   2. El índice único parcial de la tabla es la red de seguridad: aunque un
 *      error de código saltee lo anterior, la base rechaza un segundo turno
 *      con el mismo inicio exacto.
 */
export async function createBooking(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const limit = await checkRateLimit(await clientKey("book"), 8, 600);
  if (!limit.allowed) {
    return fail(
      "Demasiados intentos seguidos. Esperá unos minutos y volvé a probar.",
    );
  }

  const professionalId = Number(formData.get("professionalId"));
  const serviceId = Number(formData.get("serviceId"));
  const date = String(formData.get("date") ?? "");
  const startMinute = Number(formData.get("startMinute"));

  if (!professionalId || !serviceId || !date || !Number.isFinite(startMinute)) {
    return fail("Faltan datos del turno. Volvé a elegir el horario.");
  }

  const { errors, value } = validateCustomer(readCustomer(formData));
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Revisá los datos marcados.", errors };
  }

  const settings = await getSettings();

  const [professional] = await db
    .select()
    .from(professionals)
    .where(
      and(eq(professionals.id, professionalId), eq(professionals.active, true)),
    )
    .limit(1);

  if (!professional) return fail("Esa profesional ya no está disponible.");

  const [service] = await db
    .select()
    .from(services)
    .where(
      and(
        eq(services.id, serviceId),
        eq(services.professionalId, professionalId),
        eq(services.active, true),
      ),
    )
    .limit(1);

  if (!service) return fail("Ese servicio ya no está disponible.");

  // Chequeo completo contra las reglas del negocio: horario laboral,
  // vacaciones, excepciones, antelación mínima y turnos ya tomados.
  const bookable = await isSlotBookable({
    professional,
    duration: service.durationMinutes,
    date,
    startMinute,
    settings,
  });

  if (!bookable) {
    return fail(
      "Ese horario se ocupó mientras completabas tus datos. Elegí otro, por favor.",
    );
  }

  const endMinute = startMinute + service.durationMinutes;
  const { token, hash } = generateCancelToken();

  /*
   * La condición `NOT EXISTS` compara el rango pedido contra los turnos ya
   * reservados: hay choque si el nuevo empieza antes de que termine el otro y
   * termina después de que el otro empieza. Si algo se solapa, el SELECT no
   * devuelve filas y el INSERT no inserta nada.
   */
  let created = false;
  try {
    const result = await client.execute({
      sql: `INSERT INTO appointments
              (professional_id, service_id, service_name, date, start_minute,
               end_minute, status, first_name, last_name, dni, email, phone,
               cancel_token_hash, created_at)
            SELECT ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, ?, ?, ?, unixepoch()
            WHERE NOT EXISTS (
              SELECT 1 FROM appointments
               WHERE professional_id = ? AND date = ? AND status = 'booked'
                 AND start_minute < ? AND end_minute > ?
            )`,
      args: [
        professionalId,
        service.id,
        service.name,
        date,
        startMinute,
        endMinute,
        value.firstName,
        value.lastName,
        value.dni,
        value.email,
        value.phone,
        hash,
        professionalId,
        date,
        endMinute,
        startMinute,
      ],
    });

    created = result.rowsAffected > 0;
  } catch {
    // Salta si el índice único parcial rechazó la inserción.
    created = false;
  }

  if (!created) {
    return fail(
      "Ese horario acaba de ser reservado por otra persona. Elegí otro, por favor.",
    );
  }

  // El envío puede fallar sin que eso invalide el turno: ya está guardado y el
  // cliente ve el link en la pantalla siguiente. Igual queda anotado el motivo
  // en los logs del servidor, que es lo único que explica un mail que no llegó.
  const mail = await sendBookingConfirmation({
    to: value.email,
    firstName: value.firstName,
    professionalName: professional.name,
    serviceName: service.name,
    date,
    startMinute,
    manageUrl: await buildManageUrl(token),
  }).catch((e) => ({ sent: false, reason: String(e) }));

  if (!mail.sent) {
    console.warn("[email] no se envió la confirmación:", mail.reason);
  }

  // Aviso a la profesional, al email de su cuenta del panel. Tampoco puede
  // hacer fallar la reserva: `notifyProfessionalNewBooking` se traga sus
  // propios errores.
  await notifyProfessionalNewBooking({
    professionalId,
    date,
    startMinute,
    endMinute,
    serviceName: service.name,
    firstName: value.firstName,
    lastName: value.lastName,
    dni: value.dni,
    email: value.email,
    phone: value.phone,
  });

  revalidatePath("/");
  revalidatePath("/admin");

  redirect(`/turno/${token}?nuevo=1`);
}

async function buildManageUrl(token: string) {
  return `${await siteOrigin()}/turno/${token}`;
}

/**
 * Cancela un turno con el token del link.
 *
 * No borra la fila: cambia el estado. El horario se libera igual, porque el
 * índice y el cálculo de disponibilidad solo miran los turnos 'booked'. Así
 * queda registro de la cancelación para el panel.
 */
export async function cancelBooking(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const token = String(formData.get("token") ?? "");
  if (!looksLikeToken(token)) {
    return { ok: false, message: "El link de cancelación no es válido." };
  }

  const limit = await checkRateLimit(await clientKey("cancel"), 20, 600);
  if (!limit.allowed) {
    return { ok: false, message: "Demasiados intentos. Probá en unos minutos." };
  }

  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.cancelTokenHash, hashToken(token)))
    .limit(1);

  if (!appointment) {
    return { ok: false, message: "No encontramos ese turno." };
  }

  if (appointment.status !== "booked") {
    return { ok: false, message: "Este turno ya estaba cancelado." };
  }

  const settings = await getSettings();
  const cutoffHours = settingInt(settings, "cancel_cutoff_hours");
  const remaining = minutesUntil(
    appointment.date,
    appointment.startMinute,
    settings.timezone,
  );

  if (remaining < 0) {
    return { ok: false, message: "Este turno ya pasó." };
  }

  if (cutoffHours > 0 && remaining < cutoffHours * 60) {
    return {
      ok: false,
      message: `Los turnos se pueden cancelar hasta ${cutoffHours} ${
        cutoffHours === 1 ? "hora" : "horas"
      } antes. Comunicate con nosotros para reprogramarlo.`,
    };
  }

  await db
    .update(appointments)
    .set({
      status: "cancelled_by_client",
      cancelledAt: Math.floor(Date.now() / 1000),
    })
    .where(
      and(eq(appointments.id, appointment.id), eq(appointments.status, "booked")),
    );

  await sendCancellationConfirmation({
    to: appointment.email,
    firstName: appointment.firstName,
    date: appointment.date,
    startMinute: appointment.startMinute,
  }).catch(() => undefined);

  await notifyProfessionalCancellation(appointment, "client");

  revalidatePath("/");
  revalidatePath(`/turno/${token}`);
  revalidatePath("/admin");

  return {
    ok: true,
    message: `Cancelamos tu turno del ${formatDateLong(appointment.date)} a las ${formatMinute(appointment.startMinute)}.`,
  };
}

/**
 * Búsqueda de turno por DNI + email, para quien perdió el link.
 *
 * Cada búsqueda exitosa genera un token nuevo y descarta el anterior. Dos
 * ventajas: se puede armar el link sin haber guardado nunca el token en claro,
 * y un link viejo que haya quedado dando vueltas deja de funcionar.
 *
 * El mensaje de error es siempre el mismo, exista o no el turno, para que la
 * pantalla no sirva para averiguar si una persona es clienta del local.
 */
export async function lookupBooking(
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const settings = await getSettings();

  if (!settingBool(settings, "allow_client_lookup")) {
    return {
      message: "La búsqueda por DNI no está habilitada. Usá el link que recibiste al reservar.",
      results: [],
    };
  }

  const limit = await checkRateLimit(await clientKey("lookup"), 6, 900);
  if (!limit.allowed) {
    return {
      message: "Demasiadas búsquedas seguidas. Esperá unos minutos.",
      results: [],
    };
  }

  const dni = normalizeDni(String(formData.get("dni") ?? ""));
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  const notFound: LookupState = {
    message:
      "No encontramos turnos activos con esos datos. Revisá que el DNI y el email sean los mismos que usaste al reservar.",
    results: [],
  };

  if (!dni || !email) return notFound;

  const today = nowInTz(settings.timezone).date;

  const rows = await db
    .select({
      id: appointments.id,
      date: appointments.date,
      startMinute: appointments.startMinute,
      serviceName: appointments.serviceName,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(
      and(
        eq(appointments.dni, dni),
        eq(appointments.email, email),
        eq(appointments.status, "booked"),
        gte(appointments.date, today),
      ),
    );

  if (rows.length === 0) return notFound;

  const results: LookupResult[] = [];
  for (const row of rows) {
    const { token, hash } = generateCancelToken();
    await db
      .update(appointments)
      .set({ cancelTokenHash: hash })
      .where(eq(appointments.id, row.id));

    results.push({
      token,
      date: row.date,
      startMinute: row.startMinute,
      professionalName: row.professionalName,
      serviceName: row.serviceName,
    });
  }

  results.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute,
  );

  return { message: null, results };
}
