import "server-only";

import { and, asc, eq, gt, gte, inArray, lt, lte, ne, or } from "drizzle-orm";

import { db } from "@/db";
import {
  appointments,
  professionals,
  scheduleOverrides,
  services,
  vacations,
  workingHours,
  type Professional,
  type Service,
} from "@/db/schema";
import { addDays, isWithin, minutesUntil, weekdayOf } from "./dates";
import { getSettings, settingInt, type Settings } from "./settings";

/**
 * Única fuente de verdad sobre qué horarios están libres.
 *
 * Todo —la web pública, el panel y la validación al confirmar un turno— pasa
 * por acá. Si esta lógica viviera duplicada en la pantalla y en el servidor,
 * tarde o temprano se desincronizarían y aparecerían turnos fantasma.
 *
 * Orden en que se aplican las reglas:
 *   1. La profesional debe estar activa y no de vacaciones ESA fecha.
 *   2. Se toma el horario semanal del día de la semana correspondiente…
 *   3. …salvo que haya una excepción para esa fecha exacta, que lo reemplaza.
 *   4. Se cortan franjas en turnos del largo del servicio elegido.
 *   5. Se descartan los que se solapan con un turno ya reservado.
 *   6. Se descartan los que ya pasaron o no cumplen la antelación mínima.
 */

/**
 * Qué turnos retienen un horario.
 *
 * Son dos: los confirmados y las pre-reservas que todavía están esperando el
 * pago de la seña. Que una pre-reserva ocupe el lugar es justamente el punto:
 * mientras alguien está pagando, ese horario no puede aparecer libre, o dos
 * personas pagarían por el mismo.
 *
 * La retención tiene vencimiento (`hold_expires_at`). Pasado ese momento, la
 * pre-reserva deja de contar acá sin necesidad de que nadie la limpie: quien
 * abrió el checkout y cerró la pestaña no bloquea el horario para siempre.
 * `hold_expires_at` en NULL nunca es mayor que la hora actual, así que una fila
 * vieja sin ese dato tampoco retiene nada.
 */
export function occupiesSlot(now = Math.floor(Date.now() / 1000)) {
  return or(
    eq(appointments.status, "booked"),
    and(
      eq(appointments.status, "pending_payment"),
      gt(appointments.holdExpiresAt, now),
    ),
  );
}

export type SlotStatus = "available" | "taken" | "past";

export type Slot = {
  startMinute: number;
  endMinute: number;
  status: SlotStatus;
};

export type DayAvailability = {
  date: string;
  slots: Slot[];
  /** Slots realmente reservables. Es lo que se muestra en la web pública. */
  openSlots: Slot[];
  closed: boolean;
  closedReason: "vacation" | "no_schedule" | "inactive" | null;
};

type ScheduleRange = { startMinute: number; endMinute: number };

/** Datos del negocio cargados una sola vez y reutilizados en todo el mes. */
type ScheduleContext = {
  professional: Professional;
  duration: number;
  weekly: Map<number, ScheduleRange[]>;
  overrides: Map<string, { kind: "closed" | "custom"; ranges: ScheduleRange[] }>;
  vacationRanges: { startDate: string; endDate: string }[];
  booked: Map<string, ScheduleRange[]>;
  settings: Settings;
};

async function loadContext(
  professional: Professional,
  duration: number,
  fromDate: string,
  toDate: string,
  settings: Settings,
): Promise<ScheduleContext> {
  const [weeklyRows, overrideRows, vacationRows, bookedRows] = await Promise.all(
    [
      db
        .select()
        .from(workingHours)
        .where(eq(workingHours.professionalId, professional.id)),
      db
        .select()
        .from(scheduleOverrides)
        .where(
          and(
            eq(scheduleOverrides.professionalId, professional.id),
            gte(scheduleOverrides.date, fromDate),
            lte(scheduleOverrides.date, toDate),
          ),
        ),
      db
        .select()
        .from(vacations)
        .where(
          and(
            eq(vacations.professionalId, professional.id),
            lte(vacations.startDate, toDate),
            gte(vacations.endDate, fromDate),
          ),
        ),
      db
        .select({
          date: appointments.date,
          startMinute: appointments.startMinute,
          endMinute: appointments.endMinute,
        })
        .from(appointments)
        .where(
          and(
            eq(appointments.professionalId, professional.id),
            occupiesSlot(),
            gte(appointments.date, fromDate),
            lte(appointments.date, toDate),
          ),
        ),
    ],
  );

  const weekly = new Map<number, ScheduleRange[]>();
  for (const row of weeklyRows) {
    const list = weekly.get(row.weekday) ?? [];
    list.push({ startMinute: row.startMinute, endMinute: row.endMinute });
    weekly.set(row.weekday, list);
  }

  const overrides = new Map<
    string,
    { kind: "closed" | "custom"; ranges: ScheduleRange[] }
  >();
  for (const row of overrideRows) {
    const entry = overrides.get(row.date) ?? { kind: row.kind, ranges: [] };
    // Una sola fila 'closed' cierra el día entero, aunque haya otras 'custom'.
    if (row.kind === "closed") entry.kind = "closed";
    if (row.kind === "custom" && row.startMinute != null && row.endMinute != null) {
      entry.ranges.push({
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      });
    }
    overrides.set(row.date, entry);
  }

  const booked = new Map<string, ScheduleRange[]>();
  for (const row of bookedRows) {
    const list = booked.get(row.date) ?? [];
    list.push({ startMinute: row.startMinute, endMinute: row.endMinute });
    booked.set(row.date, list);
  }

  return {
    professional,
    duration,
    weekly,
    overrides,
    vacationRanges: vacationRows.map((v) => ({
      startDate: v.startDate,
      endDate: v.endDate,
    })),
    booked,
    settings,
  };
}

export function isOnVacation(
  professional: Pick<Professional, "onVacation">,
  vacationRanges: { startDate: string; endDate: string }[],
  date: string,
) {
  if (professional.onVacation) return true;
  return vacationRanges.some((v) => isWithin(date, v.startDate, v.endDate));
}

/** Franjas en las que atiende ese día, ya resueltas las excepciones. */
function rangesForDate(ctx: ScheduleContext, date: string): ScheduleRange[] {
  const override = ctx.overrides.get(date);
  if (override) {
    if (override.kind === "closed") return [];
    if (override.ranges.length > 0) return override.ranges;
  }
  return ctx.weekly.get(weekdayOf(date)) ?? [];
}

function overlaps(a: ScheduleRange, b: ScheduleRange) {
  return a.startMinute < b.endMinute && a.endMinute > b.startMinute;
}

function computeDay(ctx: ScheduleContext, date: string): DayAvailability {
  const empty = (reason: DayAvailability["closedReason"]): DayAvailability => ({
    date,
    slots: [],
    openSlots: [],
    closed: true,
    closedReason: reason,
  });

  if (!ctx.professional.active) return empty("inactive");
  if (isOnVacation(ctx.professional, ctx.vacationRanges, date)) {
    return empty("vacation");
  }

  const ranges = rangesForDate(ctx, date);
  if (ranges.length === 0) return empty("no_schedule");

  const taken = ctx.booked.get(date) ?? [];
  const minLeadMinutes =
    settingInt(ctx.settings, "min_hours_before_booking") * 60;
  const timeZone = ctx.settings.timezone;

  const slots: Slot[] = [];
  for (const range of [...ranges].sort((a, b) => a.startMinute - b.startMinute)) {
    for (
      let start = range.startMinute;
      start + ctx.duration <= range.endMinute;
      start += ctx.duration
    ) {
      const slot = { startMinute: start, endMinute: start + ctx.duration };

      let status: SlotStatus = "available";
      if (taken.some((t) => overlaps(slot, t))) {
        status = "taken";
      } else if (minutesUntil(date, start, timeZone) < minLeadMinutes) {
        status = "past";
      }

      slots.push({ ...slot, status });
    }
  }

  slots.sort((a, b) => a.startMinute - b.startMinute);

  return {
    date,
    slots,
    openSlots: slots.filter((s) => s.status === "available"),
    closed: false,
    closedReason: null,
  };
}

/**
 * ¿Entra un turno de este largo justo acá?
 *
 * Es la misma pregunta que contesta `computeDay`, pero para un horario de
 * inicio cualquiera en vez de para la grilla del día. La diferencia importa
 * cuando una visita se reparte entre dos profesionales: la primera empieza en
 * un horario de su grilla, pero la segunda arranca cuando termina la primera,
 * y ese momento no tiene por qué caer en un múltiplo de la duración de la
 * segunda. Preguntar por la grilla ahí escondería huecos que existen.
 *
 * Las reglas son las de siempre y en el mismo orden: profesional activa, sin
 * vacaciones, el turno entero adentro de UNA franja de trabajo —no se puede
 * empezar antes del almuerzo y terminar después—, sin pisar nada tomado y
 * respetando la antelación mínima.
 */
function fitsAt(
  ctx: ScheduleContext,
  date: string,
  startMinute: number,
  duration: number,
): boolean {
  if (!ctx.professional.active) return false;
  if (isOnVacation(ctx.professional, ctx.vacationRanges, date)) return false;

  const slot = { startMinute, endMinute: startMinute + duration };

  const ranges = rangesForDate(ctx, date);
  const insideShift = ranges.some(
    (range) =>
      slot.startMinute >= range.startMinute && slot.endMinute <= range.endMinute,
  );
  if (!insideShift) return false;

  const taken = ctx.booked.get(date) ?? [];
  if (taken.some((t) => overlaps(slot, t))) return false;

  const minLeadMinutes = settingInt(ctx.settings, "min_hours_before_booking") * 60;
  return (
    minutesUntil(date, slot.startMinute, ctx.settings.timezone) >= minLeadMinutes
  );
}

/** Un tramo de la visita: quién atiende y cuánto dura lo que le toca. */
export type AvailabilityLeg = { professional: Professional; duration: number };

/**
 * Los horarios en los que entra una visita repartida entre profesionales.
 *
 * Los tramos van uno detrás del otro, en el orden en que se eligieron: si la
 * primera atiende 60' y la segunda 30', un inicio a las 10:00 significa 10:00
 * con la primera y 11:00 con la segunda. Por eso lo que se devuelve es un solo
 * horario de inicio: es el de la visita entera, y de ahí sale el de cada tramo
 * sumando duraciones.
 *
 * Los candidatos salen de la grilla del PRIMER tramo, que es la que la clienta
 * ve y elige; los demás se comprueban con `fitsAt`, porque su horario ya no lo
 * elige nadie sino que lo fija el tramo anterior.
 *
 * Con un solo tramo devuelve exactamente los horarios de siempre: la grilla
 * del primero sin ningún filtro extra.
 */
export async function getChainAvailability(options: {
  legs: AvailabilityLeg[];
  fromDate: string;
  toDate: string;
  settings?: Settings;
}): Promise<Map<string, number[]>> {
  const settings = options.settings ?? (await getSettings());

  const contexts = await Promise.all(
    options.legs.map((leg) =>
      loadContext(
        leg.professional,
        leg.duration,
        options.fromDate,
        options.toDate,
        settings,
      ),
    ),
  );

  const result = new Map<string, number[]>();
  if (contexts.length === 0) return result;

  for (
    let date = options.fromDate;
    date <= options.toDate;
    date = addDays(date, 1)
  ) {
    const starts = computeDay(contexts[0], date)
      .openSlots.map((slot) => slot.startMinute)
      .filter((start) => chainFits(contexts, options.legs, date, start));

    if (starts.length > 0) result.set(date, starts);
  }

  return result;
}

/** ¿Entran todos los tramos, uno detrás del otro, empezando a esta hora? */
function chainFits(
  contexts: ScheduleContext[],
  legs: AvailabilityLeg[],
  date: string,
  startMinute: number,
): boolean {
  let start = startMinute;
  for (let index = 0; index < legs.length; index++) {
    // El primero ya salió de la grilla, que es un filtro más estricto que este.
    if (index > 0 && !fitsAt(contexts[index], date, start, legs[index].duration)) {
      return false;
    }
    start += legs[index].duration;
  }
  return true;
}

/**
 * Verificación final de una visita repartida, antes de guardar nada.
 *
 * Es a `getChainAvailability` lo que `isSlotBookable` es a la disponibilidad de
 * un día: se corre en el servidor sobre datos frescos, porque entre que la
 * pantalla mostró el horario y la clienta confirmó pudo tomarlo otra persona.
 */
export async function isChainBookable(options: {
  legs: AvailabilityLeg[];
  date: string;
  startMinute: number;
  settings: Settings;
}): Promise<boolean> {
  const starts = await getChainAvailability({
    legs: options.legs,
    fromDate: options.date,
    toDate: options.date,
    settings: options.settings,
  });

  return (starts.get(options.date) ?? []).includes(options.startMinute);
}

/** Ventana de fechas reservables según la configuración del negocio. */
export function bookingWindow(settings: Settings, today: string) {
  return {
    from: today,
    to: addDays(today, settingInt(settings, "booking_window_days", 1)),
  };
}

export async function getDayAvailability(options: {
  professional: Professional;
  duration: number;
  date: string;
  settings?: Settings;
}): Promise<DayAvailability> {
  const settings = options.settings ?? (await getSettings());
  const ctx = await loadContext(
    options.professional,
    options.duration,
    options.date,
    options.date,
    settings,
  );
  return computeDay(ctx, options.date);
}

/**
 * Disponibilidad de un rango completo, en una sola tanda de consultas.
 * El calendario lo usa para saber qué días ofrecer sin pedir día por día.
 */
export async function getRangeAvailability(options: {
  professional: Professional;
  duration: number;
  fromDate: string;
  toDate: string;
  settings?: Settings;
}): Promise<Map<string, DayAvailability>> {
  const settings = options.settings ?? (await getSettings());
  const ctx = await loadContext(
    options.professional,
    options.duration,
    options.fromDate,
    options.toDate,
    settings,
  );

  const result = new Map<string, DayAvailability>();
  for (
    let date = options.fromDate;
    date <= options.toDate;
    date = addDays(date, 1)
  ) {
    result.set(date, computeDay(ctx, date));
  }
  return result;
}

/**
 * Verificación final antes de confirmar. Se ejecuta en el servidor sobre los
 * datos frescos: que el navegador haya mostrado el horario como libre no
 * alcanza, porque entre que se cargó la pantalla y se confirmó pudo haberlo
 * tomado otra persona.
 */
export async function isSlotBookable(options: {
  professional: Professional;
  duration: number;
  date: string;
  startMinute: number;
  settings: Settings;
}): Promise<boolean> {
  const day = await getDayAvailability(options);
  return day.openSlots.some((s) => s.startMinute === options.startMinute);
}

/** Profesionales visibles en la web pública, con sus servicios activos. */
export async function getPublicProfessionals(today: string) {
  const rows = await db
    .select()
    .from(professionals)
    .where(eq(professionals.active, true));

  if (rows.length === 0) return [];

  const ids = rows.map((p) => p.id);

  const [serviceRows, vacationRows] = await Promise.all([
    db
      .select()
      .from(services)
      .where(and(inArray(services.professionalId, ids), eq(services.active, true))),
    db
      .select()
      .from(vacations)
      .where(
        and(
          inArray(vacations.professionalId, ids),
          gte(vacations.endDate, today),
        ),
      ),
  ]);

  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((professional) => {
      const own = vacationRows.filter(
        (v) => v.professionalId === professional.id,
      );
      const current = own.find((v) => isWithin(today, v.startDate, v.endDate));

      return {
        professional,
        services: serviceRows
          .filter((s) => s.professionalId === professional.id)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
        onVacation: isOnVacation(professional, own, today),
        /** Para el mensaje "Vuelve el 12 de agosto". */
        vacationUntil: current?.endDate ?? null,
      };
    });
}

export type PublicProfessional = Awaited<
  ReturnType<typeof getPublicProfessionals>
>[number];

/** Duración a usar cuando la profesional tiene un único servicio. */
export function defaultService(list: Service[]) {
  return list.length === 1 ? list[0] : null;
}

/**
 * Los turnos que chocan con un rango horario.
 *
 * Dos turnos se solapan cuando el nuevo empieza antes de que termine el otro y
 * termina después de que el otro empieza. Escrito así cubre los tres casos de
 * una sola vez: el que arranca en el medio del anterior, el que lo contiene
 * entero y el que empieza igual. Dos turnos pegados —uno termina 11:00 y el
 * otro empieza 11:00— no se solapan, que es justamente como se llena una
 * agenda.
 *
 * Solo cuentan los turnos que retienen el horario (`occupiesSlot`): uno
 * cancelado o una pre-reserva vencida no bloquean nada.
 *
 * Es la comprobación que da el mensaje —"choca con el turno de 10:00 a 11:00"—,
 * no la que garantiza que no haya dos turnos encima. Esa garantía la dan la
 * inserción condicional y el índice único parcial, porque entre esta consulta y
 * el alta hay una ventana en la que otra persona puede reservar.
 */
export async function overlappingAppointments(options: {
  professionalId: number;
  date: string;
  startMinute: number;
  endMinute: number;
  /** Para reprogramar: el turno que se está moviendo no choca consigo mismo. */
  excludeId?: number;
}) {
  return db
    .select({
      id: appointments.id,
      startMinute: appointments.startMinute,
      endMinute: appointments.endMinute,
      firstName: appointments.firstName,
      lastName: appointments.lastName,
      serviceName: appointments.serviceName,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.professionalId, options.professionalId),
        eq(appointments.date, options.date),
        occupiesSlot(),
        options.excludeId ? ne(appointments.id, options.excludeId) : undefined,
        lt(appointments.startMinute, options.endMinute),
        gt(appointments.endMinute, options.startMinute),
      ),
    )
    .orderBy(asc(appointments.startMinute));
}

/**
 * Da de baja las pre-reservas de ese día a las que se les venció el plazo de
 * pago. El horario ya estaba libre para la disponibilidad —que ignora las
 * retenciones vencidas—, pero la fila seguía ocupando el índice único, que no
 * puede mirar la hora. Es una limpieza puntual, sobre un solo día y una sola
 * profesional; no hace falta ningún proceso aparte.
 *
 * Corre antes de cada alta, venga de la web o del panel. Si falla, no pasa
 * nada: en el peor caso el alta choca contra el índice y quien reserva ve el
 * mismo mensaje que ante cualquier horario ya tomado.
 */
export async function releaseExpiredHolds(
  professionalId: number,
  date: string,
  now = Math.floor(Date.now() / 1000),
) {
  await db
    .update(appointments)
    .set({ status: "expired_payment" })
    .where(
      and(
        eq(appointments.professionalId, professionalId),
        eq(appointments.date, date),
        eq(appointments.status, "pending_payment"),
        lte(appointments.holdExpiresAt, now),
      ),
    )
    .catch(() => undefined);
}

/** Turnos que chocan con un rango dado. Usado por el chequeo transaccional. */
export async function conflictingAppointmentIds(options: {
  professionalId: number;
  date: string;
  startMinute: number;
  endMinute: number;
  excludeId?: number;
}) {
  const rows = await db
    .select({
      id: appointments.id,
      startMinute: appointments.startMinute,
      endMinute: appointments.endMinute,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.professionalId, options.professionalId),
        eq(appointments.date, options.date),
        occupiesSlot(),
        options.excludeId ? ne(appointments.id, options.excludeId) : undefined,
        or(
          // Solapamiento: empieza antes de que el otro termine y termina después
          // de que el otro empiece.
          and(
            lte(appointments.startMinute, options.startMinute),
            gte(appointments.endMinute, options.startMinute + 1),
          ),
          and(
            gte(appointments.startMinute, options.startMinute),
            lte(appointments.startMinute, options.endMinute - 1),
          ),
        ),
      ),
    );

  return rows.map((r) => r.id);
}
