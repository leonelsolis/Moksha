import "server-only";

import type { Appointment, Service } from "@/db/schema";
import {
  createPreference,
  mercadoPagoConfig,
  type MpResult,
} from "./mercadopago";
import { getSettings, settingInt, type Settings } from "./settings";
import { siteOrigin } from "./site-url";

/**
 * La decisión de cobrar, y el armado del checkout.
 *
 * `src/lib/mercadopago.ts` habla con la API; este archivo traduce la
 * configuración del negocio a "este turno se cobra o no se cobra". Está
 * separado del flujo de reserva porque la misma pregunta se hace en dos
 * momentos: al reservar y al reintentar el pago desde la página del turno.
 *
 * La regla es una sola y hacen falta las tres cosas a la vez:
 *
 *   1. El interruptor "Cobrar el turno" encendido en Ajustes (`mp_enabled`).
 *   2. MERCADOPAGO_ACCESS_TOKEN cargado en el servidor.
 *   3. Una seña mayor a 0 cargada en ESE servicio.
 *
 * Si falta cualquiera, el turno se confirma en el momento y no se cobra nada,
 * que es exactamente como funcionaba la web antes de que Mercado Pago
 * existiera acá. No hay ningún camino en el que una configuración incompleta
 * haga fallar una reserva.
 */

/** Ruta a la que Mercado Pago avisa cuando cambia el estado de un pago. */
export const MP_WEBHOOK_PATH = "/api/pagos/mercadopago";

export type PaymentPlan =
  /** El turno se confirma en el acto. `reason` es para el log, no para pantalla. */
  | { charge: false; reason: "disabled" | "no_token" | "no_deposit" }
  /** Hay que cobrar la seña antes de confirmar. */
  | { charge: true; amount: number; holdMinutes: number };

const NO_CHARGE = {
  disabled: { charge: false, reason: "disabled" },
  no_token: { charge: false, reason: "no_token" },
  no_deposit: { charge: false, reason: "no_deposit" },
} as const satisfies Record<string, PaymentPlan>;

/**
 * La seña de un servicio, ya saneada.
 *
 * Devuelve 0 —o sea, "no se cobra"— ante cualquier valor que no sea un importe
 * positivo. Un NULL, un 0 o algo que quedó raro en la base significan lo mismo:
 * este servicio no se seña.
 */
export function depositFor(service: Pick<Service, "depositAmount">): number {
  const amount = service.depositAmount ?? 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  // Dos decimales: es lo que acepta Mercado Pago como importe.
  return Math.round(amount * 100) / 100;
}

/**
 * ¿Este turno se cobra?
 *
 * Nunca lanza: si la configuración no se puede leer, decide no cobrar. El lado
 * seguro es reservar sin cobro —una seña que no se cobró se arregla cobrando en
 * el local— y no dejar a nadie sin poder sacar turno.
 */
export async function paymentPlanFor(
  service: Pick<Service, "depositAmount">,
  settings?: Settings,
): Promise<PaymentPlan> {
  try {
    const resolved = settings ?? (await getSettings());
    const config = mercadoPagoConfig(resolved);

    if (!config.enabled) return NO_CHARGE.disabled;
    if (!config.hasToken) return NO_CHARGE.no_token;

    const amount = depositFor(service);
    if (amount <= 0) return NO_CHARGE.no_deposit;

    return { charge: true, amount, holdMinutes: holdMinutes(resolved) };
  } catch (e) {
    console.error("[pagos] no se pudo resolver el cobro; se reserva sin cobrar", e);
    return NO_CHARGE.disabled;
  }
}

/** Minutos que se retiene el horario esperando el pago, acotado a algo sensato. */
export function holdMinutes(settings: Settings): number {
  const minutes = settingInt(settings, "mp_hold_minutes", 5);
  return Math.min(Math.max(minutes, 5), 24 * 60);
}

/* ── Checkout ─────────────────────────────────────────────────────────── */

export type Checkout = { url: string; preferenceId: string };

/**
 * Crea el link de pago de la seña de un turno.
 *
 * `externalReference` es el id del turno: es el único dato que vuelve en el
 * aviso de pago, y con él se sabe qué pre-reserva confirmar.
 *
 * La clave de idempotencia también sale del id del turno, así un doble clic o
 * un reintento no generan dos cobros: Mercado Pago devuelve la preferencia que
 * ya había creado.
 *
 * Como todo lo de Mercado Pago acá, no lanza: devuelve `{ ok: false, reason }`
 * y quien llama decide.
 */
export async function createDepositCheckout(
  appointment: Pick<Appointment, "id" | "email" | "serviceName"> & {
    amount: number;
    /** El token del turno: con él se arma la vuelta desde Mercado Pago. */
    token: string;
  },
  settings: Settings,
): Promise<MpResult<Checkout>> {
  const origin = await siteOrigin().catch(() => "");

  /*
   * Mercado Pago rechaza la preferencia si las URLs de vuelta no son https, y
   * en desarrollo el sitio es http://localhost. Sin ellas el checkout funciona
   * igual: al terminar, la clienta se queda en la pantalla de Mercado Pago en
   * lugar de volver sola a su turno. Es la diferencia entre poder probar el
   * cobro en local y no poder.
   */
  const canReturn = origin.startsWith("https://");
  const backUrl = (result: string) =>
    `${origin}/turno/${appointment.token}?pago=${result}`;

  const result = await createPreference({
    title: appointment.serviceName
      ? `Seña · ${appointment.serviceName}`
      : "Seña del turno",
    unitPrice: appointment.amount,
    externalReference: String(appointment.id),
    payerEmail: appointment.email,
    idempotencyKey: `turno-${appointment.id}`,
    ...(canReturn
      ? {
          notificationUrl: `${origin}${MP_WEBHOOK_PATH}`,
          backUrls: {
            success: backUrl("ok"),
            pending: backUrl("pendiente"),
            failure: backUrl("error"),
          },
        }
      : {}),
  });

  if (!result.ok) return result;

  /*
   * Con credenciales de prueba hay que mandar a la clienta al init point de
   * sandbox: el normal exige una cuenta real y rechaza las tarjetas de prueba.
   */
  const { isTestToken } = mercadoPagoConfig(settings);
  const url =
    (isTestToken ? result.data.sandboxInitPoint : result.data.initPoint) ||
    result.data.initPoint;

  if (!url) {
    return { ok: false, reason: "Mercado Pago no devolvió el link de pago." };
  }

  return { ok: true, data: { url, preferenceId: result.data.id } };
}

/** Texto del importe, para pantalla y emails. */
export function formatMoney(amount: number) {
  return `$${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

/** ¿La pre-reserva sigue en pie o ya venció? */
export function holdIsAlive(
  appointment: Pick<Appointment, "status" | "holdExpiresAt">,
  now = Math.floor(Date.now() / 1000),
) {
  return (
    appointment.status === "pending_payment" &&
    (appointment.holdExpiresAt ?? 0) > now
  );
}
