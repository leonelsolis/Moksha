import Link from "next/link";

import { approveTransfer, dismissTransfer } from "@/app/actions/transfer";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { requireUser } from "@/lib/auth";
import {
  formatDateLong,
  formatMinute,
  formatTimestampLong,
} from "@/lib/dates";
import { formatMoneyExact } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { pendingTransfers, transferConfig } from "@/lib/transfer";

/**
 * Las transferencias esperando resolución.
 *
 * La pantalla está armada alrededor de una sola pregunta: "¿entró esta plata?".
 * Por eso el importe exacto es lo más grande de cada fila y no un detalle al
 * costado — es el dato que se compara contra el homebanking, y sus centavos
 * son lo que distingue una fila de otra (ver src/lib/transfer.ts).
 *
 * Confirmar acredita la seña, manda el mail de confirmación y encola el
 * WhatsApp, igual que cualquier turno que se paga. Descartar suelta el horario
 * sin avisarle nada a la clienta.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Transferencias" };

export default async function TransfersPage() {
  const user = await requireUser();
  const settings = await getSettings();
  const config = transferConfig(settings);

  if (!config.enabled) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Transferencias</h1>

        <Alert tone="info">
          El cobro por transferencia está desactivado. Se prende, y se cargan
          los datos de la cuenta, en{" "}
          <Link href="/admin/depositos" className="underline underline-offset-4">
            Señas y cobros
          </Link>
          .
        </Alert>
      </div>
    );
  }

  /*
   * Igual que en la cola de mensajes: entre que sale una versión nueva y que
   * alguien corre las migraciones hay una ventana en la que estas columnas no
   * existen todavía. Se dice qué falta en vez de tirar un 500 sin explicación.
   */
  let pending: Awaited<ReturnType<typeof pendingTransfers>>;

  try {
    pending = await pendingTransfers(user);
  } catch (e) {
    console.error("[transferencia] no se pudo leer la cola:", e);

    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold tracking-tight">Transferencias</h1>

        <Alert tone="error">
          No se pudo leer la lista de transferencias. Si acabás de actualizar el
          sistema, falta correr las migraciones de la base:{" "}
          <code>npm run db:migrate</code>. Todo lo demás sigue funcionando
          normalmente.
        </Alert>
      </div>
    );
  }

  // Las que ya avisaron van primero: son las que hay que mirar ahora.
  const declared = pending.filter((row) => row.declaredAt !== null);
  const silent = pending.filter((row) => row.declaredAt === null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Transferencias</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Reservas esperando que se acredite la seña. Cada una tiene un importe
          con centavos propios: buscá ese número exacto en la cuenta.
        </p>
      </div>

      {!config.ready ? (
        <Alert tone="error" title="Falta a dónde transferir">
          El cobro por transferencia está encendido pero no hay alias ni CBU
          cargado, así que no se le está ofreciendo a nadie. Cargalo en{" "}
          <Link href="/admin/depositos" className="underline underline-offset-4">
            Señas y cobros
          </Link>
          .
        </Alert>
      ) : null}

      {config.autoVerify ? (
        <Alert tone="info" title="La verificación automática está encendida">
          Cada tanto se buscan en Mercado Pago las transferencias entrantes y se
          acreditan las que coinciden al centavo. Acá quedan solo las que el
          automático no pudo resolver: montos redondeados, de menos, o desde una
          cuenta que no es de Mercado Pago.
        </Alert>
      ) : null}

      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">
            Avisaron que transfirieron
            {declared.length > 0 ? (
              <span className="ml-2 text-ink-muted">({declared.length})</span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Verificá el importe en la cuenta antes de confirmar. Al confirmar se
            le manda el mail de turno confirmado.
          </p>
        </div>

        {declared.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-soft">
            No hay transferencias para verificar.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {declared.map((row) => (
              <TransferRow
                key={row.id}
                row={row}
                timezone={settings.timezone}
              />
            ))}
          </ul>
        )}
      </section>

      {silent.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">
              Todavía no transfirieron
              <span className="ml-2 text-ink-muted">({silent.length})</span>
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Reservaron y eligieron transferencia, pero no avisaron. El horario
              les queda guardado hasta el plazo de cada una; después se libera
              solo.
            </p>
          </div>

          <ul className="divide-y divide-line">
            {silent.map((row) => (
              <TransferRow
                key={row.id}
                row={row}
                timezone={settings.timezone}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TransferRow({
  row,
  timezone,
}: {
  row: Awaited<ReturnType<typeof pendingTransfers>>[number];
  timezone: string;
}) {
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
  const when = `${formatDateLong(row.date)} a las ${formatMinute(row.startMinute)}`;

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{name}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {row.serviceName || "Turno"} · {when} · {row.professionalName}
          </p>
          {row.phone ? (
            <p className="mt-0.5 text-xs text-ink-muted">{row.phone}</p>
          ) : null}
        </div>

        {/* El importe: lo que se busca en la cuenta. Va tabular para que los
            centavos de dos filas queden alineados y se comparen de un vistazo. */}
        <p className="text-lg font-semibold tabular-nums">
          {row.transferAmount !== null
            ? formatMoneyExact(row.transferAmount)
            : "—"}
        </p>
      </div>

      <p className="mt-1.5 text-xs text-ink-muted">
        {row.expired ? (
          <span className="text-danger">
            <Icon name="clock" className="mr-1 inline size-3.5" />
            Se venció el plazo: el horario ya está libre.
          </span>
        ) : (
          <>
            <Icon name="clock" className="mr-1 inline size-3.5" />
            Horario guardado hasta{" "}
            {formatTimestampLong(row.holdExpiresAt ?? 0, timezone)}
          </>
        )}
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <ActionForm action={approveTransfer} feedback="none">
          <input type="hidden" name="appointmentId" value={row.id} />
          <SubmitButton className="btn btn-primary btn-sm" pendingLabel="Confirmando…">
            {row.expired ? "Confirmar igual" : "Confirmar turno"}
          </SubmitButton>
        </ActionForm>

        <ActionForm action={dismissTransfer} feedback="none">
          <input type="hidden" name="appointmentId" value={row.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="Descartando…">
            Descartar
          </SubmitButton>
        </ActionForm>
      </div>
    </li>
  );
}
