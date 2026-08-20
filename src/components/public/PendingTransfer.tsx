"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { declareTransfer } from "@/app/actions/transfer";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { emptyPaymentState } from "@/lib/action-state";

/**
 * Lo que ve quien reservó y tiene que transferir la seña.
 *
 * La pantalla tiene un solo trabajo: que el importe se transfiera EXACTO, con
 * sus centavos. Esos centavos son lo que identifica el movimiento cuando entra
 * a la cuenta (ver src/lib/transfer.ts); si la clienta redondea, la
 * transferencia llega anónima y hay que resolverla a mano.
 *
 * De ahí las decisiones de diseño de acá:
 *
 *   · El importe se muestra grande y aparte, no dentro de un párrafo.
 *   · Tiene su propio botón de copiar, así el camino fácil es también el
 *     correcto: copiar y pegar en el homebanking no permite redondear.
 *   · Se dice explícitamente que los centavos importan, y por qué. Una
 *     instrucción con motivo se cumple mucho más que una sin motivo.
 */

type Props = {
  token: string;
  /** El importe exacto, ya formateado con sus dos decimales. */
  amount: string;
  alias: string;
  cbu: string;
  holder: string;
  bank: string;
  /** Hasta cuándo se retiene el horario. Ej: "mañana a las 15:40". */
  holdUntil: string;
  /** Ya avisó que transfirió y está esperando que lo verifiquemos. */
  declared: boolean;
};

export function PendingTransfer({
  token,
  amount,
  alias,
  cbu,
  holder,
  bank,
  holdUntil,
  declared,
}: Props) {
  const [state, formAction] = useActionState(declareTransfer, emptyPaymentState);

  // El aviso se refleja en el acto: la acción ya escribió en la base, y
  // esperar a que el servidor devuelva la página de nuevo se siente roto.
  const announced = declared || state.ok;

  return (
    <div className="space-y-3">
      {state.message ? <Alert tone="error">{state.message}</Alert> : null}

      <div className="rounded-sm border border-line bg-surface-sunken p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Icon name="clock" className="size-4 text-ink-muted" />
          Te guardamos el horario hasta {holdUntil}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Transferí la seña antes de esa hora y tu turno queda confirmado.
          Pasado ese plazo el horario vuelve a estar disponible.
        </p>

        {/* El importe, que es lo único que no se puede equivocar. */}
        <div className="mt-3 rounded-sm border border-accent/40 bg-surface p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Importe exacto
          </p>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-xl font-semibold tabular-nums">{amount}</p>
            <CopyButton value={amount.replace(/[^\d,.]/g, "")} label="Copiar" />
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Transferí este importe <strong>con los centavos</strong>. Es lo que
            nos permite reconocer tu pago entre los demás y confirmarte el turno
            sin que tengas que mandarnos nada.
          </p>
        </div>

        <dl className="mt-3 space-y-2">
          {alias ? <DataRow label="Alias" value={alias} copyable /> : null}
          {cbu ? <DataRow label="CBU" value={cbu} copyable /> : null}
          {holder ? <DataRow label="Titular" value={holder} /> : null}
          {bank ? <DataRow label="Banco" value={bank} /> : null}
        </dl>

        {announced ? (
          <div className="mt-3">
            <Alert tone="info" title="Recibimos tu aviso">
              Estamos verificando la transferencia. Apenas la veamos acreditada
              te confirmamos el turno por email. No hace falta que hagas nada
              más.
            </Alert>
          </div>
        ) : (
          <form action={formAction} className="mt-3">
            <input type="hidden" name="token" value={token} />
            <DeclareButton />
            <p className="mt-1.5 text-xs text-ink-muted">
              Avisanos cuando la hayas hecho así la buscamos.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line pt-2">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium tabular-nums">{value}</span>
        {copyable ? <CopyButton value={value} label="Copiar" /> : null}
      </dd>
    </div>
  );
}

/**
 * Copiar al portapapeles.
 *
 * `navigator.clipboard` no existe fuera de un contexto seguro ni en algunos
 * navegadores viejos. Si falla, el botón simplemente no confirma nada y el
 * dato sigue visible para seleccionarlo a mano: no se rompe la pantalla ni se
 * muestra un error por algo que la clienta no puede resolver.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* Sin portapapeles: el dato ya está en pantalla para copiarlo a mano. */
        }
      }}
    >
      {copied ? "¡Copiado!" : label}
    </button>
  );
}

function DeclareButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn btn-primary w-full sm:w-auto"
      disabled={pending}
    >
      {pending ? "Avisando…" : "Ya hice la transferencia"}
    </button>
  );
}
