"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { cancelBooking } from "@/app/actions/booking";
import { emptyCancelState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";

/**
 * Acciones sobre un turno propio: copiar el link y cancelar.
 *
 * La cancelación pide una confirmación explícita antes de ejecutarse. Es una
 * acción que no se puede deshacer —el horario queda liberado y lo puede tomar
 * otra persona— así que no debería dispararse por un toque accidental.
 */

type Props = {
  token: string;
  canCancel: boolean;
  /** Motivo por el que no se puede cancelar, si corresponde. */
  blockedReason: string | null;
  /** Hay una seña cobrada: se avisa que cancelar no la devuelve. */
  depositPaid?: boolean;
  /**
   * Qué turno se cancela, cuando no es el del link.
   *
   * Una visita repartida entre profesionales tiene un solo link —el del primer
   * tramo— y desde él se ven y se cancelan todos. El servidor comprueba que el
   * id sea de la misma visita que el token; ver `cancelBooking`.
   */
  appointmentId?: number;
  /** El link para volver. Se muestra una sola vez por pantalla. */
  showLink?: boolean;
  /** Texto del botón, para distinguir de cuál de los tramos es. */
  cancelLabel?: string;
};

export function ManageAppointment({
  token,
  canCancel,
  blockedReason,
  depositPaid = false,
  appointmentId,
  showLink = true,
  cancelLabel = "Cancelar turno",
}: Props) {
  const [state, formAction] = useActionState(cancelBooking, emptyCancelState);
  const [confirming, setConfirming] = useState(false);

  if (state.ok) {
    return (
      <Alert tone="success" title="Turno cancelado">
        {state.message} El horario ya quedó libre para otra persona.
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}

      {showLink ? <CopyLink token={token} /> : null}

      {canCancel ? (
        confirming ? (
          <div className="rounded-sm border border-danger-line bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">
              ¿Seguro que querés cancelar este turno?
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              El horario se libera enseguida y puede tomarlo otra persona. Esto
              no se puede deshacer.
              {depositPaid
                ? " En caso de cancelación no se reembolsa la seña."
                : ""}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <form action={formAction}>
                <input type="hidden" name="token" value={token} />
                {appointmentId ? (
                  <input type="hidden" name="appointmentId" value={appointmentId} />
                ) : null}
                <ConfirmButton />
              </form>

              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setConfirming(false)}
              >
                No, mantener el turno
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger w-full sm:w-auto"
            onClick={() => setConfirming(true)}
          >
            {cancelLabel}
          </button>
        )
      ) : blockedReason ? (
        <Alert tone="warning" title="No se puede cancelar online">
          {blockedReason}
        </Alert>
      ) : null}
    </div>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn btn-sm border-danger bg-danger text-white hover:bg-danger/90"
      disabled={pending}
    >
      {pending ? "Cancelando…" : "Sí, cancelar turno"}
    </button>
  );
}

function CopyLink({ token }: { token: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // La URL absoluta se arma en el navegador: así funciona igual en desarrollo,
  // en el celular por red local o en el dominio final, sin configurar nada.
  useEffect(() => {
    setUrl(`${globalThis.location.origin}/turno/${token}`);
  }, [token]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles (o sin HTTPS): se selecciona el texto para
      // que se pueda copiar a mano.
      const field = document.getElementById("manage-url");
      if (field instanceof HTMLInputElement) field.select();
    }
  }

  return (
    <div className="rounded-sm border border-line bg-surface-sunken p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Icon name="link" className="size-4 text-ink-muted" />
        Link para ver o cancelar tu turno
      </p>
      <p className="mt-1 text-xs text-ink-soft">
        Guardalo. Es personal: solo con este link se puede acceder a tu turno.
      </p>

      <div className="mt-2.5 flex gap-2">
        <input
          id="manage-url"
          readOnly
          value={url}
          className="input min-w-0 flex-1 bg-surface text-xs"
          aria-label="Link de tu turno"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm shrink-0"
          onClick={copy}
        >
          <Icon name={copied ? "check" : "copy"} className="size-3.5" />
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
