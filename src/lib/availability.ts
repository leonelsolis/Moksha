import "server-only";

import { and, eq, gte, inArray, lte, ne, or } from "drizzle-orm";

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
            eq(appointments.status, "booked"),
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
        eq(appointments.status, "booked"),
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
