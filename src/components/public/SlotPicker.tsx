"use client";

import { Icon } from "@/components/Icon";
import { formatMinute } from "@/lib/dates";

/**
 * Grilla de horarios libres.
 *
 * Solo aparecen los horarios que se pueden reservar. Los ocupados no se
 * muestran: mostrarlos tachados llena la pantalla de opciones inútiles y en
 * el celular obliga a scrollear para encontrar las que sirven.
 */

type Props = {
  slots: number[];
  duration: number;
  selected: number | null;
  onSelect: (startMinute: number) => void;
};

/** Agrupar por franja evita una lista larga y plana de 20 horarios. */
function groupSlots(slots: number[]) {
  const groups: { label: string; slots: number[] }[] = [
    { label: "Mañana", slots: [] },
    { label: "Tarde", slots: [] },
    { label: "Noche", slots: [] },
  ];

  for (const minute of slots) {
    if (minute < 12 * 60) groups[0].slots.push(minute);
    else if (minute < 18 * 60) groups[1].slots.push(minute);
    else groups[2].slots.push(minute);
  }

  return groups.filter((group) => group.slots.length > 0);
}

export function SlotPicker({ slots, duration, selected, onSelect }: Props) {
  if (slots.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-sm border border-line bg-surface-sunken p-3 text-sm text-ink-soft">
        <Icon name="info" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
        <p>No quedan horarios libres este día. Probá con otra fecha.</p>
      </div>
    );
  }

  const groups = groupSlots(slots);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label}>
          {groups.length > 1 ? (
            <p className="mb-2 text-xs font-medium text-ink-muted">
              {group.label}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {group.slots.map((minute) => {
              const isSelected = minute === selected;

              return (
                <button
                  key={minute}
                  type="button"
                  onClick={() => onSelect(minute)}
                  aria-pressed={isSelected}
                  aria-label={`${formatMinute(minute)}, duración ${duration} minutos`}
                  className={`flex h-11 items-center justify-center gap-1.5 rounded-sm border text-sm tabular transition-colors ${
                    isSelected
                      ? "border-accent bg-accent font-semibold text-white"
                      : "border-line-strong bg-surface font-medium text-ink hover:border-accent hover:bg-accent-soft"
                  }`}
                >
                  {isSelected ? (
                    <Icon name="check" className="size-3.5" />
                  ) : null}
                  {formatMinute(minute)}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-ink-muted">
        Cada turno dura {duration} minutos.
      </p>
    </div>
  );
}
