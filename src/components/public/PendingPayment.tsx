"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { resumeDepositCheckout } from "@/app/actions/payment";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { emptyPaymentState } from "@/lib/action-state";

/**
 * Lo que ve quien reservó pero todavía no pagó la seña.
 *
 * El botón vuelve a mandar al checkout de Mercado Pago: sirve tanto para quien
 * cerró la pestaña como para quien volvió con el pago rechazado. Cuando sale
 * bien no hay nada que renderizar acá, porque la acción redirige.
 */

type Props = {
  token: string;
  /** Importe de la seña, ya formateado. */
  amount: string;
  /** Hora hasta la que se retiene el horario. Ej: "15:40". */
  holdUntil: string;
  /** Volvimos de Mercado Pago y el pago todavía se está acreditando. */
  awaitingApproval: boolean;
};

export function PendingPayment({
  token,
  amount,
  holdUntil,
  awaitingApproval,
}: Props) {
  const [state, formAction] = useActionState(
    resumeDepositCheckout,
    emptyPaymentState,
  );

  return (
    <div className="space-y-3">
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}

      {awaitingApproval ? (
        <Alert tone="info" title="Estamos confirmando tu pago">
          Mercado Pago todavía no nos avisó que se acreditó. Puede tardar unos
          minutos: volvé a abrir este link más tarde y vas a ver el turno
          confirmado.
        </Alert>
      ) : null}

      <div className="rounded-sm border border-line bg-surface-sunken p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Icon name="clock" className="size-4 text-ink-muted" />
          Te guardamos el horario hasta las {holdUntil}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Pasada esa hora, el horario vuelve a estar disponible para otra
          persona. No se te cobra nada si no pagás.
        </p>

        <form action={formAction} className="mt-3">
          <input type="hidden" name="token" value={token} />
          <PayButton amount={amount} />
        </form>
      </div>
    </div>
  );
}

function PayButton({ amount }: { amount: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn btn-primary w-full sm:w-auto"
      disabled={pending}
    >
      {pending ? "Abriendo Mercado Pago…" : `Pagar la seña de ${amount}`}
    </button>
  );
}
