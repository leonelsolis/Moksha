import "server-only";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appointments, professionals } from "@/db/schema";
import type { Appointment, Service } from "@/db/schema";
import { conflictingAppointmentIds } from "./availability";
import { confirmGroupSiblings } from "./booking-group";
import {
  createPreference,
  getPayment,
  mercadoPagoConfig,
  type MpResult,
} from "./mercadopago";
import { announceNewBooking } from "./notify";
import { getSettings, settingInt, type Settings } from "./settings";
import { siteOrigin } from "./site-url";
import { hashToken } from "./tokens";

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
   * Las vueltas del checkout no van a la página del turno sino a `/pago/…`,
   * que acredita el pago y recién ahí redirige. Es lo que hace que el turno
   * quede confirmado apenas la clienta vuelve, sin depender de que el aviso de
   * Mercado Pago llegue primero.
   *
   * El aviso automático (`notification_url`) solo se manda desde un sitio
   * https: Mercado Pago tiene que poder entrar, y a `localhost` no llega. En
   * desarrollo la vuelta por pantalla es el único camino, y alcanza para
   * probar. `auto_return` también pide https, así que va junto.
   */
  const isPublic = origin.startsWith("https://");
  const backUrl = (result: string) =>
    `${origin}/pago/${appointment.token}?resultado=${result}`;

  const result = await createPreference({
    title: appointment.serviceName
      ? `Seña · ${appointment.serviceName}`
      : "Seña del turno",
    unitPrice: appointment.amount,
    externalReference: String(appointment.id),
    payerEmail: appointment.email,
    idempotencyKey: `turno-${appointment.id}`,
    backUrls: {
      success: backUrl("ok"),
      pending: backUrl("pendiente"),
      failure: backUrl("error"),
    },
    ...(isPublic
      ? {
          notificationUrl: `${origin}${MP_WEBHOOK_PATH}`,
          autoReturn: "approved",
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

/** El formato de los importes vive en `money.ts`; se reexporta por comodidad. */
export { formatMoney } from "./money";

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

/**
 * Se pagó pero el horario ya no está. Pasa solo si la retención venció y
 * alguien más lo tomó antes de que se acreditara el pago; hay que devolver la
 * plata a mano desde Mercado Pago.
 */
export function isPaidButLost(
  appointment: Pick<Appointment, "status" | "paidAt">,
) {
  return appointment.paidAt !== null && appointment.status !== "booked";
}

/* ── Acreditación ─────────────────────────────────────────────────────── */

export type Settlement =
  /** El pago se aprobó y el turno quedó confirmado en esta llamada. */
  | { outcome: "confirmed"; appointmentId: number }
  /** Ya estaba confirmado. Llega acá cada vez que MP reintenta el aviso. */
  | { outcome: "already_confirmed"; appointmentId: number }
  /** Pago aprobado, pero el horario se lo llevó otra persona. Hay que devolver. */
  | { outcome: "slot_taken"; appointmentId: number }
  /** Mercado Pago todavía lo está procesando. Se estira la retención. */
  | { outcome: "in_process"; appointmentId: number }
  /** Rechazado o cancelado: la pre-reserva queda como estaba, para reintentar. */
  | { outcome: "not_approved"; appointmentId: number; status: string }
  /** No se pudo leer el pago, o el turno que dice no existe. */
  | { outcome: "unusable"; reason: string };

/**
 * Acredita un pago de Mercado Pago y confirma el turno.
 *
 * Es el único lugar donde una pre-reserva pasa a turno confirmado por haber
 * pagado, y lo llaman los dos caminos que existen para enterarse:
 *
 *   · El aviso automático de Mercado Pago (`/api/pagos/mercadopago`), que es el
 *     que vale: llega aunque la clienta cierre el navegador, y se reintenta.
 *   · La vuelta del checkout (`/pago/[token]`), que confirma en el acto sin
 *     esperar al aviso. Es además el ÚNICO camino en desarrollo, porque a
 *     `localhost` Mercado Pago no puede entrar.
 *
 * Los dos pueden llegar, y en cualquier orden: por eso es idempotente. El
 * estado nunca se cree del cuerpo de la notificación —que llega sin autenticar—
 * sino que se le pregunta a la API con nuestro token.
 *
 * No lanza nunca. Un webhook que tira 500 hace que Mercado Pago reintente en
 * loop, y una vuelta del checkout que tira deja a la clienta viendo un error
 * después de haber pagado.
 */
export async function settlePayment(
  paymentId: string,
  options: {
    /**
     * Token en claro, si quien llama lo tiene (la vuelta del checkout lo trae
     * en la URL). Sirve para que el mail de confirmación lleve el link. Se
     * verifica contra el hash del turno antes de usarlo: un token que no es de
     * ese turno se ignora, no manda el link de nadie más.
     */
    token?: string;
  } = {},
): Promise<Settlement> {
  const payment = await getPayment(paymentId);

  if (!payment.ok) {
    return { outcome: "unusable", reason: payment.reason };
  }

  const appointmentId = Number(payment.data.externalReference);
  if (!Number.isInteger(appointmentId) || appointmentId <= 0) {
    return {
      outcome: "unusable",
      reason: `El pago ${paymentId} no apunta a ningún turno.`,
    };
  }

  const [row] = await db
    .select({
      appointment: appointments,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!row) {
    return {
      outcome: "unusable",
      reason: `El pago ${paymentId} apunta al turno ${appointmentId}, que no existe.`,
    };
  }

  const { appointment } = row;
  const now = Math.floor(Date.now() / 1000);

  if (payment.data.status !== "approved") {
    /*
     * Un pago "in_process" (por ejemplo, un débito que el banco todavía está
     * resolviendo) puede tardar más que la retención. Se estira el plazo para
     * no soltarle el horario a alguien que ya pagó y está esperando.
     */
    if (
      payment.data.status === "in_process" ||
      payment.data.status === "pending"
    ) {
      if (appointment.status === "pending_payment") {
        await db
          .update(appointments)
          .set({
            mpPaymentId: String(payment.data.id),
            holdExpiresAt: Math.max(appointment.holdExpiresAt ?? 0, now + 86_400),
          })
          .where(eq(appointments.id, appointmentId));
      }
      return { outcome: "in_process", appointmentId };
    }

    // Rechazado, devuelto o cancelado: no se toca nada. La pre-reserva sigue en
    // pie hasta que venza, así que se puede reintentar con otra tarjeta.
    return {
      outcome: "not_approved",
      appointmentId,
      status: payment.data.status,
    };
  }

  /* ── De acá para abajo, el pago está aprobado ───────────────────────── */

  if (appointment.status === "booked") {
    // Ya se había acreditado. Se completan los datos del pago por si esta
    // llamada llegó antes que la que lo confirmó, y se corta.
    if (!appointment.paidAt) {
      await db
        .update(appointments)
        .set({ mpPaymentId: String(payment.data.id), paidAt: now })
        .where(eq(appointments.id, appointmentId));
    }
    return { outcome: "already_confirmed", appointmentId };
  }

  if (
    appointment.status === "cancelled_by_client" ||
    appointment.status === "cancelled_by_admin"
  ) {
    await recordLostPayment(appointmentId, payment.data.id, now);
    return { outcome: "slot_taken", appointmentId };
  }

  /*
   * La retención pudo vencer antes de que se acreditara el pago, y en ese hueco
   * otra persona pudo tomar el horario. Se comprueba antes de confirmar: dos
   * turnos encima no se arreglan con nada, y una seña de más se devuelve.
   */
  const conflicts = await conflictingAppointmentIds({
    professionalId: appointment.professionalId,
    date: appointment.date,
    startMinute: appointment.startMinute,
    endMinute: appointment.endMinute,
    excludeId: appointment.id,
  });

  if (conflicts.length > 0) {
    console.error(
      `[pagos] el turno ${appointmentId} se pagó (pago ${payment.data.id}) pero el horario ya lo tomó otra persona. Hay que devolver la seña desde Mercado Pago.`,
    );
    await recordLostPayment(appointmentId, payment.data.id, now);
    return { outcome: "slot_taken", appointmentId };
  }

  await db
    .update(appointments)
    .set({
      status: "booked",
      paidAt: now,
      mpPaymentId: String(payment.data.id),
      holdExpiresAt: null,
      // El link de pago ya no sirve para nada y no tiene por qué quedar.
      mpCheckoutUrl: null,
    })
    .where(eq(appointments.id, appointmentId));

  /*
   * Si la visita se reparte entre profesionales, la seña que acaba de entrar es
   * la de todos los tramos: los demás se confirman también. Ver
   * `booking-group.ts`.
   */
  await confirmGroupSiblings(appointment, now);

  /*
   * El token en claro no está en la base: solo su hash. Quien lo tenga a mano
   * lo pasa —la vuelta del checkout lo trae en la URL— y entonces el mail lleva
   * el link para ver o cancelar. El aviso automático no puede, así que por ese
   * camino el mail sale sin link.
   */
  const token =
    options.token && hashToken(options.token) === appointment.cancelTokenHash
      ? options.token
      : null;

  await announceNewBooking({
    appointmentId,
    appointment: row.appointment,
    professionalName: row.professionalName,
    token,
    depositAmount: appointment.depositAmount,
  });

  revalidatePath("/");
  revalidatePath("/admin");

  return { outcome: "confirmed", appointmentId };
}

/** Deja anotado un pago que entró pero se quedó sin horario. */
async function recordLostPayment(
  appointmentId: number,
  paymentId: number,
  now: number,
) {
  await db
    .update(appointments)
    .set({ mpPaymentId: String(paymentId), paidAt: now, holdExpiresAt: null })
    .where(eq(appointments.id, appointmentId))
    .catch(() => undefined);
}
