"use client";

import { useState } from "react";

import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import type { ActionState } from "@/lib/action-state";

/**
 * El interruptor de las señas.
 *
 * Es la única pantalla del panel que decide si la web cobra o no cobra, así
 * que el interruptor va arriba de todo y en grande: quien entra acá viene a
 * prenderlo o a apagarlo, no a leer.
 *
 * Es un componente cliente por una sola razón: el aviso de "está desactivado"
 * tiene que cambiar al mover el interruptor, no al guardar. Si el estado real
 * y lo que dice la pantalla se despegan aunque sea por un instante, deja de
 * quedar claro si el negocio está cobrando o no, que es justo lo que esta
 * pantalla existe para contestar.
 *
 * El token NO se edita acá: se explica cómo cargarlo como variable de entorno.
 * El motivo está en `ACCESS_TOKEN_HELP`.
 */

export type DepositConfig = {
  /** `mp_enabled` tal como está guardado. */
  enabled: boolean;
  /** Minutos que se retiene el horario esperando el pago. */
  holdMinutes: number;
  hasToken: boolean;
  isTestToken: boolean;
  /** El token tapado, o null si no hay ninguno cargado. */
  tokenPreview: string | null;
  /** Cuántos servicios tienen una seña cargada, sobre el total activo. */
  servicesWithDeposit: number;
  servicesTotal: number;
};

/** El nombre exacto de la variable, en un solo lugar para no equivocarlo. */
export const ACCESS_TOKEN_ENV = "MERCADOPAGO_ACCESS_TOKEN";

export function DepositForm({
  action,
  config,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  config: DepositConfig;
}) {
  const [enabled, setEnabled] = useState(config.enabled);

  // Lo que va a pasar si se guarda así: sin token no se cobra aunque el
  // interruptor quede encendido.
  const willCharge = enabled && config.hasToken;
  const unsaved = enabled !== config.enabled;

  return (
    <ActionForm action={action} className="space-y-5" feedback="top">
      {/* ── El interruptor ────────────────────────────────────────────── */}
      <section
        className={`panel overflow-hidden transition-colors ${
          enabled ? "border-accent-line" : ""
        }`}
      >
        {/*
          El interruptor NO va envuelto en un <label>.
          Con el input adentro, un clic sobre la parte visible se reenvía al
          input y vuelve a burbujear al label, que lo reenvía otra vez: alterna
          dos veces y queda igual que antes. Se etiqueta con `htmlFor` desde
          afuera, que es lo mismo para el lector de pantalla y alterna una vez.
        */}
        <div
          className={`flex items-start justify-between gap-4 p-4 transition-colors ${
            enabled ? "bg-accent-soft" : "bg-surface-sunken"
          }`}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <label
                htmlFor="mp_enabled"
                className="cursor-pointer text-base font-semibold tracking-tight"
              >
                Cobrar seña con Mercado Pago
              </label>

              {/*
                Tres estados, no dos: encendido sin token no cobra nada, y
                decir "Activado" ahí sería mentira. El aviso de abajo explica
                por qué.
              */}
              <span
                className={`badge ${
                  willCharge
                    ? "border-accent-line bg-surface text-accent"
                    : enabled
                      ? "border-danger-line bg-surface text-danger"
                      : "border-line-strong bg-surface text-ink-muted"
                }`}
              >
                <Icon name={willCharge ? "check" : "slash"} className="size-3" />
                {willCharge
                  ? "Activado"
                  : enabled
                    ? "Sin efecto: falta el token"
                    : "Desactivado"}
              </span>

              {unsaved ? (
                <span className="badge border-warning-line bg-warning-soft text-warning">
                  Sin guardar
                </span>
              ) : null}
            </div>

            <p id="mp-switch-help" className="mt-1 text-sm text-ink-soft">
              Con esto encendido, la clienta paga la seña antes de que el turno
              quede confirmado. Apagado, la web reserva como siempre y no se le
              cobra nada a nadie.
            </p>
          </div>

          {/*
            El input real está tapado pero sigue siendo un checkbox nativo: se
            enfoca con tabulador, se activa con la barra espaciadora y viaja en
            el formulario solo. Lo que se ve son sus dos hermanos, pintados con
            `peer-checked`; tienen que ser hermanos y no hijos porque el
            selector de Tailwind es `~`, que no alcanza a los descendientes.

            La pista es el <label> —así se puede tocar—, y el círculo va con
            `pointer-events-none` para que el clic la atraviese en vez de caer
            sobre un adorno que no hace nada.
          */}
          <span className="relative inline-flex h-7 w-12 shrink-0 items-center">
            <input
              id="mp_enabled"
              type="checkbox"
              role="switch"
              name="mp_enabled"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              aria-describedby="mp-switch-help"
              className="peer sr-only"
            />
            <label
              htmlFor="mp_enabled"
              aria-hidden
              className="absolute inset-0 cursor-pointer rounded-full border border-line-strong bg-surface transition-colors peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-accent)]"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute left-1 size-5 rounded-full bg-surface ring-1 ring-line-strong transition-transform peer-checked:translate-x-5 peer-checked:ring-transparent"
            />
          </span>
        </div>

        <div className="space-y-3 border-t border-line p-4">
          <StatusNotice enabled={enabled} config={config} />

          <div className="max-w-xs">
            <label className="field-label" htmlFor="mp_hold_minutes">
              Minutos para pagar la seña
            </label>
            <input
              id="mp_hold_minutes"
              name="mp_hold_minutes"
              type="number"
              min={5}
              max={1440}
              className="input tabular"
              defaultValue={config.holdMinutes}
              required
              disabled={!enabled}
            />
            <p className="mt-1 text-xs text-ink-muted">
              Cuánto se le guarda el horario mientras paga. Vencido el plazo, la
              reserva se descarta sola y el horario vuelve a estar disponible.
              Entre 5 minutos y 24 horas.
            </p>
          </div>
        </div>
      </section>

      {/* ── Credenciales ──────────────────────────────────────────────── */}
      <AccessTokenSection config={config} />

      <SubmitButton className="btn btn-primary">
        Guardar configuración de cobros
      </SubmitButton>
    </ActionForm>
  );
}

/* ── El aviso de estado ───────────────────────────────────────────────── */

/**
 * Qué va a pasar con los turnos, en una sola frase.
 *
 * Reacciona al interruptor en vivo, no a lo guardado: el aviso de "está
 * desactivado" tiene que aparecer en el momento en que se apaga.
 */
function StatusNotice({
  enabled,
  config,
}: {
  enabled: boolean;
  config: DepositConfig;
}) {
  if (!enabled) {
    return (
      <Alert tone="warning" title="Cobros desactivados">
        Los pagos y señas están desactivados. Todos los turnos se confirmarán
        automáticamente sin requerir seña.
      </Alert>
    );
  }

  if (!config.hasToken) {
    return (
      <Alert tone="error" title="Falta el Access Token">
        No se va a cobrar nada aunque el interruptor quede encendido: sin{" "}
        <code>{ACCESS_TOKEN_ENV}</code> cargado en el servidor, los turnos se
        confirman igual y sin seña. Cargalo siguiendo los pasos de acá abajo.
      </Alert>
    );
  }

  if (config.servicesWithDeposit === 0) {
    return (
      <Alert tone="warning" title="Ningún servicio tiene seña cargada">
        El cobro está listo, pero todos los servicios tienen la seña en blanco,
        así que no se le pide nada a nadie. Cargá el monto en Servicios.
      </Alert>
    );
  }

  if (config.isTestToken) {
    return (
      <Alert tone="warning" title="Credenciales de prueba">
        Se está cobrando con un token <code>TEST-</code>: los pagos no son
        reales y la plata no entra a ninguna cuenta. Cambialo por el de
        producción cuando quieras empezar a cobrar de verdad.
      </Alert>
    );
  }

  return (
    <Alert tone="success" title="Cobros activos">
      Se está pidiendo la seña en {config.servicesWithDeposit} de{" "}
      {config.servicesTotal}{" "}
      {config.servicesTotal === 1 ? "servicio" : "servicios"}. El turno queda
      confirmado recién cuando Mercado Pago aprueba el pago.
    </Alert>
  );
}

/* ── Credenciales ─────────────────────────────────────────────────────── */

const ACCESS_TOKEN_HELP =
  "El token es la llave que permite cobrar en nombre del negocio, así que no se guarda en la base de datos ni se edita desde el panel: va como variable de entorno en el servidor, donde no queda a la vista de nadie que entre acá.";

function AccessTokenSection({ config }: { config: DepositConfig }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium">Credenciales de Mercado Pago</h2>
        <p className="mt-0.5 text-xs text-ink-soft">{ACCESS_TOKEN_HELP}</p>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="mp-env-name">
              Nombre de la variable
            </label>
            <CopyField id="mp-env-name" value={ACCESS_TOKEN_ENV} />
            <p className="mt-1 text-xs text-ink-muted">
              Escribilo exactamente así, sin espacios.
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="mp-token-preview">
              Token cargado ahora
            </label>
            <input
              id="mp-token-preview"
              className="input tabular bg-surface-sunken text-ink-soft"
              value={config.tokenPreview ?? "— sin cargar —"}
              readOnly
              aria-describedby="mp-token-state"
            />
            <p id="mp-token-state" className="mt-1 text-xs text-ink-muted">
              {config.hasToken
                ? config.isTestToken
                  ? "Es un token de prueba (TEST-). Sirve para probar el flujo completo con tarjetas de prueba."
                  : "Es un token de producción. Los pagos son reales."
                : "Todavía no hay ninguno en el servidor."}
            </p>
          </div>
        </div>

        <details className="rounded-sm border border-line bg-surface-sunken">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
            Cómo conseguir y cargar el Access Token
          </summary>

          <ol className="list-decimal space-y-2 py-3 pl-9 pr-4 text-sm text-ink-soft">
            <li>
              Entrá a{" "}
              <a
                href="https://www.mercadopago.com.ar/developers/panel"
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4"
              >
                mercadopago.com.ar/developers/panel
              </a>{" "}
              con la cuenta del negocio y creá una aplicación de Checkout Pro.
            </li>
            <li>
              En <strong>Credenciales de prueba</strong> copiá el{" "}
              <em>Access Token</em>: empieza con <code>TEST-</code> y sirve para
              probar sin mover plata real.
            </li>
            <li>
              Cargalo en el servidor con el nombre <code>{ACCESS_TOKEN_ENV}</code>
              . En Vercel: <strong>Settings → Environment Variables</strong>, y
              después volvé a desplegar para que tome el valor nuevo.
            </li>
            <li>
              Volvé a esta pantalla, tocá <strong>Probar conexión</strong> y
              fijate que reconozca la cuenta.
            </li>
            <li>
              Cuando quieras cobrar de verdad, repetí el paso 3 con el token de{" "}
              <strong>Credenciales de producción</strong> (empieza con{" "}
              <code>APP_USR-</code>).
            </li>
          </ol>
        </details>
      </div>
    </section>
  );
}

/**
 * Campo de solo lectura con botón de copiar.
 *
 * El nombre de la variable se transcribe a mano en el panel de otro servicio y
 * una letra de menos hace que no ande sin decir por qué, así que conviene que
 * se pueda copiar de una.
 */
function CopyField({ id, value }: { id: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex gap-2">
      <input
        id={id}
        className="input tabular bg-surface-sunken text-ink-soft"
        value={value}
        readOnly
      />

      <button
        type="button"
        className="btn btn-secondary shrink-0"
        onClick={() => {
          navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            // Sin permiso de portapapeles queda para seleccionar a mano.
            .catch(() => undefined);
        }}
      >
        <Icon name={copied ? "check" : "copy"} className="size-4" />
        <span className="sr-only">
          {copied ? "Copiado" : "Copiar el nombre de la variable"}
        </span>
      </button>
    </div>
  );
}
