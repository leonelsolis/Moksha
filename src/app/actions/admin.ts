"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  appointments,
  professionals,
  scheduleOverrides,
  services,
  vacations,
  workingHours,
} from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import {
  canAccessProfessional,
  requireAdmin,
  requireUser,
  withScope,
} from "@/lib/auth";
import { isValidDateString, parseMinute } from "@/lib/dates";
import { sendTestEmail } from "@/lib/email";
import { notifyProfessionalCancellation } from "@/lib/notify";
import { updateSettings, type SettingKey, type Settings } from "@/lib/settings";
import {
  isValidEmail,
  normalizeEmail,
  SERVICE_DESCRIPTION_MAX,
} from "@/lib/validation";

/**
 * Acciones del panel.
 *
 * Todas empiezan pidiendo el usuario. El middleware ya bloquea /admin, pero un
 * server action es un endpoint HTTP propio: se puede invocar directamente sin
 * pasar por ninguna página, así que cada uno tiene que verificar por su cuenta.
 *
 * Hay dos niveles:
 *
 *   · `requireAdmin` en lo que define el negocio (profesionales, servicios,
 *     ajustes). Nada de esto lo toca una profesional.
 *
 *   · `requireUser` + alcance en lo que es "de alguien": turnos, horarios,
 *     excepciones y vacaciones. Acá no alcanza con estar logueada, porque una
 *     profesional podría mandar el id de la otra en el formulario. Cada acción
 *     comprueba de quién es la fila:
 *       - si el id de la profesional viene en el formulario, se valida con
 *         `canAccessProfessional`;
 *       - si la acción borra o edita por id de fila, la condición de alcance se
 *         agrega al WHERE con `withScope`, así un id ajeno no afecta ninguna
 *         fila en lugar de tener que leerla antes para ver de quién es.
 */

function ok(message: string): ActionState {
  return { ok: true, message };
}

function error(message: string): ActionState {
  return { ok: false, message };
}

/** Mensaje único para todo lo que queda fuera del alcance del usuario. */
const FORBIDDEN = "No tenés permiso para modificar eso.";

function refreshAll() {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/horarios");
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/servicios");
}

/* ── Turnos ─────────────────────────────────────────────────────────── */

export async function cancelAppointmentAsAdmin(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Turno no encontrado.");

  // Se lee antes de cancelar, con el alcance aplicado: sirve para comprobar
  // que el turno es de quien lo está cancelando y para armar el aviso.
  const [appointment] = await db
    .select()
    .from(appointments)
    .where(withScope(user, appointments.professionalId, eq(appointments.id, id)))
    .limit(1);

  if (!appointment) return error("Turno no encontrado.");

  // Una pre-reserva esperando el pago de la seña también se puede soltar: está
  // ocupando el horario igual que un turno confirmado.
  const result = await db
    .update(appointments)
    .set({
      status: "cancelled_by_admin",
      cancelledAt: Math.floor(Date.now() / 1000),
      holdExpiresAt: null,
    })
    .where(
      and(
        eq(appointments.id, id),
        inArray(appointments.status, ["booked", "pending_payment"]),
      ),
    );

  if (result.rowsAffected === 0) return error("Ese turno ya estaba cancelado.");

  // De una pre-reserva sin pagar nunca se avisó nada, así que tampoco se avisa
  // de su cancelación.
  if (appointment.status === "booked") {
    await notifyProfessionalCancellation(appointment, "admin");
  }

  refreshAll();
  return ok("Turno cancelado. El horario quedó libre.");
}

/**
 * Borrado definitivo. Cancelar alcanza para liberar el horario y deja
 * registro; esto es para depurar datos de prueba o borrar a pedido del
 * cliente, y sí elimina sus datos personales.
 */
export async function deleteAppointment(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Turno no encontrado.");

  const result = await db
    .delete(appointments)
    .where(withScope(user, appointments.professionalId, eq(appointments.id, id)));

  if (result.rowsAffected === 0) return error("Turno no encontrado.");

  refreshAll();
  return ok("Turno eliminado.");
}

/* ── Profesionales ──────────────────────────────────────────────────── */

export async function saveProfessional(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const specialty = String(formData.get("specialty") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder")) || 0;
  const active = formData.get("active") === "on";

  if (!name) return error("El nombre no puede quedar vacío.");

  const values = {
    name,
    specialty,
    bio,
    sortOrder,
    active,
  };

  /*
   * La foto NO se toca acá.
   *
   * Tiene su propio formulario (subir y quitar), así que este no envía el
   * campo. Si se incluyera de todos modos, guardar los datos lo dejaría vacío
   * y borraría la foto sin que nadie lo pidiera.
   */

  if (id) {
    await db.update(professionals).set(values).where(eq(professionals.id, id));
  } else {
    await db.insert(professionals).values(values);
  }

  refreshAll();
  return ok(id ? "Datos actualizados." : `${name} agregada.`);
}

/**
 * Da de baja a una profesional sin borrarla.
 *
 * No se ofrece eliminarla: sus turnos pasados quedarían huérfanos y se
 * perdería el historial. Desactivada desaparece de la web pública y no se le
 * pueden sacar turnos nuevos.
 */
export async function toggleProfessionalActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!id) return error("Profesional no encontrada.");

  await db.update(professionals).set({ active }).where(eq(professionals.id, id));

  refreshAll();
  return ok(active ? "Profesional activada." : "Profesional desactivada.");
}

/* ── Vacaciones ─────────────────────────────────────────────────────── */

/**
 * Interruptor inmediato, sin fechas: para cuando no se sabe hasta cuándo.
 *
 * Cada profesional puede marcarse a sí misma; la administración, a cualquiera.
 */
export async function toggleVacation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  const onVacation = formData.get("onVacation") === "true";
  if (!id) return error("Profesional no encontrada.");
  if (!canAccessProfessional(user, id)) return error(FORBIDDEN);

  await db
    .update(professionals)
    .set({ onVacation })
    .where(eq(professionals.id, id));

  refreshAll();
  return ok(
    onVacation
      ? "Marcada como de vacaciones. No se le pueden sacar turnos."
      : "Vuelta de vacaciones. Ya se le pueden sacar turnos.",
  );
}

export async function addVacation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!professionalId) return error("Profesional no encontrada.");
  if (!canAccessProfessional(user, professionalId)) return error(FORBIDDEN);

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return error("Revisá las fechas.");
  }

  if (endDate < startDate) {
    return error("La fecha de vuelta no puede ser anterior a la de salida.");
  }

  // Los turnos ya reservados en ese rango no se tocan: se avisan en pantalla
  // para que la dueña decida si los cancela o los reprograma a mano.
  await db.insert(vacations).values({ professionalId, startDate, endDate, note });

  refreshAll();
  return ok("Vacaciones cargadas. Esos días ya no aparecen para reservar.");
}

export async function deleteVacation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("No encontrado.");

  const result = await db
    .delete(vacations)
    .where(withScope(user, vacations.professionalId, eq(vacations.id, id)));

  if (result.rowsAffected === 0) return error("No encontrado.");

  refreshAll();
  return ok("Vacaciones eliminadas.");
}

/* ── Servicios ──────────────────────────────────────────────────────── */

export async function saveService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id")) || null;
  const professionalId = Number(formData.get("professionalId"));
  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("durationMinutes"));
  const rawPrice = String(formData.get("price") ?? "").trim();
  const rawDeposit = String(formData.get("depositAmount") ?? "").trim();
  const active = formData.get("active") === "on";

  if (!professionalId) return error("Profesional no encontrada.");
  if (!name) return error("Poné un nombre al servicio.");

  if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
    return error("La duración tiene que estar entre 5 y 480 minutos.");
  }

  const price = rawPrice ? Number(rawPrice.replace(",", ".")) : null;
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return error("El precio no es válido.");
  }

  /*
   * La seña que hay que pagar online para tomar este servicio. Vacío o 0
   * significa que no se cobra nada: el turno se confirma en el momento. Solo
   * tiene efecto con Mercado Pago encendido en Ajustes; con el cobro apagado,
   * el monto queda cargado y no se le pide nada a nadie.
   */
  const deposit = rawDeposit ? Number(rawDeposit.replace(",", ".")) : null;
  if (deposit !== null && (!Number.isFinite(deposit) || deposit < 0)) {
    return error("La seña no es válida.");
  }

  if (deposit !== null && price !== null && deposit > price) {
    return error("La seña no puede ser mayor que el precio del servicio.");
  }

  const values = {
    professionalId,
    name,
    durationMinutes: Math.round(duration),
    price,
    depositAmount: deposit,
    active,
  };

  if (id) {
    await db
      .update(services)
      .set(values)
      .where(and(eq(services.id, id), eq(services.professionalId, professionalId)));
  } else {
    await db.insert(services).values(values);
  }

  refreshAll();
  return ok(id ? "Servicio actualizado." : "Servicio agregado.");
}

export async function deleteService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return error("Servicio no encontrado.");

  // Los turnos ya tomados guardan copia del nombre del servicio, así que
  // borrarlo no afecta al historial.
  await db.delete(services).where(eq(services.id, id));

  refreshAll();
  return ok("Servicio eliminado.");
}

/**
 * La ficha del servicio: qué es y si su foto se muestra.
 *
 * Es lo único de un servicio que NO exige ser administración. La duración, el
 * precio o el nombre definen el negocio y los fija la dueña; la explicación de
 * qué es un kapping la escribe quien lo hace.
 *
 * El aislamiento no se comprueba leyendo la fila antes: la condición de alcance
 * va en el WHERE, así el id de un servicio ajeno no afecta ninguna fila y la
 * acción responde que no existe. Para la administración el alcance queda vacío
 * y puede editar cualquiera.
 */
export async function saveServiceInfo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Servicio no encontrado.");

  const description = String(formData.get("description") ?? "")
    .trim()
    .slice(0, SERVICE_DESCRIPTION_MAX);

  // Sin foto cargada el check va deshabilitado y no se envía, así que esto
  // también lo deja apagado, que es lo correcto.
  const showPhoto = formData.get("showPhoto") === "on";

  const result = await db
    .update(services)
    .set({ description, showPhoto })
    .where(withScope(user, services.professionalId, eq(services.id, id)));

  if (result.rowsAffected === 0) return error("Servicio no encontrado.");

  refreshAll();
  return ok("Ficha guardada.");
}

/* ── Horarios ───────────────────────────────────────────────────────── */

export async function addWorkingHour(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  const weekday = Number(formData.get("weekday"));
  const start = parseMinute(String(formData.get("start") ?? ""));
  const end = parseMinute(String(formData.get("end") ?? ""));

  if (!professionalId) return error("Profesional no encontrada.");
  if (!canAccessProfessional(user, professionalId)) return error(FORBIDDEN);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    return error("Día de la semana inválido.");
  }
  if (start === null || end === null) return error("Revisá los horarios.");
  if (end <= start) {
    return error("La hora de fin tiene que ser posterior a la de inicio.");
  }

  const existing = await db
    .select()
    .from(workingHours)
    .where(
      and(
        eq(workingHours.professionalId, professionalId),
        eq(workingHours.weekday, weekday),
      ),
    );

  // Dos franjas superpuestas el mismo día generarían horarios duplicados en la
  // grilla pública.
  if (existing.some((row) => start < row.endMinute && end > row.startMinute)) {
    return error("Esa franja se superpone con otra que ya está cargada.");
  }

  await db.insert(workingHours).values({
    professionalId,
    weekday,
    startMinute: start,
    endMinute: end,
  });

  refreshAll();
  return ok("Franja horaria agregada.");
}

export async function deleteWorkingHour(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Franja no encontrada.");

  const result = await db
    .delete(workingHours)
    .where(withScope(user, workingHours.professionalId, eq(workingHours.id, id)));

  if (result.rowsAffected === 0) return error("Franja no encontrada.");

  refreshAll();
  return ok("Franja eliminada.");
}

/** Copia el horario de un día a otros días de la semana. */
export async function copyWorkingDay(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  const from = Number(formData.get("fromWeekday"));
  const targets = formData
    .getAll("targets")
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6 && day !== from);

  if (!professionalId || !Number.isInteger(from)) {
    return error("Datos incompletos.");
  }
  if (!canAccessProfessional(user, professionalId)) return error(FORBIDDEN);
  if (targets.length === 0) return error("Elegí al menos un día de destino.");

  const source = await db
    .select()
    .from(workingHours)
    .where(
      and(
        eq(workingHours.professionalId, professionalId),
        eq(workingHours.weekday, from),
      ),
    );

  if (source.length === 0) return error("Ese día no tiene horarios cargados.");

  for (const day of targets) {
    await db
      .delete(workingHours)
      .where(
        and(
          eq(workingHours.professionalId, professionalId),
          eq(workingHours.weekday, day),
        ),
      );

    await db.insert(workingHours).values(
      source.map((row) => ({
        professionalId,
        weekday: day,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      })),
    );
  }

  refreshAll();
  return ok(`Horario copiado a ${targets.length} ${targets.length === 1 ? "día" : "días"}.`);
}

/* ── Excepciones por fecha ──────────────────────────────────────────── */

export async function addOverride(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  const date = String(formData.get("date") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!professionalId) return error("Profesional no encontrada.");
  if (!canAccessProfessional(user, professionalId)) return error(FORBIDDEN);
  if (!isValidDateString(date)) return error("Revisá la fecha.");
  if (kind !== "closed" && kind !== "custom") return error("Tipo inválido.");

  if (kind === "closed") {
    await db.insert(scheduleOverrides).values({
      professionalId,
      date,
      kind: "closed",
      startMinute: null,
      endMinute: null,
      note,
    });

    refreshAll();
    return ok("Día cerrado. Ya no aparece para reservar.");
  }

  const start = parseMinute(String(formData.get("start") ?? ""));
  const end = parseMinute(String(formData.get("end") ?? ""));

  if (start === null || end === null) return error("Revisá los horarios.");
  if (end <= start) {
    return error("La hora de fin tiene que ser posterior a la de inicio.");
  }

  await db.insert(scheduleOverrides).values({
    professionalId,
    date,
    kind: "custom",
    startMinute: start,
    endMinute: end,
    note,
  });

  refreshAll();
  return ok("Horario especial cargado para ese día.");
}

export async function deleteOverride(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Excepción no encontrada.");

  const result = await db
    .delete(scheduleOverrides)
    .where(
      withScope(
        user,
        scheduleOverrides.professionalId,
        eq(scheduleOverrides.id, id),
      ),
    );

  if (result.rowsAffected === 0) return error("Excepción no encontrada.");

  refreshAll();
  return ok("Excepción eliminada.");
}

/* ── Ajustes ────────────────────────────────────────────────────────── */

const EDITABLE_SETTINGS: SettingKey[] = [
  "business_name",
  "business_tagline",
  // El logo no está acá: se sube como imagen desde su propia sección
  // (ver actions/photos.ts), no se escribe a mano.
  "contact_phone",
  "contact_address",
  "contact_instagram",
  "timezone",
  "booking_window_days",
  "min_hours_before_booking",
  "cancel_cutoff_hours",
  "allow_client_lookup",
  "email_enabled",
  "email_from",
  "mp_enabled",
];

const CHECKBOX_SETTINGS: SettingKey[] = [
  "allow_client_lookup",
  "email_enabled",
  "mp_enabled",
];

export async function saveSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const values: Partial<Settings> = {};

  for (const key of EDITABLE_SETTINGS) {
    if (CHECKBOX_SETTINGS.includes(key)) {
      // Un checkbox sin marcar no se envía: hay que registrarlo como "false"
      // explícitamente o quedaría con el valor anterior.
      values[key] = formData.get(key) === "on" ? "true" : "false";
      continue;
    }

    const raw = formData.get(key);
    if (raw === null) continue;
    values[key] = String(raw).trim();
  }

  const window = Number(values.booking_window_days);
  if (!Number.isFinite(window) || window < 1 || window > 365) {
    return error("Los días de anticipación tienen que estar entre 1 y 365.");
  }

  const cutoff = Number(values.cancel_cutoff_hours);
  if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 720) {
    return error("El límite para cancelar tiene que estar entre 0 y 720 horas.");
  }

  const lead = Number(values.min_hours_before_booking);
  if (!Number.isFinite(lead) || lead < 0 || lead > 720) {
    return error("La anticipación mínima tiene que estar entre 0 y 720 horas.");
  }

  if (!values.business_name) return error("El nombre del negocio no puede quedar vacío.");

  try {
    // Una zona horaria mal escrita rompería todo el cálculo de disponibilidad.
    new Intl.DateTimeFormat("en-CA", { timeZone: values.timezone });
  } catch {
    return error("Esa zona horaria no es válida.");
  }

  await updateSettings(values);

  refreshAll();
  revalidatePath("/admin/ajustes");
  revalidatePath("/cancelar");

  return ok("Cambios guardados.");
}

/**
 * Prueba de envío. Manda un mail suelto a la dirección que se escriba, sin
 * necesidad de sacar un turno de mentira y sin importar si el interruptor está
 * encendido: sirve justamente para verificar la configuración antes de
 * activarla. Guardá los ajustes primero, porque lee el remitente de la base.
 */
export async function sendTestEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const to = normalizeEmail(String(formData.get("to") ?? ""));
  if (!isValidEmail(to)) return error("Escribí una dirección de email válida.");

  const result = await sendTestEmail(to);

  return result.sent
    ? ok(`Enviado a ${to}. Si no aparece en unos minutos, revisá el correo no deseado.`)
    : error(result.reason ?? "No se pudo enviar.");
}
