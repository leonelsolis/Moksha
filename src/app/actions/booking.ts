"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray } from "drizzle-orm";

import { client, db } from "@/db";
import { appointments, professionals, services } from "@/db/schema";
import type {
  BookingState,
  CancelState,
  LookupResult,
  LookupState,
} from "@/lib/action-state";
import { isSlotBookable, releaseExpiredHolds } from "@/lib/availability";
import { formatDateLong, formatMinute, minutesUntil, nowInTz } from "@/lib/dates";
import { sendCancellationConfirmation } from "@/lib/email";
import {
  announceNewBooking,
  notifyProfessionalCancellation,
} from "@/lib/notify";
import { createDepositCheckout, depositFor, paymentPlanFor } from "@/lib/payments";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { getSettings, settingBool, settingInt } from "@/lib/settings";
import { generateCancelToken, hashToken, looksLikeToken } from "@/lib/tokens";
import {
  assignTransferAmount,
  transferAvailableFor,
  transferHoldMinutes,
} from "@/lib/transfer";
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
 *
 * De acá salen dos finales distintos, y cuál es lo decide `paymentPlanFor`:
 *
 *   · Sin cobro (Mercado Pago apagado, sin token, o servicio sin seña): el
 *     turno nace confirmado, se manda el mail y se va a la pantalla del turno.
 *     Es el camino de siempre y el que corre de fábrica.
 *
 *   · Con cobro: el turno nace como pre-reserva ('pending_payment'), retiene el
 *     horario un rato y la clienta se va al checkout de Mercado Pago. Recién
 *     con el pago aprobado pasa a confirmado.
 *
 * Que el cobro esté mal configurado o que Mercado Pago no conteste no rompe
 * ninguna reserva: en cualquiera de esos casos se termina por el primer camino.
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
   * ¿Este turno se cobra?
   *
   * `paymentPlanFor` mira las tres condiciones juntas —interruptor encendido,
   * token cargado en el servidor y seña cargada en este servicio— y nunca
   * lanza: ante cualquier duda contesta que no se cobra. Por eso no hace falta
   * envolver nada en try/catch acá: con Mercado Pago apagado, mal configurado o
   * caído, la reserva sigue por el camino de siempre.
   */
  const plan = await paymentPlanFor(service, settings);

  const now = Math.floor(Date.now() / 1000);

  /*
   * ¿Y por dónde se cobra?
   *
   * La clienta eligió en el formulario, pero lo que llega del navegador es una
   * intención y no una autorización: se vuelve a comprobar contra la
   * configuración de ahora. Un campo manipulado, o una transferencia que se
   * apagó en Ajustes mientras la pantalla estaba abierta, no puede meter un
   * turno por un camino que el negocio no tiene habilitado.
   *
   * `assignTransferAmount` puede devolver null si no quedan centavos libres
   * (ver `transfer.ts`). En ese caso no se inventa un importe ambiguo: se cae
   * al camino de Mercado Pago, o al de sin cobro si tampoco está.
   */
  const wantsTransfer = String(formData.get("paymentMethod") ?? "") === "transfer";

  const transferAmount =
    wantsTransfer && (await transferAvailableFor(service, settings))
      ? await assignTransferAmount(depositFor(service), now)
      : null;

  const byTransfer = transferAmount !== null;

  const holdExpiresAt = byTransfer
    ? now + transferHoldMinutes(settings) * 60
    : plan.charge
      ? now + plan.holdMinutes * 60
      : null;

  const depositAmount = byTransfer
    ? depositFor(service)
    : plan.charge
      ? plan.amount
      : null;

  /** Retiene el horario todo lo que no se confirme en el acto. */
  const isPreBooking = byTransfer || plan.charge;

  // Las pre-reservas vencidas de ese día se dan de baja antes de intentar el
  // alta: el índice único cuenta a las 'pending_payment', así que una que quedó
  // a medias bloquearía el horario aunque su retención ya no valga.
  await releaseExpiredHolds(professionalId, date, now);

  /*
   * La condición `NOT EXISTS` compara el rango pedido contra los turnos que
   * retienen el horario —confirmados y pre-reservas todavía vigentes—: hay
   * choque si el nuevo empieza antes de que termine el otro y termina después
   * de que el otro empieza. Si algo se solapa, el SELECT no devuelve filas y el
   * INSERT no inserta nada.
   */
  let appointmentId: number | null = null;
  try {
    const result = await client.execute({
      sql: `INSERT INTO appointments
              (professional_id, service_id, service_name, date, start_minute,
               end_minute, status, first_name, last_name, dni, email, phone,
               cancel_token_hash, deposit_amount, hold_expires_at,
               payment_method, transfer_amount, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()
            WHERE NOT EXISTS (
              SELECT 1 FROM appointments
               WHERE professional_id = ? AND date = ?
                 AND (status = 'booked'
                      OR (status = 'pending_payment' AND hold_expires_at > ?))
                 AND start_minute < ? AND end_minute > ?
            )
            RETURNING id`,
      args: [
        professionalId,
        service.id,
        service.name,
        date,
        startMinute,
        endMinute,
        isPreBooking ? "pending_payment" : "booked",
        value.firstName,
        value.lastName,
        value.dni,
        value.email,
        value.phone,
        hash,
        depositAmount,
        holdExpiresAt,
        byTransfer ? "transfer" : plan.charge ? "mercadopago" : null,
        transferAmount,
        professionalId,
        date,
        now,
        endMinute,
        startMinute,
      ],
    });

    appointmentId = result.rows.length > 0 ? Number(result.rows[0].id) : null;
  } catch {
    // Salta si el índice único parcial rechazó la inserción.
    appointmentId = null;
  }

  if (appointmentId === null) {
    return fail(
      "Ese horario acaba de ser reservado por otra persona. Elegí otro, por favor.",
    );
  }

  /*
   * Camino con cobro: se pide el link de pago y se manda a la clienta al
   * checkout. El turno queda retenido hasta que el pago se apruebe.
   *
   * Si Mercado Pago no contesta o rechaza la preferencia, la pre-reserva se
   * confirma igual y sigue por el camino de abajo, sin cobro. Es a propósito:
   * una seña que no se cobró se arregla cobrando en el local, pero una reserva
   * que no se pudo hacer es una clienta perdida. Queda el motivo en los logs.
   */
  /*
   * Camino de la transferencia: no hay a dónde mandarla, así que se va a la
   * pantalla de su turno, que es la que muestra el alias y el importe exacto.
   *
   * No se manda ningún aviso todavía. El turno no está confirmado —falta que
   * entre la plata— y anunciar por mail un turno que puede no concretarse es
   * exactamente la confusión que hay que evitar. Los avisos salen al
   * acreditarse, desde `confirmTransfer`.
   */
  if (byTransfer) {
    revalidatePath("/");
    revalidatePath("/admin");

    redirect(`/turno/${token}`);
  }

  if (plan.charge) {
    const checkout = await createDepositCheckout(
      {
        id: appointmentId,
        email: value.email,
        serviceName: service.name,
        amount: plan.amount,
        token,
      },
      settings,
    );

    if (checkout.ok) {
      await db
        .update(appointments)
        .set({
          mpPreferenceId: checkout.data.preferenceId,
          mpCheckoutUrl: checkout.data.url,
        })
        .where(eq(appointments.id, appointmentId));

      revalidatePath("/");
      revalidatePath("/admin");

      redirect(checkout.data.url);
    }

    console.warn(
      "[pagos] no se pudo abrir el checkout; el turno se confirma sin cobrar:",
      checkout.reason,
    );

    await db
      .update(appointments)
      .set({
        status: "booked",
        depositAmount: null,
        holdExpiresAt: null,
      })
      .where(eq(appointments.id, appointmentId));
  }

  // El mail a la clienta y el aviso a la profesional. Ninguno de los dos puede
  // invalidar el turno: ya está guardado y la clienta ve el link en la pantalla
  // siguiente. Lo que falle queda anotado en los logs del servidor, que es lo
  // único que explica después un mail que no llegó.
  await announceNewBooking({
    appointmentId,
    appointment: {
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
    },
    professionalName: professional.name,
    token,
  });

  revalidatePath("/");
  revalidatePath("/admin");

  redirect(`/turno/${token}?nuevo=1`);
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

  /*
   * Una pre-reserva sin pagar también se puede soltar desde acá: quien se
   * arrepintió en el checkout no tiene por qué esperar a que venza el plazo
   * para liberar el horario.
   */
  const wasConfirmed = appointment.status === "booked";
  const isPending = appointment.status === "pending_payment";

  if (!wasConfirmed && !isPending) {
    return {
      ok: false,
      message:
        appointment.status === "expired_payment"
          ? "Esta reserva venció sin pagarse. Sacá un turno nuevo cuando quieras."
          : "Este turno ya estaba cancelado.",
    };
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
      // La retención deja de tener sentido: el horario queda libre ya mismo.
      holdExpiresAt: null,
    })
    .where(
      and(
        eq(appointments.id, appointment.id),
        inArray(appointments.status, ["booked", "pending_payment"]),
      ),
    );

  // Los avisos son solo para los turnos que llegaron a confirmarse. De una
  // pre-reserva sin pagar nunca se anunció nada: mandar ahora la cancelación de
  // algo que la clienta no sabe que existía solo genera confusión.
  if (wasConfirmed) {
    await sendCancellationConfirmation({
      to: appointment.email,
      firstName: appointment.firstName,
      date: appointment.date,
      startMinute: appointment.startMinute,
    }).catch(() => undefined);

    await notifyProfessionalCancellation(appointment, "client");
  }

  revalidatePath("/");
  revalidatePath(`/turno/${token}`);
  revalidatePath("/admin");

  const when = `del ${formatDateLong(appointment.date)} a las ${formatMinute(appointment.startMinute)}`;

  return {
    ok: true,
    message: wasConfirmed
      ? `Cancelamos tu turno ${when}.`
      : `Soltamos la reserva ${when}. No se te cobró nada.`,
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
