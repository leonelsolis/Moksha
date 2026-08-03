"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appointments, professionals } from "@/db/schema";
import type { PaymentState } from "@/lib/action-state";
import { announceNewBooking } from "@/lib/notify";
import { createDepositCheckout, holdIsAlive, paymentPlanFor } from "@/lib/payments";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { hashToken, looksLikeToken } from "@/lib/tokens";

/**
 * El pago de la seña, después de reservar.
 *
 * El cobro arranca en `createBooking`, que crea la pre-reserva y manda al
 * checkout. Esta acción es para la segunda vuelta: quien cerró la pestaña de
 * Mercado Pago, quien volvió con el pago rechazado, o quien dejó la pantalla
 * abierta y quiere reintentar. Se entra siempre con el token del turno —el
 * mismo link que se usa para cancelar—, nunca con un id: un id correlativo en
 * la URL dejaría pagar (y mirar) el turno de otra persona.
 *
 * Ningún camino de acá tira un error de servidor. Los tres finales posibles
 * son: se abre el checkout, el turno se confirma sin cobrar, o se explica en
 * pantalla qué pasó.
 */

function fail(message: string): PaymentState {
  return { ok: false, message };
}

export async function resumeDepositCheckout(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const token = String(formData.get("token") ?? "");
  if (!looksLikeToken(token)) {
    return fail("El link no es válido.");
  }

  const limit = await checkRateLimit(await clientKey("pay"), 12, 600);
  if (!limit.allowed) {
    return fail("Demasiados intentos seguidos. Esperá un minuto y volvé a probar.");
  }

  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.cancelTokenHash, hashToken(token)))
    .limit(1);

  if (!appointment) return fail("No encontramos esa reserva.");

  // Ya está pago y confirmado: no hay nada que cobrar de nuevo.
  if (appointment.status === "booked") {
    redirect(`/turno/${token}`);
  }

  if (appointment.status !== "pending_payment") {
    return fail(
      appointment.status === "expired_payment"
        ? "Esta reserva venció sin pagarse y el horario volvió a estar disponible. Sacá un turno nuevo."
        : "Esta reserva está cancelada. Sacá un turno nuevo cuando quieras.",
    );
  }

  if (!holdIsAlive(appointment)) {
    /*
     * Se venció mientras la pantalla estaba abierta. Se marca la fila para que
     * deje de figurar como pendiente, pero el horario NO se vuelve a tomar acá:
     * puede haberlo agarrado otra persona en el medio, y sacárselo sería peor
     * que pedir que reserve de nuevo.
     */
    await db
      .update(appointments)
      .set({ status: "expired_payment" })
      .where(eq(appointments.id, appointment.id))
      .catch(() => undefined);

    revalidatePath("/");
    revalidatePath(`/turno/${token}`);

    return fail(
      "Se venció el plazo para pagar la seña y el horario volvió a estar disponible. Sacá un turno nuevo.",
    );
  }

  const settings = await getSettings();

  /*
   * El cobro se vuelve a evaluar con la configuración de ahora, no con la de
   * cuando se reservó. Si en el medio se apagó Mercado Pago, se le sacó la seña
   * al servicio o se cayó el token, la clienta no puede quedar atrapada con una
   * pre-reserva que ya no tiene forma de pagarse: el turno se confirma sin
   * cobrar y listo.
   */
  const plan = await paymentPlanFor(
    { depositAmount: appointment.depositAmount },
    settings,
  );

  if (!plan.charge) {
    await confirmWithoutCharge(appointment.id, token);
    redirect(`/turno/${token}?nuevo=1`);
  }

  /*
   * Si ya hay un link de pago creado se reusa. Es la misma preferencia —misma
   * clave de idempotencia— así que crear otra devolvería lo mismo, pero sin
   * salir a la red se reintenta más rápido y se sigue funcionando aunque
   * Mercado Pago esté lento.
   */
  if (appointment.mpCheckoutUrl) {
    redirect(appointment.mpCheckoutUrl);
  }

  const checkout = await createDepositCheckout(
    {
      id: appointment.id,
      email: appointment.email,
      serviceName: appointment.serviceName,
      amount: plan.amount,
      token,
    },
    settings,
  );

  if (!checkout.ok) {
    /*
     * Mercado Pago no contesta. Se confirma el turno sin cobrar, igual que
     * cuando falla al reservar: la clienta no se queda sin turno por un
     * problema que no es suyo, y la seña se cobra en el local si hace falta.
     */
    console.warn(
      "[pagos] no se pudo reabrir el checkout; el turno se confirma sin cobrar:",
      checkout.reason,
    );

    await confirmWithoutCharge(appointment.id, token);
    redirect(`/turno/${token}?nuevo=1`);
  }

  await db
    .update(appointments)
    .set({
      mpPreferenceId: checkout.data.preferenceId,
      mpCheckoutUrl: checkout.data.url,
    })
    .where(eq(appointments.id, appointment.id));

  redirect(checkout.data.url);
}

/**
 * Pasa una pre-reserva a turno confirmado sin haber cobrado nada, y manda los
 * avisos como en cualquier turno nuevo.
 *
 * El horario ya estaba retenido por esta misma fila, así que no hay que volver
 * a comprobar que esté libre: pasar de 'pending_payment' a 'booked' no lo
 * disputa con nadie.
 */
async function confirmWithoutCharge(appointmentId: number, token: string) {
  await db
    .update(appointments)
    .set({
      status: "booked",
      depositAmount: null,
      holdExpiresAt: null,
      mpCheckoutUrl: null,
    })
    .where(eq(appointments.id, appointmentId));

  const [row] = await db
    .select({
      appointment: appointments,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (row) {
    await announceNewBooking({
      appointment: row.appointment,
      professionalName: row.professionalName,
      token,
    });
  }

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath(`/turno/${token}`);
}
