"use client";

import { Icon } from "@/components/Icon";
import { formatDateLong } from "@/lib/dates";
import type { PublicProfessionalView } from "@/lib/public-types";

/**
 * Tarjeta de una profesional en el paso de selección.
 *
 * Estado de vacaciones: la foto pasa a escala de grises, el nombre a gris
 * claro, aparece la leyenda "De vacaciones" y la tarjeta deja de ser un botón
 * (`disabled`), así el lector de pantalla también la anuncia como no
 * disponible en lugar de solo verse apagada.
 */

type Props = {
  data: PublicProfessionalView;
  selected: boolean;
  onSelect: () => void;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function ProfessionalCard({ data, selected, onSelect }: Props) {
  const unavailable = data.onVacation || data.services.length === 0;

  const noServices = !data.onVacation && data.services.length === 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={unavailable}
      aria-pressed={selected}
      className={`group flex w-full items-center gap-4 rounded-md border p-3 text-left transition-colors sm:flex-col sm:items-start sm:gap-0 sm:p-0 ${
        unavailable
          ? "cursor-not-allowed border-line bg-surface-sunken"
          : selected
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface hover:border-line-strong hover:bg-surface-sunken"
      }`}
    >
      <div className="relative shrink-0 sm:w-full">
        <div
          className={`size-16 overflow-hidden rounded-sm bg-surface-sunken sm:size-auto sm:aspect-[4/3] sm:w-full sm:rounded-none sm:rounded-t-[5px] ${
            data.onVacation ? "grayscale" : ""
          }`}
        >
          {data.photoUrl ? (
            // Foto cargada por la dueña desde el panel; puede ser una URL
            // externa, así que no se usa next/image para no exigir configurar
            // dominios permitidos.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.photoUrl}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <span
                className={`text-xl font-medium sm:text-3xl ${
                  data.onVacation ? "text-ink-muted" : "text-line-strong"
                }`}
                aria-hidden="true"
              >
                {initials(data.name)}
              </span>
            </div>
          )}
        </div>

        {selected && !unavailable ? (
          <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-accent text-white sm:right-2 sm:top-2">
            <Icon name="check" className="size-3" />
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1 sm:w-full sm:p-3.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={`font-medium ${
              data.onVacation ? "text-ink-muted" : "text-ink"
            }`}
          >
            {data.name}
          </span>

          {data.onVacation ? (
            <span className="badge border-warning-line bg-warning-soft text-warning">
              <Icon name="vacation" className="size-3" />
              De vacaciones
            </span>
          ) : null}
        </div>

        {data.specialty ? (
          <p
            className={`mt-0.5 text-sm ${
              data.onVacation ? "text-ink-muted" : "text-ink-soft"
            }`}
          >
            {data.specialty}
          </p>
        ) : null}

        {data.onVacation && data.vacationUntil ? (
          <p className="mt-1.5 text-xs text-ink-muted">
            Vuelve el {formatDateLong(data.vacationUntil)}
          </p>
        ) : null}

        {noServices ? (
          <p className="mt-1.5 text-xs text-ink-muted">
            Sin turnos disponibles por ahora
          </p>
        ) : null}
      </div>
    </button>
  );
}
