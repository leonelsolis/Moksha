import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { saveDepositSettings, testMercadoPagoAction } from "@/app/actions/admin";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { DepositForm } from "@/components/admin/DepositForm";
import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { mercadoPagoConfig } from "@/lib/mercadopago";
import { depositFor, formatMoney, holdMinutes } from "@/lib/payments";
import { getSettings } from "@/lib/settings";

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
 * servicio, en Profesionales, porque son el mismo dato del mismo servicio.
 * Acá se listan para poder ver de un vistazo qué se está cobrando.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Señas y cobros" };

export default async function DepositsPage() {
  await requireAdmin();

  const settings = await getSettings();
  const mp = mercadoPagoConfig(settings);

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
          Si se cobra una seña por Mercado Pago al reservar, y cuánto.
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
            href="/admin/profesionales"
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
