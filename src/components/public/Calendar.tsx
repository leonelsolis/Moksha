"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/Icon";
import {
  WEEKDAY_ORDER,
  WEEKDAY_SHORT,
  daysInMonth,
  formatDateLong,
  formatMonthYear,
  monthGrid,
  parseDate,
  toDateString,
} from "@/lib/dates";

/**
 * Calendario de selección de fecha.
 *
 * Un día solo es clickeable si tiene al menos un horario libre. Los demás se
 * muestran apagados y con `disabled`, para que quede claro de un vistazo qué
 * días tienen lugar sin tener que entrar a probar uno por uno.
 */

type Props = {
  today: string;
  lastDate: string;
  availableDates: Set<string>;
  selected: string | null;
  loading: boolean;
  onSelect: (date: string) => void;
};

export function Calendar({
  today,
  lastDate,
  availableDates,
  selected,
  loading,
  onSelect,
}: Props) {
  const start = parseDate(selected ?? today);
  const [cursor, setCursor] = useState({
    year: start.year,
    month: start.month,
  });

  const rows = useMemo(
    () => monthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const firstOfMonth = toDateString({ ...cursor, day: 1 });
  const lastOfMonth = toDateString({
    ...cursor,
    day: daysInMonth(cursor.year, cursor.month),
  });

  // Solo se puede navegar dentro de la ventana de reserva configurada.
  const canGoBack = firstOfMonth > today;
  const canGoForward = lastOfMonth < lastDate;

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const month = current.month + delta;
      if (month < 1) return { year: current.year - 1, month: 12 };
      if (month > 12) return { year: current.year + 1, month: 1 };
      return { ...current, month };
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Mes anterior"
        >
          <Icon name="chevronLeft" className="size-4" />
        </button>

        <span
          className="text-sm font-medium capitalize"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatMonthYear(cursor.year, cursor.month)}
        </span>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => shiftMonth(1)}
          disabled={!canGoForward}
          aria-label="Mes siguiente"
        >
          <Icon name="chevronRight" className="size-4" />
        </button>
      </div>

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

      <div className={`mt-2 grid grid-cols-7 gap-1 ${loading ? "opacity-40" : ""}`}>
        {rows.flat().map((date, index) => {
          if (!date) return <div key={`empty-${index}`} aria-hidden="true" />;

          const day = parseDate(date).day;
          const isAvailable = availableDates.has(date);
          const isSelected = date === selected;
          const isToday = date === today;

          return (
            <button
              key={date}
              type="button"
              disabled={!isAvailable || loading}
              onClick={() => onSelect(date)}
              aria-label={`${formatDateLong(date)}${
                isAvailable ? "" : ", sin turnos disponibles"
              }`}
              aria-current={isToday ? "date" : undefined}
              className={`relative flex h-11 items-center justify-center rounded-sm border text-sm tabular transition-colors ${
                isSelected
                  ? "border-accent bg-accent font-semibold text-white"
                  : isAvailable
                    ? "border-line-strong bg-surface font-medium text-ink hover:border-accent hover:bg-accent-soft"
                    : "cursor-not-allowed border-transparent bg-transparent text-ink-muted/55"
              }`}
            >
              {day}

              {/* Punto: refuerza "hay lugar" sin depender solo del contraste. */}
              {isAvailable && !isSelected ? (
                <span
                  className="absolute bottom-1.5 size-1 rounded-full bg-accent"
                  aria-hidden="true"
                />
              ) : null}

              {isToday && !isSelected ? (
                <span className="absolute inset-x-2 top-1 h-px bg-line-strong" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
        <span className="size-1 rounded-full bg-accent" aria-hidden="true" />
        Los días con punto tienen horarios libres
      </p>
    </div>
  );
}
