import "server-only";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { appointments, professionals } from "@/db/schema";
import type { AdminUser, Appointment, Service } from "@/db/schema";
import { professionalScope } from "./auth";
import { conflictingAppointmentIds } from "./availability";
import { announceNewBooking } from "./notify";
import { depositFor } from "./payments";
import { getSettings, settingBool, settingInt, type Settings } from "./settings";

/**
 * Seña por transferencia bancaria.
 *
 * ── El problema ─────────────────────────────────────────────────────────
 *
 * Una transferencia llega anónima. A diferencia de un pago de Mercado Pago,
 * que viaja con el id del turno adentro (`external_reference`, ver
 * `payments.ts`), lo único que aparece en la cuenta es "entraron $5.000". Si
 * ese día dos clientas señaron $5.000, los dos movimientos son idénticos y no
 * hay forma de saber cuál es cuál.
 *
 * ── La solución: los centavos ───────────────────────────────────────────
 *
 * A cada turno se le pide un importe con centavos propios. La seña del
 * servicio son $5.000, pero a una clienta se le pide $5.000,37 y a la otra
 * $5.000,38. Esos centavos son únicos entre las transferencias que están
 * esperando en ese momento, así que el monto se vuelve el identificador que la
 * transferencia no trae.
 *
 * Es un truco viejo y tiene una propiedad que vale la pena: no depende de que
 * la clienta haga nada bien. No hay que pedirle que ponga un código en el
 * concepto —que la mitad no completa, y la otra mitad completa mal—; solo que
 * transfiera el número que ve en pantalla, que es lo que ya iba a hacer.
 *
 * ── Para qué sirve ──────────────────────────────────────────────────────
 *
 * Habilita las dos formas de acreditar, y las dos conviven:
 *
 *   · A mano. Quien aprueba desde el panel ve el importe exacto al lado del
 *     nombre y lo compara con el movimiento de la cuenta. Es un vistazo, no
 *     una investigación.
 *
 *   · Sola, si `transfer_auto_verify` está encendido. Se le pregunta a la API
 *     de Mercado Pago por los movimientos entrantes y se busca uno con el
 *     importe exacto. Ver `matchIncomingTransfers`.
 *
 * La aprobación manual NO desaparece cuando el automático está encendido: es
 * el respaldo para todo lo que el automático no puede resolver —alguien que
 * transfiere el monto redondo ignorando los centavos, o de menos, o desde el
 * banco cuando esperábamos Mercado Pago—. Ninguna de esas es una clienta que
 * merezca perder el turno.
 *
 * ── Qué no puede fallar ─────────────────────────────────────────────────
 *
 * Igual que en el resto de los cobros: nada de acá puede hacer fallar una
 * reserva. Si la configuración está incompleta, la transferencia simplemente
 * no se ofrece como medio de pago y la web sigue funcionando como siempre.
 */

/* ── Configuración ───────────────────────────────────────────────────── */

export type TransferConfig = {
  enabled: boolean;
  alias: string;
  cbu: string;
  holder: string;
  bank: string;
  holdMinutes: number;
  autoVerify: boolean;
  /**
   * Si se puede ofrecer de verdad. Hace falta el interruptor encendido Y un
   * destino cargado: sin alias ni CBU, la pantalla diría "transferí" sin decir
   * a dónde, que es peor que no ofrecerlo.
   */
  ready: boolean;
};

export function transferConfig(settings: Settings): TransferConfig {
  const alias = settings.transfer_alias.trim();
  const cbu = settings.transfer_cbu.replace(/\s/g, "");
  const enabled = settingBool(settings, "transfer_enabled");

  return {
    enabled,
    alias,
    cbu,
    holder: settings.transfer_holder.trim(),
    bank: settings.transfer_bank.trim(),
    holdMinutes: transferHoldMinutes(settings),
    autoVerify: settingBool(settings, "transfer_auto_verify"),
    ready: enabled && (alias !== "" || cbu !== ""),
  };
}

/**
 * Minutos de retención, acotados a algo sensato.
 *
 * El piso es una hora: menos que eso no alcanza ni para abrir el homebanking.
 * El techo es una semana, que ya es más plazo del que ningún local quiere
 * tener un horario bloqueado.
 */
export function transferHoldMinutes(settings: Settings): number {
  const minutes = settingInt(settings, "transfer_hold_minutes", 60);
  return Math.min(Math.max(minutes, 60), 7 * 24 * 60);
}

/** ¿Este servicio se puede señar por transferencia? */
export async function transferAvailableFor(
  service: Pick<Service, "depositAmount">,
  settings?: Settings,
): Promise<boolean> {
  try {
    const resolved = settings ?? (await getSettings());
    if (!transferConfig(resolved).ready) return false;
    return depositFor(service) > 0;
  } catch (e) {
    // Mismo criterio que en `paymentPlanFor`: ante cualquier duda, no se
    // ofrece. Una forma de pago que no aparece es un inconveniente; una que
    // aparece rota es una clienta que no puede reservar.
    console.error("[transferencia] no se pudo resolver la disponibilidad", e);
    return false;
  }
}

/* ── El importe con centavos únicos ──────────────────────────────────── */

/**
 * Los centavos que puede tomar un importe.
 *
 * Se arranca en 1 y no en 0 a propósito: un importe que termina en ,00 es
 * indistinguible del monto redondo que alguien puede transferir por su cuenta,
 * y esa es justamente la confusión que todo esto viene a evitar.
 */
const MIN_CENTS = 1;
const MAX_CENTS = 99;

/**
 * Elige el importe exacto que se le va a pedir a esta clienta.
 *
 * Toma la seña del servicio y le agrega los centavos libres más chicos entre
 * las transferencias que están esperando ese mismo monto base. "Esperando"
 * son las pre-reservas por transferencia todavía vigentes: una que venció ya
 * no puede recibir plata, así que sus centavos vuelven al ruedo.
 *
 * Devuelve `null` si los 99 centavos están ocupados. En la práctica eso
 * significa 99 personas esperando transferir exactamente la misma seña al
 * mismo tiempo, que en un local de turnos no pasa; pero si pasara, el camino
 * correcto es no ofrecer transferencia en ese momento y no entregar un importe
 * ambiguo que después nadie puede atribuir.
 */
export async function assignTransferAmount(
  baseAmount: number,
  now = Math.floor(Date.now() / 1000),
): Promise<number | null> {
  const base = Math.floor(baseAmount);
  if (base <= 0) return null;

  /*
   * Los importes en uso para esta base. Se comparan en centavos enteros y no
   * en pesos con decimales: 5000.37 no es exactamente representable en punto
   * flotante, y comparar por igualdad dos números que "deberían" ser iguales
   * es de donde salen los bugs más difíciles de ver de todo esto.
   */
  const rows = await db
    .select({ amount: appointments.transferAmount })
    .from(appointments)
    .where(
      and(
        eq(appointments.paymentMethod, "transfer"),
        eq(appointments.status, "pending_payment"),
        sql`${appointments.holdExpiresAt} > ${now}`,
        sql`${appointments.transferAmount} >= ${base}`,
        sql`${appointments.transferAmount} < ${base + 1}`,
      ),
    );

  const taken = new Set(
    rows
      .map((row) => toCents(row.amount))
      .filter((cents): cents is number => cents !== null)
      .map((cents) => cents % 100),
  );

  for (let cents = MIN_CENTS; cents <= MAX_CENTS; cents++) {
    if (!taken.has(cents)) return base + cents / 100;
  }

  console.warn(
    `[transferencia] no quedan centavos libres para la seña de $${base}; no se ofrece transferencia`,
  );
  return null;
}

/** Un importe en pesos pasado a centavos enteros, para comparar sin decimales. */
export function toCents(amount: number | null | undefined): number | null {
  if (amount === null || amount === undefined) return null;
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

/* ── Acreditar ───────────────────────────────────────────────────────── */

export type TransferSettlement =
  /** Se acreditó y el turno quedó confirmado en esta llamada. */
  | { outcome: "confirmed"; appointmentId: number }
  /** Ya estaba confirmado. Pasa si el automático y el manual coinciden. */
  | { outcome: "already_confirmed"; appointmentId: number }
  /** El horario se lo llevó otra persona mientras la plata venía en camino. */
  | { outcome: "slot_taken"; appointmentId: number }
  /** No se pudo: no existe, no es por transferencia, o ya está resuelto. */
  | { outcome: "unusable"; reason: string };

/**
 * Da por recibida la transferencia y confirma el turno.
 *
 * Es el único lugar donde una pre-reserva por transferencia pasa a confirmada,
 * y lo llaman los dos caminos: el botón del panel y el verificador automático.
 * Como los dos pueden llegar —y en cualquier orden—, es idempotente: el UPDATE
 * exige que el estado siga siendo 'pending_payment', así que el segundo en
 * llegar no vuelve a confirmar ni manda un segundo mail.
 *
 * Igual que `settlePayment`, comprueba que el horario siga libre antes de
 * confirmar. Acá importa incluso más: la retención de una transferencia es de
 * horas, no de minutos, así que hay mucho más tiempo para que la clienta
 * cancele, la retención venza y alguien tome el lugar.
 *
 * No lanza nunca.
 */
export async function confirmTransfer(
  appointmentId: number,
  options: {
    /** Qué cuenta del panel lo aprobó. Ausente si lo acreditó el automático. */
    reviewedBy?: number;
    /** El movimiento de Mercado Pago que lo matcheó, si fue automático. */
    mpPaymentId?: string;
  } = {},
): Promise<TransferSettlement> {
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
    return { outcome: "unusable", reason: `El turno ${appointmentId} no existe.` };
  }

  const { appointment } = row;

  if (appointment.paymentMethod !== "transfer") {
    return {
      outcome: "unusable",
      reason: `El turno ${appointmentId} no se cobra por transferencia.`,
    };
  }

  if (appointment.status === "booked") {
    return { outcome: "already_confirmed", appointmentId };
  }

  if (appointment.status !== "pending_payment") {
    return {
      outcome: "unusable",
      reason: `El turno ${appointmentId} está en estado '${appointment.status}'.`,
    };
  }

  const now = Math.floor(Date.now() / 1000);

  /*
   * ¿Sigue libre el horario?
   *
   * La retención pudo vencer y otra persona pudo tomar el lugar. Dos turnos
   * encima no se arreglan con nada; una seña de más se devuelve. Así que si
   * hay choque se anota y se avisa, pero no se confirma.
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
      `[transferencia] el turno ${appointmentId} transfirió pero el horario ya lo tomó otra persona. Hay que devolver la seña.`,
    );
    await db
      .update(appointments)
      .set({ paidAt: now, holdExpiresAt: null, transferReviewedAt: now })
      .where(eq(appointments.id, appointmentId))
      .catch(() => undefined);

    return { outcome: "slot_taken", appointmentId };
  }

  /*
   * El estado va en el WHERE, no solo en el SET. Es lo que hace la operación
   * idempotente: si el automático y el clic del panel llegan a la vez, el
   * segundo no actualiza ninguna fila y sale por `already_confirmed` sin
   * mandar un segundo mail.
   */
  const updated = await db
    .update(appointments)
    .set({
      status: "booked",
      paidAt: now,
      holdExpiresAt: null,
      transferReviewedAt: now,
      transferReviewedBy: options.reviewedBy ?? null,
      transferMpPaymentId: options.mpPaymentId ?? null,
    })
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.status, "pending_payment"),
      ),
    )
    .returning({ id: appointments.id });

  if (updated.length === 0) {
    return { outcome: "already_confirmed", appointmentId };
  }

  /*
   * El mail sale sin link al turno: de la clienta tenemos solo el hash del
   * token, igual que en el aviso automático de Mercado Pago. El link que ella
   * ya tiene —el que recibió al reservar— sigue funcionando.
   */
  await announceNewBooking({
    appointmentId,
    appointment: row.appointment,
    professionalName: row.professionalName,
    token: null,
    depositAmount: appointment.transferAmount,
  });

  revalidatePath("/");
  revalidatePath("/admin");

  return { outcome: "confirmed", appointmentId };
}

/**
 * Rechaza una transferencia que no llegó o no coincide.
 *
 * Suelta el horario ya mismo en vez de esperar a que venza la retención: si
 * quien atiende ya miró la cuenta y no está la plata, no tiene sentido seguir
 * bloqueando el lugar.
 *
 * No manda ningún aviso a la clienta. De esta reserva nunca se le anunció
 * nada —el mail de confirmación sale recién al acreditarse—, así que un mail
 * diciendo "rechazamos tu transferencia" sería el primero que recibe, y quien
 * atiende suele preferir resolver eso hablando.
 */
export async function rejectTransfer(appointmentId: number, reviewedBy: number) {
  const now = Math.floor(Date.now() / 1000);

  await db
    .update(appointments)
    .set({
      status: "expired_payment",
      holdExpiresAt: null,
      transferReviewedAt: now,
      transferReviewedBy: reviewedBy,
    })
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.status, "pending_payment"),
        eq(appointments.paymentMethod, "transfer"),
      ),
    );

  revalidatePath("/");
  revalidatePath("/admin");
}

/* ── La cola del panel ───────────────────────────────────────────────── */

export type PendingTransfer = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  serviceName: string;
  date: string;
  startMinute: number;
  professionalName: string;
  /** El importe exacto a buscar en la cuenta. Es el dato central de la fila. */
  transferAmount: number | null;
  /** Cuándo dijo que transfirió. NULL si todavía no lo dijo. */
  declaredAt: number | null;
  holdExpiresAt: number | null;
  /** La retención ya venció: el horario está libre y esto es un remanente. */
  expired: boolean;
};

/**
 * Las transferencias esperando resolución.
 *
 * Incluye tanto a las que ya declararon haber transferido como a las que
 * todavía no, porque las dos cosas le importan a quien atiende: las primeras
 * hay que verificarlas, y las segundas explican por qué un horario figura
 * ocupado sin turno confirmado.
 *
 * Ordenadas por quién declaró primero: esa es la fila de espera real.
 */
export async function pendingTransfers(
  user: AdminUser,
): Promise<PendingTransfer[]> {
  const now = Math.floor(Date.now() / 1000);

  const rows = await db
    .select({
      id: appointments.id,
      firstName: appointments.firstName,
      lastName: appointments.lastName,
      phone: appointments.phone,
      email: appointments.email,
      serviceName: appointments.serviceName,
      date: appointments.date,
      startMinute: appointments.startMinute,
      professionalName: professionals.name,
      transferAmount: appointments.transferAmount,
      declaredAt: appointments.transferDeclaredAt,
      holdExpiresAt: appointments.holdExpiresAt,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(
      and(
        eq(appointments.paymentMethod, "transfer"),
        eq(appointments.status, "pending_payment"),
        isNull(appointments.transferReviewedAt),
        professionalScope(user, appointments.professionalId),
      ),
    )
    .orderBy(
      sql`${appointments.transferDeclaredAt} IS NULL`,
      appointments.transferDeclaredAt,
      appointments.id,
    );

  return rows.map((row) => ({
    ...row,
    expired: (row.holdExpiresAt ?? 0) <= now,
  }));
}

/** Cuántas esperan. Para el indicador de la navegación del panel. */
export async function pendingTransferCount(user: AdminUser) {
  try {
    return (await pendingTransfers(user)).length;
  } catch (e) {
    // El contador es un adorno: que falle no puede dejar sin panel a nadie.
    console.warn("[transferencia] no se pudo contar la cola:", e);
    return 0;
  }
}

/* ── Verificación automática ─────────────────────────────────────────── */

/**
 * Busca en Mercado Pago las transferencias entrantes y acredita las que
 * coinciden con una pre-reserva por importe exacto.
 *
 * Corre desde `/api/pagos/transferencias`, que es un cron: a diferencia de
 * Mercado Pago, que avisa por webhook cuando cobra, una transferencia entrante
 * no dispara ninguna notificación hacia nosotros. Hay que ir a preguntar.
 *
 * ── Sobre si esto funciona ──────────────────────────────────────────────
 *
 * Depende de que la cuenta que recibe sea de Mercado Pago y de que su API
 * liste los movimientos entrantes de dinero, cosa que hay que comprobar con
 * una transferencia de prueba en la cuenta real antes de encender
 * `transfer_auto_verify`. Mientras esté apagado, esto no corre y las
 * transferencias se aprueban con un clic desde el panel.
 *
 * ── Por qué solo acredita coincidencias exactas ─────────────────────────
 *
 * Un movimiento se acredita únicamente si su importe coincide al centavo con
 * una pre-reserva vigente. Todo lo demás —un monto redondo, uno de menos, uno
 * que coincide con dos filas— se deja sin tocar para que lo resuelva una
 * persona desde el panel. Confirmar un turno de más es peor que confirmarlo
 * tarde: significa que alguien se presenta al local sin haber pagado, o que
 * dos personas creen tener el mismo horario.
 *
 * No lanza nunca: es un cron, y un cron que tira no acredita nada.
 */
export async function matchIncomingTransfers(): Promise<{
  checked: number;
  confirmed: number;
}> {
  const empty = { checked: 0, confirmed: 0 };

  try {
    const settings = await getSettings();
    const config = transferConfig(settings);

    if (!config.ready || !config.autoVerify) return empty;

    const now = Math.floor(Date.now() / 1000);

    /*
     * Las pre-reservas que esperan plata, indexadas por importe en centavos.
     *
     * Se arranca por acá y no por los movimientos de Mercado Pago porque
     * normalmente son muchas menos: si no hay nadie esperando, no hace falta
     * salir a la red.
     */
    const waiting = await db
      .select({
        id: appointments.id,
        amount: appointments.transferAmount,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.paymentMethod, "transfer"),
          eq(appointments.status, "pending_payment"),
          isNull(appointments.transferReviewedAt),
          sql`${appointments.holdExpiresAt} > ${now}`,
        ),
      );

    if (waiting.length === 0) return empty;

    /*
     * Un importe que aparece dos veces no identifica a nadie. No debería
     * pasar —`assignTransferAmount` justamente lo evita—, pero puede quedar
     * una colisión si dos altas corren a la vez. Esos importes se sacan de la
     * tabla: quedan para que los resuelva una persona.
     */
    const byCents = new Map<number, number[]>();
    for (const row of waiting) {
      const cents = toCents(row.amount);
      if (cents === null) continue;
      byCents.set(cents, [...(byCents.get(cents) ?? []), row.id]);
    }

    const movements = await incomingTransfers(config);
    if (!movements.ok) {
      console.warn("[transferencia] no se pudo consultar la cuenta:", movements.reason);
      return empty;
    }

    let confirmed = 0;

    for (const movement of movements.data) {
      const cents = toCents(movement.amount);
      if (cents === null) continue;

      const candidates = byCents.get(cents);
      if (!candidates || candidates.length !== 1) continue;

      const result = await confirmTransfer(candidates[0], {
        mpPaymentId: movement.id,
      });

      if (result.outcome === "confirmed") {
        confirmed++;
        console.info(
          `[transferencia] el movimiento ${movement.id} acreditó el turno ${candidates[0]}`,
        );
      }

      // Ese importe ya se usó: si entraran dos movimientos iguales, el segundo
      // no puede acreditar un turno que ya está confirmado.
      byCents.delete(cents);
    }

    return { checked: movements.data.length, confirmed };
  } catch (e) {
    console.error("[transferencia] falló la verificación automática", e);
    return empty;
  }
}

/**
 * Los movimientos de dinero entrante de la cuenta de Mercado Pago.
 *
 * Se pide a `/v1/payments/search` acotado a los últimos días: una
 * transferencia que entró hace una semana ya no puede corresponder a ninguna
 * retención viva, y traer todo el historial en cada corrida es tirar red al
 * pedo.
 *
 * Se filtran los movimientos que son dinero ENTRANDO por transferencia. Un
 * cobro con tarjeta de la propia integración no tiene nada que hacer acá: ese
 * ya lo acredita el webhook de `payments.ts` con su `external_reference`, que
 * es infinitamente más confiable que adivinar por monto.
 */
async function incomingTransfers(config: TransferConfig): Promise<
  | { ok: true; data: { id: string; amount: number }[] }
  | { ok: false; reason: string }
> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) return { ok: false, reason: "Falta MERCADOPAGO_ACCESS_TOKEN." };

  // Ventana holgada: la retención más larga que se puede configurar es una
  // semana, y se le suma un día de margen.
  const since = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();

  const url =
    `https://api.mercadopago.com/v1/payments/search` +
    `?sort=date_created&criteria=desc&limit=100` +
    `&begin_date=${encodeURIComponent(since)}&end_date=NOW`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, reason: `Mercado Pago respondió ${response.status}.` };
    }

    const body = (await response.json()) as {
      results?: {
        id?: number | string;
        status?: string;
        operation_type?: string;
        payment_type_id?: string;
        external_reference?: string | null;
        transaction_amount?: number;
      }[];
    };

    const data = (body.results ?? [])
      .filter((payment) => {
        if (payment.status !== "approved") return false;
        /*
         * Los cobros de nuestra propia integración traen el id del turno
         * adentro y los acredita el webhook. Si se colaran acá, un cobro con
         * tarjeta cuyo importe casualmente coincida con una transferencia
         * pendiente confirmaría el turno equivocado.
         */
        if (payment.external_reference) return false;

        return (
          payment.operation_type === "money_transfer" ||
          payment.payment_type_id === "bank_transfer" ||
          payment.payment_type_id === "account_money"
        );
      })
      .map((payment) => ({
        id: String(payment.id),
        amount: Number(payment.transaction_amount),
      }))
      .filter((movement) => Number.isFinite(movement.amount));

    return { ok: true, data };
  } catch (e) {
    const reason =
      e instanceof Error && e.name === "AbortError"
        ? "Mercado Pago tardó demasiado."
        : "No se pudo consultar Mercado Pago.";
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}

/* ── Ayudas de pantalla ──────────────────────────────────────────────── */

/** ¿Esta pre-reserva está esperando una transferencia que todavía no llegó? */
export function awaitingTransfer(
  appointment: Pick<Appointment, "paymentMethod" | "status">,
) {
  return (
    appointment.paymentMethod === "transfer" &&
    appointment.status === "pending_payment"
  );
}
