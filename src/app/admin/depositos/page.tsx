import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import {
  saveDepositSettings,
  saveTransferSettings,
  testMercadoPagoAction,
} from "@/app/actions/admin";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { DepositForm } from "@/components/admin/DepositForm";
import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { mercadoPagoConfig } from "@/lib/mercadopago";
import { depositFor, formatMoney, holdMinutes } from "@/lib/payments";
import { getSettings } from "@/lib/settings";
import { transferConfig } from "@/lib/transfer";

/**
 * Señas y cobros online.
 *
 * Todo lo de Mercado Pago junto en una sola pantalla: el interruptor que
 * decide si se cobra, el estado de las credenciales y qué servicios tienen
 * seña cargada. Antes estaba metido en Ajustes entre los datos del negocio y
 * los emails; separarlo es lo que permite prender y apagar el cobro sin tener
 * que releer media pantalla de configuración que no tiene nada que ver.
 *
 * El monto de cada seña NO se edita acá: se carga junto al precio del
 * servicio, en Servicios, porque son el mismo dato del mismo servicio. Acá se
 * listan para poder ver de un vistazo qué se está cobrando.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Señas y cobros" };

export default async function DepositsPage() {
  await requireAdmin();

  const settings = await getSettings();
  const mp = mercadoPagoConfig(settings);
  const transfer = transferConfig(settings);

  const rows = await db
    .select({
      id: services.id,
      name: services.name,
      price: services.price,
      depositAmount: services.depositAmount,
      professionalName: professionals.name,
    })
    .from(services)
    .innerJoin(professionals, eq(services.professionalId, professionals.id))
    .where(eq(services.active, true))
    .orderBy(
      asc(professionals.sortOrder),
      asc(professionals.name),
      asc(services.sortOrder),
      asc(services.id),
    );

  const withDeposit = rows.filter((row) => depositFor(row) > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Señas y cobros</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Si se cobra una seña al reservar, por dónde se paga y cuánto.
        </p>
      </div>

      <DepositForm
        action={saveDepositSettings}
        config={{
          enabled: mp.enabled,
          holdMinutes: holdMinutes(settings),
          hasToken: mp.hasToken,
          isTestToken: mp.isTestToken,
          tokenPreview: mp.tokenPreview,
          servicesWithDeposit: withDeposit.length,
          servicesTotal: rows.length,
        }}
      />

      {/* Fuera del formulario de configuración: un formulario no puede
          contener a otro. */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Probar conexión</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Le pregunta a Mercado Pago a qué cuenta pertenece el token, sin
            cobrarle nada a nadie. Anda con el interruptor apagado, así se puede
            verificar la configuración antes de encenderla.
          </p>
        </div>

        <div className="p-4">
          <ActionForm action={testMercadoPagoAction}>
            <SubmitButton className="btn btn-secondary" pendingLabel="Probando…">
              <Icon name="link" className="size-4" />
              Probar conexión
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

      {/* ── Transferencia bancaria ─────────────────────────────────────
          El otro medio para señar, independiente de Mercado Pago. Los dos
          pueden estar encendidos: la clienta elige al reservar. */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Seña por transferencia</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            A cada clienta se le pide un importe con centavos propios —$5.000,37
            y no $5.000— para poder reconocer su transferencia entre las demás.
            Las que llegan se verifican en{" "}
            <Link
              href="/admin/transferencias"
              className="underline underline-offset-4"
            >
              Transferencias
            </Link>
            .
          </p>
        </div>

        <div className="p-4">
          <ActionForm action={saveTransferSettings} className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="transfer_enabled"
                defaultChecked={transfer.enabled}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Aceptar seña por transferencia
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Aparece como opción al reservar, junto a Mercado Pago si está
                  encendido. Solo en los servicios que tengan seña cargada.
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="transfer_alias">
                  Alias
                </label>
                <input
                  id="transfer_alias"
                  name="transfer_alias"
                  className="input"
                  defaultValue={transfer.alias}
                  placeholder="moksha.turnos"
                  maxLength={60}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="transfer_cbu">
                  CBU o CVU
                </label>
                <input
                  id="transfer_cbu"
                  name="transfer_cbu"
                  className="input tabular"
                  defaultValue={transfer.cbu}
                  placeholder="0000003100000000000000"
                  inputMode="numeric"
                  maxLength={22}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="transfer_holder">
                  Titular de la cuenta
                </label>
                <input
                  id="transfer_holder"
                  name="transfer_holder"
                  className="input"
                  defaultValue={transfer.holder}
                  maxLength={80}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="transfer_bank">
                  Banco o billetera
                </label>
                <input
                  id="transfer_bank"
                  name="transfer_bank"
                  className="input"
                  defaultValue={transfer.bank}
                  placeholder="Mercado Pago"
                  maxLength={60}
                />
              </div>
            </div>

            <p className="text-xs text-ink-muted">
              Con uno de los dos alcanza. Lo que cargues es lo que ve la clienta
              en la pantalla de su turno, así que conviene que el titular
              coincida con el nombre que le va a aparecer al transferir.
            </p>

            <div className="sm:max-w-xs">
              <label className="field-label" htmlFor="transfer_hold_minutes">
                Cuánto tiempo se le guarda el horario (minutos)
              </label>
              <input
                id="transfer_hold_minutes"
                name="transfer_hold_minutes"
                type="number"
                min={60}
                max={10080}
                className="input tabular"
                defaultValue={transfer.holdMinutes}
                required
              />
              <p className="mt-1 text-xs text-ink-muted">
                1440 = un día, que es lo recomendado: una transferencia depende
                del horario del banco, y quien reserva un viernes a la noche
                recién puede pagar el lunes. Vencido el plazo, el horario vuelve
                a estar disponible.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="transfer_auto_verify"
                defaultChecked={transfer.autoVerify}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Verificar las transferencias automáticamente
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Busca en Mercado Pago las transferencias entrantes y confirma
                  sola la que coincide al centavo.{" "}
                  <strong className="font-medium text-ink-soft">
                    Solo encendelo si la cuenta que recibe es de Mercado Pago y
                    ya comprobaste que sus movimientos aparecen en la API
                  </strong>
                  ; con esto apagado, las transferencias se confirman con un
                  clic desde el panel, que funciona siempre.
                </span>
              </span>
            </label>

            <SubmitButton className="btn btn-primary">
              Guardar transferencia
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

      {/* ── Señas por servicio ─────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">Seña de cada servicio</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Un servicio sin seña se reserva sin pagar, aunque el cobro esté
              encendido.
            </p>
          </div>

          <Link
            href="/admin/servicios"
            className="text-sm text-accent underline underline-offset-4"
          >
            Editar montos
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-soft">
            Todavía no hay servicios activos cargados.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((service) => {
              // El mismo saneo que usa el cobro, así la pantalla no puede
              // mostrar una seña que en la práctica no se cobraría.
              const deposit = depositFor(service);

              return (
                <li
                  key={service.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3"
                >
                  <span className="min-w-0">
                    <span className="text-sm">{service.name}</span>
                    <span className="ml-2 text-xs text-ink-muted">
                      {service.professionalName}
                      {service.price != null
                        ? ` · ${formatMoney(service.price)}`
                        : ""}
                    </span>
                  </span>

                  {deposit > 0 ? (
                    <span className="badge border-accent-line bg-accent-soft tabular text-accent">
                      Seña {formatMoney(deposit)}
                    </span>
                  ) : (
                    <span className="badge border-line-strong bg-surface-sunken text-ink-muted">
                      <Icon name="slash" className="size-3" />
                      Sin seña
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
