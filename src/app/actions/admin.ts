"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { client, db } from "@/db";
import {
  appointments,
  professionals,
  scheduleOverrides,
  serviceCategories,
  services,
  vacations,
  workingHours,
} from "@/db/schema";
import type { ActionState, ManualBookingState } from "@/lib/action-state";
import {
  canAccessProfessional,
  requireAdmin,
  requireUser,
  withScope,
} from "@/lib/auth";
import {
  overlappingAppointments,
  releaseExpiredHolds,
} from "@/lib/availability";
import {
  formatDateLong,
  formatMinute,
  isValidDateString,
  parseMinute,
} from "@/lib/dates";
import { sendTestEmail } from "@/lib/email";
import { checkMercadoPagoToken, mercadoPagoToken } from "@/lib/mercadopago";
import { notifyProfessionalCancellation } from "@/lib/notify";
import { updateSettings, type SettingKey, type Settings } from "@/lib/settings";
import { generateToken } from "@/lib/tokens";
import { enqueueMessages } from "@/lib/whatsapp";
import {
  APPOINTMENT_NOTES_MAX,
  isValidEmail,
  normalizeEmail,
  readManualClient,
  SERVICE_DESCRIPTION_MAX,
  validateManualClient,
  type FieldErrors,
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
  // Muestra cuántos servicios tiene cada categoría y cuáles quedaron sueltos.
  revalidatePath("/admin/categorias");
  // Lista las señas de cada servicio, así que cambia al editar un servicio.
  revalidatePath("/admin/depositos");
  // La cola de WhatsApp cambia con cada turno nuevo o cancelado.
  revalidatePath("/admin/mensajes");
}

/* ── Turnos ─────────────────────────────────────────────────────────── */

/** Duración de un turno manual sin servicio elegido, en minutos. */
const DEFAULT_MANUAL_DURATION = 60;

const MINUTES_IN_A_DAY = 24 * 60;

function manualFail(
  message: string,
  errors: FieldErrors = {},
): ManualBookingState {
  return { ok: false, message, errors };
}

/**
 * Carga a mano un turno que se pidió por fuera de la web.
 *
 * El turno que llega por WhatsApp, por teléfono o en el mostrador termina en la
 * misma tabla que los demás. Es la única forma de que ocupe el horario de
 * verdad: si viviera aparte, la web seguiría ofreciendo ese hueco como libre.
 * Lo único que lo distingue es `origin = 'manual'` y la cuenta que lo anotó,
 * que es lo que la agenda usa para marcarlo.
 *
 * Tres diferencias con la reserva de la web, todas a propósito:
 *
 *   · Los datos de la clienta son casi todos opcionales. Acá no hay nadie
 *     completando un formulario: hay una profesional anotando lo que le
 *     dijeron. Con el nombre alcanza (ver `validateManualClient`).
 *
 *   · No se comprueban las reglas de disponibilidad —horario de atención,
 *     antelación mínima, la grilla de turnos del servicio—. El panel es
 *     justamente donde se anotan las excepciones: la clienta que viene media
 *     hora antes de abrir, el turno de un feriado. Quien lo carga sabe lo que
 *     está haciendo.
 *
 *   · No se manda ningún mail ni se genera link de cancelación para nadie: el
 *     turno lo arregló el local por otro medio y ahí se sigue arreglando.
 *
 * Lo que sí se comprueba, con el mismo rigor que en la web, es que el horario
 * esté libre. Y se comprueba dos veces: una consulta que da el mensaje ("choca
 * con el turno de las 10:00") y una inserción condicional que es la garantía
 * real, porque entre la consulta y el alta otra persona puede reservar desde la
 * web. Ver `overlappingAppointments`.
 */
export async function createManualAppointment(
  _prev: ManualBookingState,
  formData: FormData,
): Promise<ManualBookingState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  if (!professionalId) return manualFail("Elegí de quién es el turno.");
  if (!canAccessProfessional(user, professionalId)) return manualFail(FORBIDDEN);

  const [professional] = await db
    .select()
    .from(professionals)
    .where(eq(professionals.id, professionalId))
    .limit(1);

  if (!professional) return manualFail("Profesional no encontrada.");

  const { errors, value } = validateManualClient(readManualClient(formData));

  const date = String(formData.get("date") ?? "");
  if (!isValidDateString(date)) errors.date = "Elegí la fecha del turno.";

  const startMinute = parseMinute(String(formData.get("time") ?? ""));
  if (startMinute === null) errors.time = "Elegí la hora del turno.";

  /*
   * El servicio es opcional: puede ser uno de los cargados —y entonces manda su
   * nombre y su duración— o un motivo escrito a mano, para lo que no está en la
   * lista. En los dos casos el nombre se copia al turno, igual que en la web:
   * la fila guarda lo que se hizo ese día aunque después el servicio cambie.
   */
  const serviceId = Number(formData.get("serviceId")) || null;
  let serviceName = String(formData.get("serviceName") ?? "")
    .trim()
    .slice(0, 80);
  let duration = Number(formData.get("durationMinutes"));

  if (serviceId) {
    const [service] = await db
      .select()
      .from(services)
      .where(
        and(
          eq(services.id, serviceId),
          eq(services.professionalId, professionalId),
        ),
      )
      .limit(1);

    if (!service) {
      errors.serviceId = "Ese servicio no es de esta profesional.";
    } else {
      serviceName = service.name;
      // La duración del servicio es el punto de partida, no la ley: un turno
      // arreglado por WhatsApp puede llevar más o menos que el estándar, y el
      // formulario deja cambiarla.
      if (!Number.isFinite(duration) || duration <= 0) {
        duration = service.durationMinutes;
      }
    }
  } else if (!Number.isFinite(duration) || duration <= 0) {
    duration = DEFAULT_MANUAL_DURATION;
  }

  duration = Math.round(duration);

  if (duration < 5 || duration > 480) {
    errors.durationMinutes = "La duración tiene que estar entre 5 y 480 minutos.";
  } else if (startMinute !== null && startMinute + duration > MINUTES_IN_A_DAY) {
    // Un turno que cruza la medianoche sería un rango que la agenda no sabe
    // dibujar y que la comprobación de choques no vería: los dos días son
    // filas distintas.
    errors.time = "El turno no puede terminar después de la medianoche.";
  }

  const notes = String(formData.get("notes") ?? "")
    .trim()
    .slice(0, APPOINTMENT_NOTES_MAX);

  if (Object.keys(errors).length > 0) {
    return manualFail("Revisá los datos marcados.", errors);
  }

  const start = startMinute!;
  const endMinute = start + duration;
  const now = Math.floor(Date.now() / 1000);

  // Las pre-reservas vencidas de ese día se sueltan antes de intentar el alta:
  // el índice único las cuenta, así que una que quedó a medias bloquearía el
  // horario aunque su retención ya no valga.
  await releaseExpiredHolds(professionalId, date, now);

  const clashes = await overlappingAppointments({
    professionalId,
    date,
    startMinute: start,
    endMinute,
  });

  if (clashes.length > 0) {
    const clash = clashes[0];
    const who = [clash.firstName, clash.lastName].filter(Boolean).join(" ");

    return manualFail(
      `Ese horario se pisa con el turno de ${formatMinute(clash.startMinute)} a ` +
        `${formatMinute(clash.endMinute)}${who ? ` de ${who}` : ""}. ` +
        "Elegí otro horario o cancelá el que estaba.",
      { time: "El horario ya está ocupado." },
    );
  }

  /*
   * El alta y la comprobación de choques viajan en la misma sentencia: SQLite
   * ejecuta cada una de forma atómica, así que no hay ventana entre "miré si
   * estaba libre" y "lo guardé". Es la misma forma que usa la reserva de la
   * web (ver `createBooking`), por el mismo motivo: sin esto, dos altas
   * simultáneas —una del panel y una de la web— entrarían las dos.
   *
   * El hash del token de cancelación se genera y se descarta el token: la
   * columna es NOT NULL y única, y de un turno manual no hay ningún link que
   * mandarle a nadie. Que el token en claro no exista en ninguna parte es
   * justamente lo correcto acá.
   */
  const { hash } = generateToken();

  let appointmentId: number | null = null;
  try {
    const result = await client.execute({
      sql: `INSERT INTO appointments
              (professional_id, service_id, service_name, date, start_minute,
               end_minute, status, first_name, last_name, dni, email, phone,
               notes, origin, created_by_user_id, cancel_token_hash, created_at)
            SELECT ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?, '', ?, ?, 'manual', ?, ?,
                   unixepoch()
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
        serviceId,
        serviceName,
        date,
        start,
        endMinute,
        value.firstName,
        value.lastName,
        value.dni,
        value.phone,
        notes,
        user.id,
        hash,
        professionalId,
        date,
        now,
        endMinute,
        start,
      ],
    });

    appointmentId = result.rows.length > 0 ? Number(result.rows[0].id) : null;
  } catch {
    // Salta si el índice único parcial rechazó la inserción.
    appointmentId = null;
  }

  if (appointmentId === null) {
    return manualFail(
      "Ese horario acaba de ocuparse. Recargá la agenda y probá con otro.",
      { time: "El horario ya está ocupado." },
    );
  }

  /*
   * De un turno cargado a mano se encola el recordatorio para volver a
   * reservar, pero no la confirmación: este turno se acordó hablando con la
   * persona —por WhatsApp, por teléfono o en el mostrador—, así que
   * confirmárselo por WhatsApp un minuto después es repetirle lo que acaba de
   * decir. El recordatorio, en cambio, es igual de útil venga de donde venga
   * el turno: dentro de un mes nadie se acuerda.
   */
  await enqueueMessages({ appointmentId, date, kinds: ["rebooking"] });

  refreshAll();

  const who = [value.firstName, value.lastName].filter(Boolean).join(" ");

  return {
    ok: true,
    message: `Turno cargado: ${who}, ${formatDateLong(date)} a las ${formatMinute(start)}.`,
    errors: {},
  };
}

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
  const sortOrder = Number(formData.get("sortOrder")) || 0;

  /*
   * La parte de la ficha que se muestra en la web. Viaja en el mismo
   * formulario que el resto desde que los servicios dejaron de estar partidos
   * entre dos pantallas: es un solo servicio y se guarda de una.
   *
   * En el alta estos campos no se dibujan y llegan vacíos, que es exactamente
   * lo que corresponde para un servicio recién creado: sin explicación y sin
   * foto que mostrar.
   */
  const description = String(formData.get("description") ?? "")
    .trim()
    .slice(0, SERVICE_DESCRIPTION_MAX);

  // Sin foto cargada el check va deshabilitado y no se envía, así que esto
  // también lo deja apagado, que es lo correcto.
  const showPhoto = formData.get("showPhoto") === "on";

  /*
   * En qué card del catálogo entra. Vacío es "sin categoría" y es un valor
   * legítimo: queda suelto en el primer nivel, que es como estaban todos los
   * servicios antes de que existieran las categorías. Se comprueba que exista
   * para que un id inventado no deje al servicio colgado de la nada.
   */
  const categoryId = Number(formData.get("categoryId")) || null;

  if (!professionalId) return error("Profesional no encontrada.");
  if (!name) return error("Poné un nombre al servicio.");

  if (categoryId !== null) {
    const [category] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(eq(serviceCategories.id, categoryId))
      .limit(1);

    if (!category) return error("Esa categoría no existe.");
  }

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
    categoryId,
    name,
    durationMinutes: Math.round(duration),
    price,
    depositAmount: deposit,
    active,
    sortOrder,
    description,
    showPhoto,
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
 * La parte del servicio que escribe quien lo hace: la explicación y si su foto
 * se muestra.
 *
 * Es lo único de un servicio que NO exige ser administración. El nombre, la
 * duración, el precio y la seña definen el negocio y los fija la dueña con
 * `saveService`; la explicación de qué es un kapping la escribe quien lo hace.
 * Las dos acciones guardan desde la misma pantalla, cada una con los campos de
 * su rol: por eso acá no hay ni precio ni seña, ni siquiera ignorados.
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
  return ok("Servicio guardado.");
}

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

/**
 * Carga de una sola vez el horario de varios días del mes.
 *
 * Es para las profesionales de horario rotativo: a comienzo de mes les pasan
 * la grilla y no hay un horario "de todas las semanas" que valga. En vez de
 * agregar treinta excepciones sueltas, se tildan los días que tienen el mismo
 * horario y se cargan juntos; se repite una vez por cada turno distinto
 * (mañana, tarde, noche) hasta cubrir el mes.
 *
 * Lo que escribe son las mismas excepciones por fecha de siempre, así que la
 * disponibilidad no necesita saber nada nuevo: un día cargado acá pisa al
 * horario semanal exactamente igual que un feriado.
 *
 * `mode` decide qué queda en los días elegidos:
 *   custom  → atiende en las franjas declaradas, y solo en esas.
 *   closed  → ese día no atiende.
 *   clear   → se borra lo cargado y el día vuelve a regirse por el semanal.
 *
 * Siempre reemplaza: lo que hubiera cargado en esos días se borra primero. Es
 * lo que se espera al recargar un mes que llegó corregido, y evita que dos
 * pasadas dejen franjas duplicadas.
 */
export async function setMonthDays(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  const mode = String(formData.get("mode") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  if (!professionalId) return error("Profesional no encontrada.");
  if (!canAccessProfessional(user, professionalId)) return error(FORBIDDEN);
  if (mode !== "custom" && mode !== "closed" && mode !== "clear") {
    return error("Tipo inválido.");
  }

  const dates = [
    ...new Set(formData.getAll("days").map((value) => String(value))),
  ].filter(isValidDateString);

  if (dates.length === 0) return error("Elegí al menos un día.");

  // Dos franjas alcanzan para mañana y tarde. Para un día más partido se
  // vuelve a cargar ese día solo, sumando la franja que falte.
  const ranges: { startMinute: number; endMinute: number }[] = [];

  if (mode === "custom") {
    for (const [startKey, endKey] of [
      ["start", "end"],
      ["start2", "end2"],
    ] as const) {
      const rawStart = String(formData.get(startKey) ?? "").trim();
      const rawEnd = String(formData.get(endKey) ?? "").trim();

      // La segunda franja es opcional: vacía del todo, no es un error.
      if (!rawStart && !rawEnd) continue;

      const start = parseMinute(rawStart);
      const end = parseMinute(rawEnd);

      if (start === null || end === null) return error("Revisá los horarios.");
      if (end <= start) {
        return error("La hora de fin tiene que ser posterior a la de inicio.");
      }

      ranges.push({ startMinute: start, endMinute: end });
    }

    if (ranges.length === 0) return error("Cargá el horario de esos días.");

    if (
      ranges.length === 2 &&
      ranges[0].startMinute < ranges[1].endMinute &&
      ranges[1].startMinute < ranges[0].endMinute
    ) {
      return error("Las dos franjas se superponen entre sí.");
    }
  }

  await db
    .delete(scheduleOverrides)
    .where(
      and(
        eq(scheduleOverrides.professionalId, professionalId),
        inArray(scheduleOverrides.date, dates),
      ),
    );

  if (mode === "closed") {
    await db.insert(scheduleOverrides).values(
      dates.map((date) => ({
        professionalId,
        date,
        kind: "closed" as const,
        startMinute: null,
        endMinute: null,
        note,
      })),
    );
  } else if (mode === "custom") {
    await db.insert(scheduleOverrides).values(
      dates.flatMap((date) =>
        ranges.map((range) => ({
          professionalId,
          date,
          kind: "custom" as const,
          startMinute: range.startMinute,
          endMinute: range.endMinute,
          note,
        })),
      ),
    );
  }

  refreshAll();

  const count = `${dates.length} ${dates.length === 1 ? "día" : "días"}`;

  if (mode === "clear") {
    return ok(`${count} sin horario propio: vuelven a seguir el semanal.`);
  }
  if (mode === "closed") return ok(`${count} marcados como que no atiende.`);
  return ok(`Horario cargado en ${count}.`);
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
  "whatsapp_enabled",
  "whatsapp_rebook_days",
  "whatsapp_country_code",
  "whatsapp_confirmation_text",
  "whatsapp_rebooking_text",
  // Los cobros NO están acá: tienen su propia pantalla y su propia acción
  // (`saveDepositSettings`). Si estuvieran, guardar Ajustes —que no dibuja el
  // interruptor— apagaría el cobro sin que nadie lo pidiera: un checkbox que
  // no se envía se guarda como "false".
];

const CHECKBOX_SETTINGS: SettingKey[] = [
  "allow_client_lookup",
  "email_enabled",
  "whatsapp_enabled",
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

  const rebook = Number(values.whatsapp_rebook_days);
  if (!Number.isFinite(rebook) || rebook < 1 || rebook > 365) {
    return error(
      "Los días para recordar que vuelva a reservar tienen que estar entre 1 y 365.",
    );
  }

  // Solo dígitos: el link de WhatsApp se arma pegando esto adelante del
  // teléfono, y un "+54" acá dejaría el signo en el medio del número.
  if (values.whatsapp_country_code !== undefined) {
    const code = values.whatsapp_country_code.replace(/\D/g, "");
    if (code.length < 1 || code.length > 4) {
      return error("El prefijo del país tiene que tener entre 1 y 4 números.");
    }
    values.whatsapp_country_code = code;
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

/* ── Señas y cobros ─────────────────────────────────────────────────── */

/**
 * El interruptor de los cobros, aparte del resto de los ajustes.
 *
 * Está separado a propósito: prender o apagar el cobro es la decisión más
 * visible del panel —cambia lo que le pasa a cada persona que reserva— y no
 * tiene que viajar mezclada con el teléfono del local en el mismo formulario.
 *
 * Guardarlo nunca rompe una reserva en curso. Las pre-reservas que quedaron
 * esperando el pago se vuelven a evaluar con esta configuración cuando la
 * clienta reintenta (ver `resumeDepositCheckout`): si se apagó el cobro en el
 * medio, su turno se confirma sin cobrar en vez de quedar trabado.
 */
export async function saveDepositSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const enabled = formData.get("mp_enabled") === "on";

  /*
   * Con el cobro apagado el campo va deshabilitado y el navegador no lo manda.
   * En ese caso no se toca el valor guardado, así el plazo que había vuelve
   * intacto cuando se vuelve a encender.
   */
  const rawHold = formData.get("mp_hold_minutes");
  const values: Partial<Settings> = { mp_enabled: enabled ? "true" : "false" };

  if (rawHold !== null) {
    const minutes = Number(String(rawHold).trim());
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
      return error(
        "El plazo para pagar la seña tiene que estar entre 5 minutos y 24 horas (1440).",
      );
    }
    values.mp_hold_minutes = String(Math.round(minutes));
  }

  await updateSettings(values);

  refreshAll();
  revalidatePath("/admin/depositos");

  if (!enabled) {
    return ok(
      "Cobros desactivados. Los turnos se confirman en el momento, sin seña.",
    );
  }

  // Encender el interruptor sin token no cobra nada. Se dice acá y no solo en
  // el aviso de la pantalla, porque el mensaje de guardado es lo que se lee.
  return mercadoPagoToken() === null
    ? ok(
        "Guardado, pero todavía no se cobra: falta cargar MERCADOPAGO_ACCESS_TOKEN en el servidor.",
      )
    : ok("Cobros activados. Se pide la seña antes de confirmar el turno.");
}

/**
 * Los datos de la cuenta que recibe las transferencias.
 *
 * Es independiente del interruptor de Mercado Pago: los dos medios pueden
 * estar encendidos a la vez y la clienta elige al reservar.
 *
 * El alias y el CBU sí se guardan en la base, a diferencia del token de
 * Mercado Pago. No es una credencial: es un dato público que se le muestra a
 * cualquiera que reserve, del mismo modo que la dirección del local. Lo que un
 * alias permite es que le manden plata a uno.
 */
export async function saveTransferSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const read = (key: string) => String(formData.get(key) ?? "").trim();

  const enabled = formData.get("transfer_enabled") === "on";
  const alias = read("transfer_alias");
  const cbu = read("transfer_cbu").replace(/\s/g, "");

  /*
   * Encender sin destino no serviría de nada: la pantalla de la clienta diría
   * "transferí" sin decir a dónde. Se rechaza acá en vez de guardar una
   * configuración que después no se ofrece y no se entiende por qué.
   */
  if (enabled && !alias && !cbu) {
    return error(
      "Para cobrar por transferencia hace falta cargar el alias o el CBU de la cuenta.",
    );
  }

  if (cbu && !/^\d{22}$/.test(cbu)) {
    return error("El CBU tiene que ser de 22 dígitos, sin espacios ni guiones.");
  }

  const minutes = Number(read("transfer_hold_minutes"));
  if (!Number.isFinite(minutes) || minutes < 60 || minutes > 10080) {
    return error(
      "El plazo para transferir tiene que estar entre 1 hora (60) y una semana (10080).",
    );
  }

  await updateSettings({
    transfer_enabled: enabled ? "true" : "false",
    transfer_alias: alias,
    transfer_cbu: cbu,
    transfer_holder: read("transfer_holder"),
    transfer_bank: read("transfer_bank"),
    transfer_hold_minutes: String(Math.round(minutes)),
    transfer_auto_verify:
      formData.get("transfer_auto_verify") === "on" ? "true" : "false",
  });

  refreshAll();
  revalidatePath("/admin/depositos");
  revalidatePath("/admin/transferencias");

  return enabled
    ? ok("Cobro por transferencia activado.")
    : ok("Cobro por transferencia desactivado.");
}

/**
 * Prueba de credenciales. Le pregunta a Mercado Pago de quién es el token, sin
 * generar ningún cobro, y funciona con el interruptor apagado: sirve para
 * verificar la configuración antes de encenderla.
 */
export async function testMercadoPagoAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const result = await checkMercadoPagoToken();
  if (!result.ok) return error(result.reason);

  const account = result.data.nickname || result.data.email || "la cuenta";

  return ok(
    `Conectado con Mercado Pago (${account}). El token es válido${
      mercadoPagoToken()?.startsWith("TEST-")
        ? " y es de prueba: los pagos no son reales."
        : "."
    }`,
  );
}
