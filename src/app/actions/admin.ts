"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

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
import { requireOwner, requireSession } from "@/lib/auth";
import { isValidDateString, parseMinute } from "@/lib/dates";
import { updateSettings, type SettingKey, type Settings } from "@/lib/settings";

/**
 * Acciones del panel.
 *
 * Todas empiezan pidiendo la sesión. El middleware ya bloquea /admin, pero un
 * server action es un endpoint HTTP propio: se puede invocar directamente sin
 * pasar por ninguna página, así que cada uno tiene que verificar por su cuenta.
 *
 * `requireOwner` se usa en lo que configura el negocio (profesionales,
 * horarios, ajustes). La agenda de turnos queda con `requireSession`, para que
 * un usuario 'staff' pueda trabajar sin poder cambiar la configuración.
 */

function ok(message: string): ActionState {
  return { ok: true, message };
}

function error(message: string): ActionState {
  return { ok: false, message };
}

function refreshAll() {
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/horarios");
  revalidatePath("/admin/profesionales");
}

/* ── Turnos ─────────────────────────────────────────────────────────── */

export async function cancelAppointmentAsAdmin(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();

  const id = Number(formData.get("id"));
  if (!id) return error("Turno no encontrado.");

  const result = await db
    .update(appointments)
    .set({
      status: "cancelled_by_admin",
      cancelledAt: Math.floor(Date.now() / 1000),
    })
    .where(and(eq(appointments.id, id), eq(appointments.status, "booked")));

  refreshAll();

  return result.rowsAffected > 0
    ? ok("Turno cancelado. El horario quedó libre.")
    : error("Ese turno ya estaba cancelado.");
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
  await requireSession();

  const id = Number(formData.get("id"));
  if (!id) return error("Turno no encontrado.");

  await db.delete(appointments).where(eq(appointments.id, id));
  refreshAll();

  return ok("Turno eliminado.");
}

/* ── Profesionales ──────────────────────────────────────────────────── */

export async function saveProfessional(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const specialty = String(formData.get("specialty") ?? "").trim();
  const photoUrl = String(formData.get("photoUrl") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const sortOrder = Number(formData.get("sortOrder")) || 0;
  const active = formData.get("active") === "on";

  if (!name) return error("El nombre no puede quedar vacío.");

  const values = {
    name,
    specialty,
    photoUrl: photoUrl || null,
    bio,
    sortOrder,
    active,
  };

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
  await requireOwner();

  const id = Number(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!id) return error("Profesional no encontrada.");

  await db.update(professionals).set({ active }).where(eq(professionals.id, id));

  refreshAll();
  return ok(active ? "Profesional activada." : "Profesional desactivada.");
}

/* ── Vacaciones ─────────────────────────────────────────────────────── */

/** Interruptor inmediato, sin fechas: para cuando no se sabe hasta cuándo. */
export async function toggleVacation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const id = Number(formData.get("id"));
  const onVacation = formData.get("onVacation") === "true";
  if (!id) return error("Profesional no encontrada.");

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
  await requireOwner();

  const professionalId = Number(formData.get("professionalId"));
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!professionalId) return error("Profesional no encontrada.");

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
  await requireOwner();

  const id = Number(formData.get("id"));
  if (!id) return error("No encontrado.");

  await db.delete(vacations).where(eq(vacations.id, id));

  refreshAll();
  return ok("Vacaciones eliminadas.");
}

/* ── Servicios ──────────────────────────────────────────────────────── */

export async function saveService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const id = Number(formData.get("id")) || null;
  const professionalId = Number(formData.get("professionalId"));
  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("durationMinutes"));
  const rawPrice = String(formData.get("price") ?? "").trim();
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

  const values = {
    professionalId,
    name,
    durationMinutes: Math.round(duration),
    price,
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
  await requireOwner();

  const id = Number(formData.get("id"));
  if (!id) return error("Servicio no encontrado.");

  // Los turnos ya tomados guardan copia del nombre del servicio, así que
  // borrarlo no afecta al historial.
  await db.delete(services).where(eq(services.id, id));

  refreshAll();
  return ok("Servicio eliminado.");
}

/* ── Horarios ───────────────────────────────────────────────────────── */

export async function addWorkingHour(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const professionalId = Number(formData.get("professionalId"));
  const weekday = Number(formData.get("weekday"));
  const start = parseMinute(String(formData.get("start") ?? ""));
  const end = parseMinute(String(formData.get("end") ?? ""));

  if (!professionalId) return error("Profesional no encontrada.");
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
  await requireOwner();

  const id = Number(formData.get("id"));
  if (!id) return error("Franja no encontrada.");

  await db.delete(workingHours).where(eq(workingHours.id, id));

  refreshAll();
  return ok("Franja eliminada.");
}

/** Copia el horario de un día a otros días de la semana. */
export async function copyWorkingDay(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

  const professionalId = Number(formData.get("professionalId"));
  const from = Number(formData.get("fromWeekday"));
  const targets = formData
    .getAll("targets")
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6 && day !== from);

  if (!professionalId || !Number.isInteger(from)) {
    return error("Datos incompletos.");
  }
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
  await requireOwner();

  const professionalId = Number(formData.get("professionalId"));
  const date = String(formData.get("date") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!professionalId) return error("Profesional no encontrada.");
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
  await requireOwner();

  const id = Number(formData.get("id"));
  if (!id) return error("Excepción no encontrada.");

  await db.delete(scheduleOverrides).where(eq(scheduleOverrides.id, id));

  refreshAll();
  return ok("Excepción eliminada.");
}

/* ── Ajustes ────────────────────────────────────────────────────────── */

const EDITABLE_SETTINGS: SettingKey[] = [
  "business_name",
  "business_tagline",
  "business_logo_url",
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
];

const CHECKBOX_SETTINGS: SettingKey[] = ["allow_client_lookup", "email_enabled"];

export async function saveSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner();

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
