/**
 * Utilidades de fecha y hora.
 *
 * Regla del proyecto: las fechas son cadenas 'YYYY-MM-DD' y las horas son
 * minutos desde la medianoche. No se construyen objetos Date a partir de la
 * hora local del servidor, porque el servidor puede estar en otra zona horaria
 * que el negocio. La única función que mira el reloj real es `nowInTz`.
 */

export const WEEKDAY_NAMES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

export const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** El calendario arranca en lunes, como es costumbre acá. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

export type DateParts = { year: number; month: number; day: number };

export function parseDate(date: string): DateParts {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

export function toDateString({ year, month, day }: DateParts) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isValidDateString(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { year, month, day } = parseDate(date);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** 0 = domingo … 6 = sábado. Calculado en UTC para que no dependa del server. */
export function weekdayOf(date: string) {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(date: string, days: number) {
  const { year, month, day } = parseDate(date);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toDateString({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
}

export function daysBetween(from: string, to: string) {
  const a = parseDate(from);
  const b = parseDate(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Comparación directa: el formato 'YYYY-MM-DD' ordena bien como texto. */
export function isBefore(a: string, b: string) {
  return a < b;
}

export function isWithin(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

/** Fecha y hora actuales en la zona horaria del negocio. */
export function nowInTz(timeZone: string): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const hour = get("hour") % 24; // algunos entornos devuelven 24 a medianoche

  return {
    date: toDateString({
      year: get("year"),
      month: get("month"),
      day: get("day"),
    }),
    minute: hour * 60 + get("minute"),
  };
}

/**
 * Minutos que faltan para un turno. Negativo si ya pasó.
 * Se calcula sobre la grilla local del negocio, sin convertir a UTC, así que
 * es exacto salvo en el salto de horario de verano (que Argentina no usa).
 */
export function minutesUntil(
  date: string,
  minute: number,
  timeZone: string,
): number {
  const now = nowInTz(timeZone);
  return daysBetween(now.date, date) * 1440 + (minute - now.minute);
}

/** 570 → "09:30" */
export function formatMinute(minute: number) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Un instante concreto, como hora del negocio: 1754251200 → "15:40".
 *
 * Es para los vencimientos, que sí son timestamps unix: a diferencia de un
 * turno, "hasta las 15:40" es un momento del reloj real y hay que expresarlo en
 * la zona horaria del negocio, no en la del servidor.
 */
export function formatTimestamp(seconds: number, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(seconds * 1000));
}

/**
 * Un instante con su día, para plazos que cruzan la medianoche.
 *
 * `formatTimestamp` sirve para una retención de minutos, donde "hasta las
 * 15:40" es inequívoco. La de una transferencia dura horas: decir "hasta las
 * 15:40" cuando faltan veintitrés horas hace que la clienta crea que tiene una
 * tarde y en realidad tiene un día entero. Acá va el día también.
 */
export function formatTimestampLong(seconds: number, timeZone: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(seconds * 1000))
    // El formato de es-AR trae comas ("viernes, 21 de agosto, 11:24") que en
    // una frase corrida sobran, y la hora pelada al final se lee mejor con su
    // preposición.
    .replace(/,/g, "")
    .replace(/(\d{1,2}:\d{2})$/, "a las $1");
}

/** "09:30" → 570. Devuelve null si no es una hora válida. */
export function parseMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/** "2026-08-04" → "lunes 4 de agosto" */
export function formatDateLong(date: string, withYear = false) {
  const { year, month, day } = parseDate(date);
  const weekday = WEEKDAY_NAMES[weekdayOf(date)];
  const base = `${weekday} ${day} de ${MONTH_NAMES[month - 1]}`;
  return withYear ? `${base} de ${year}` : base;
}

/** "2026-08-04" → "4 ago" */
export function formatDateShort(date: string) {
  const { month, day } = parseDate(date);
  return `${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`;
}

export function formatMonthYear(year: number, month: number) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Grilla del mes para el calendario: filas de 7 días empezando en lunes.
 * Las celdas fuera del mes son null, así el componente no tiene que calcular
 * nada de fechas.
 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const total = daysInMonth(year, month);
  const firstWeekday = weekdayOf(toDateString({ year, month, day: 1 }));
  const leading = WEEKDAY_ORDER.indexOf(firstWeekday);

  const cells: (string | null)[] = Array(leading).fill(null);
  for (let day = 1; day <= total; day++) {
    cells.push(toDateString({ year, month, day }));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}
