"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { lookupBooking } from "@/app/actions/booking";
import { emptyLookupState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { formatDateLong, formatMinute } from "@/lib/dates";

/**
 * Búsqueda del turno para quien perdió el link.
 *
 * Pide DNI y email juntos, y ambos tienen que coincidir exactamente con los
 * datos de la reserva. El mensaje cuando no hay resultados es siempre el
 * mismo, así la pantalla no sirve para averiguar si alguien es cliente del
 * local ni qué email usó.
 */
export function LookupForm() {
  const [state, formAction] = useActionState(lookupBooking, emptyLookupState);

  if (state.results.length > 0) {
    return (
      <div className="space-y-3">
        <Alert tone="success" title="Encontramos tu turno">
          Entrá para ver el detalle o cancelarlo.
        </Alert>

        <ul className="space-y-2">
          {state.results.map((result) => (
            <li key={result.token}>
              <Link
                href={`/turno/${result.token}`}
                className="flex items-center justify-between gap-3 rounded-sm border border-line-strong bg-surface p-3 transition-colors hover:bg-surface-sunken"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">
                    {capitalize(formatDateLong(result.date, true))}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-soft tabular">
                    {formatMinute(result.startMinute)} h · {result.professionalName}
                    {result.serviceName ? ` · ${result.serviceName}` : ""}
                  </span>
                </span>
                <Icon name="chevronRight" className="size-4 shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message ? <Alert tone="warning">{state.message}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          name="dni"
          label="DNI"
          inputMode="numeric"
          placeholder="30123456"
          hint="Sin puntos ni espacios"
          maxLength={11}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="nombre@email.com"
          maxLength={200}
        />
      </div>

      <SearchButton />

      <p className="text-xs text-ink-muted">
        Tienen que ser los mismos datos que cargaste al sacar el turno.
      </p>
    </form>
  );
}

function SearchButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn btn-primary w-full sm:w-auto"
      disabled={pending}
    >
      <Icon name="search" className="size-4" />
      {pending ? "Buscando…" : "Buscar mi turno"}
    </button>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
