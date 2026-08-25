"use client";

import { useState } from "react";

import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { setMonthDays } from "@/app/actions/admin";
import {
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  parseDate,
  weekdayOf,
} from "@/lib/dates";

/**
 * Carga del mes para las profesionales de horario rotativo.
 *
 * El horario semanal sirve cuando todas las semanas son iguales. Cuando el
 * horario lo pasan armado a comienzo de mes y cambia de un mes al otro, no hay
 * semana típica que cargar: hay treinta días concretos. Esta grilla es para
 * eso. Se tildan los días que comparten horario, se escribe la franja y se
 * guardan juntos; se repite una vez por cada horario distinto —mañana, tarde,
 * franco— hasta que el mes queda cubierto.
 *
 * Debajo del número de cada día se ve qué rige hoy ahí, así que el mes a medio
 * cargar se lee de un vistazo y no hace falta ir día por día a verificar.
 *
 * Lo que guarda son las excepciones por fecha de siempre (ver `setMonthDays`),
 * no un mecanismo nuevo: pisan al horario semanal solo en esos días.
 */

export type DayCell = {
  date: string;
  /** Ya pasó: se muestra, pero no se puede tildar ni modificar. */
  past: boolean;
  /** Qué rige ese día hoy, ya resuelto por el servidor. */
  source: "override" | "weekly" | "none";
  closed: boolean;
  /** "09:00–13:00" o las franjas separadas por coma. Vacío si no atiende. */
  label: string;
  /** Está dentro de un período de vacaciones cargado. */
  onVacation: boolean;
  /** Cuántos turnos ya reservados hay ese día. */
  appointments: number;
};

type Props = {
  professionalId: number;
  monthLabel: string;
  /** Filas de 7 días empezando en lunes; null en las celdas fuera del mes. */
  rows: (DayCell | null)[][];
  today: string;
};

export function MonthSchedule({
  professionalId,
  monthLabel,
  rows,
  today,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const cells = rows.flat().filter((cell): cell is DayCell => cell !== null);
  const editable = cells.filter((cell) => !cell.past);

  function toggle(date: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  /** Tilda todos los días de un día de la semana, o los destilda si ya estaban. */
  function toggleWeekday(weekday: number) {
    const matching = editable.filter((cell) => weekdayOf(cell.date) === weekday);
    if (matching.length === 0) return;

    const allSelected = matching.every((cell) => selected.has(cell.date));

    setSelected((current) => {
      const next = new Set(current);
      for (const cell of matching) {
        if (allSelected) next.delete(cell.date);
        else next.add(cell.date);
      }
      return next;
    });
  }

  const count = selected.size;

  return (
    <ActionForm action={setMonthDays} feedback="bottom" className="p-4">
      <input type="hidden" name="professionalId" value={professionalId} />

      {/* Los días tildados viajan como campos ocultos: los checkboxes de la
          grilla son controlados y no llevan `name`, así el estado vive en un
          solo lugar. */}
      {[...selected].map((date) => (
        <input key={date} type="hidden" name="days" value={date} />
      ))}

      {/* ── Atajos por día de la semana ───────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-ink-soft">Tildar todos los</span>

        {WEEKDAY_ORDER.map((weekday) => (
          <button
            key={weekday}
            type="button"
            onClick={() => toggleWeekday(weekday)}
            className="rounded-sm border border-line-strong bg-surface px-2 py-1 text-xs capitalize text-ink-soft transition-colors hover:bg-surface-sunken"
          >
            {WEEKDAY_SHORT[weekday]}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setSelected(new Set(editable.map((c) => c.date)))}
          className="rounded-sm border border-line-strong bg-surface px-2 py-1 text-xs text-ink-soft transition-colors hover:bg-surface-sunken"
        >
          Todo el mes
        </button>

        {count > 0 ? (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-sm px-2 py-1 text-xs text-ink-soft underline underline-offset-4"
          >
            Destildar todo
          </button>
        ) : null}
      </div>

      {/* ── Grilla del mes ────────────────────────────────────────────── */}
      <div
        className="grid grid-cols-7 gap-1 border-b border-line pb-2"
        aria-hidden="true"
      >
        {WEEKDAY_ORDER.map((weekday) => (
          <div
            key={weekday}
            className="text-center text-xs font-medium capitalize text-ink-muted"
          >
            {WEEKDAY_SHORT[weekday]}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {rows.flat().map((cell, index) => {
          if (!cell) return <div key={`empty-${index}`} aria-hidden="true" />;

          const day = parseDate(cell.date).day;
          const isSelected = selected.has(cell.date);
          const isToday = cell.date === today;

          return (
            <label
              key={cell.date}
              className={`flex min-h-16 cursor-pointer flex-col items-center justify-start gap-0.5 rounded-sm border px-1 py-1.5 text-center transition-colors ${
                cell.past
                  ? "cursor-not-allowed border-line bg-surface-sunken opacity-50"
                  : isSelected
                    ? "border-accent bg-accent-soft"
                    : "border-line-strong bg-surface hover:bg-surface-sunken"
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={isSelected}
                disabled={cell.past}
                onChange={() => toggle(cell.date)}
                aria-label={`${day} de ${monthLabel}${
                  cell.label ? `, ${cell.label}` : ", no atiende"
                }`}
              />

              <span
                className={`text-sm tabular ${
                  isToday ? "font-semibold text-accent" : "font-medium"
                }`}
              >
                {day}
              </span>

              {cell.onVacation ? (
                <span className="text-[10px] leading-tight text-warning">
                  vacaciones
                </span>
              ) : cell.closed ? (
                <span className="text-[10px] leading-tight text-ink-muted">
                  no atiende
                </span>
              ) : (
                <span
                  className={`text-[10px] leading-tight tabular ${
                    cell.source === "override" ? "text-ink" : "text-ink-muted"
                  }`}
                  title={
                    cell.source === "override"
                      ? "Horario cargado para ese día"
                      : "Viene del horario semanal"
                  }
                >
                  {cell.label}
                </span>
              )}

              {cell.appointments > 0 ? (
                <span className="text-[10px] leading-tight text-accent">
                  {cell.appointments}{" "}
                  {cell.appointments === 1 ? "turno" : "turnos"}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        En gris, lo que sale del horario semanal. En negro, lo que ya está
        cargado para esa fecha.
      </p>

      {/* ── Qué hacer con los días tildados ───────────────────────────── */}
      <div className="mt-4 border-t border-line pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="field-label" htmlFor="month-start">
              Atiende de
            </label>
            <input
              id="month-start"
              name="start"
              type="time"
              step={300}
              className="input w-32"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="month-end">
              a
            </label>
            <input
              id="month-end"
              name="end"
              type="time"
              step={300}
              className="input w-32"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="month-start2">
              Y de (opcional)
            </label>
            <input
              id="month-start2"
              name="start2"
              type="time"
              step={300}
              className="input w-32"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="month-end2">
              a
            </label>
            <input
              id="month-end2"
              name="end2"
              type="time"
              step={300}
              className="input w-32"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SubmitButton
            className="btn btn-primary"
            name="mode"
            value="custom"
            disabled={count === 0}
          >
            <Icon name="check" className="size-3.5" />
            Guardar en {count === 0 ? "los días tildados" : `${count} ${count === 1 ? "día" : "días"}`}
          </SubmitButton>

          <SubmitButton
            className="btn btn-secondary"
            name="mode"
            value="closed"
            pendingLabel="…"
            disabled={count === 0}
          >
            No atiende esos días
          </SubmitButton>

          <SubmitButton
            className="btn btn-ghost"
            name="mode"
            value="clear"
            pendingLabel="…"
            disabled={count === 0}
            title="Los días vuelven a regirse por el horario semanal"
          >
            Borrar lo cargado
          </SubmitButton>
        </div>

        <p className="mt-2 text-xs text-ink-muted">
          Guardar reemplaza lo que hubiera en esos días. Si un día tiene mañana
          y tarde, cargá las dos franjas juntas.
        </p>
      </div>
    </ActionForm>
  );
}
