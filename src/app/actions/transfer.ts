"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { appointments } from "@/db/schema";
import type { ActionState, PaymentState } from "@/lib/action-state";
import { canAccessProfessional, requireUser } from "@/lib/auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { hashToken, looksLikeToken } from "@/lib/tokens";
import { confirmTransfer, rejectTransfer } from "@/lib/transfer";

/**
 * Las acciones de la seña por transferencia.
 *
 * Son dos lados de la misma espera. Del lado de la clienta, un botón para
 * avisar que ya transfirió. Del lado del panel, los dos botones que resuelven
 * esa fila: acreditar o descartar.
 *
 * Lo que la clienta aprieta NO confirma el turno. Es un aviso, no una
 * acreditación: mueve la fila al principio de la cola del panel y nada más. La
 * plata se da por recibida únicamente cuando la ve una persona en la cuenta, o
 * cuando el verificador automático la encuentra por importe exacto. Si apretar
 * ese botón confirmara turnos, cualquiera con el link reservaría gratis.
 */

/* ── Del lado de la clienta ──────────────────────────────────────────── */

/**
 * "Ya transferí".
 *
 * Solo escribe la fecha del aviso. Es idempotente por naturaleza: apretarlo
 * dos veces deja la misma fila igual, y por eso no hace falta bloquear el
 * botón ni llevar la cuenta de cuántas veces se apretó.
 */
export async function declareTransfer(
  _prev: PaymentState,
  formData: FormData,
): Promise<PaymentState> {
  const token = String(formData.get("token") ?? "");
  if (!looksLikeToken(token)) {
    return { ok: false, message: "El link no es válido." };
  }

  const limit = await checkRateLimit(await clientKey("transfer"), 12, 600);
  if (!limit.allowed) {
    return {
      ok: false,
      message: "Demasiados intentos seguidos. Esperá un minuto.",
    };
  }

  const [appointment] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.cancelTokenHash, hashToken(token)))
    .limit(1);

  if (!appointment) {
    return { ok: false, message: "No encontramos esa reserva." };
  }

  if (appointment.status === "booked") {
    // Ya se acreditó mientras la pantalla estaba abierta. No es un error:
    // es la mejor noticia posible, y la pantalla al recargarse lo muestra.
    revalidatePath(`/turno/${token}`);
    return { ok: true, message: null };
  }

  if (appointment.paymentMethod !== "transfer") {
    return { ok: false, message: "Esta reserva no se abona por transferencia." };
  }

  if (appointment.status !== "pending_payment") {
    return {
      ok: false,
      message:
        "Esta reserva ya no está esperando la transferencia. Escribinos si ya la hiciste.",
    };
  }

  await db
    .update(appointments)
    .set({ transferDeclaredAt: Math.floor(Date.now() / 1000) })
    .where(eq(appointments.id, appointment.id));

  revalidatePath(`/turno/${token}`);
  revalidatePath("/admin/transferencias");
  revalidatePath("/admin");

  return { ok: true, message: null };
}

/* ── Del lado del panel ──────────────────────────────────────────────── */

function ok(message: string): ActionState {
  return { ok: true, message };
}

function error(message: string): ActionState {
  return { ok: false, message };
}

/**
 * Comprueba que el turno exista y sea de quien lo está pidiendo.
 *
 * Una profesional solo resuelve las transferencias de sus propias clientas. Un
 * id ajeno responde lo mismo que uno inexistente: quien prueba números no
 * puede averiguar así cuántos turnos tiene el local.
 */
async function ownedAppointment(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("appointmentId"));

  if (!Number.isInteger(id) || id <= 0) return null;

  const [row] = await db
    .select({
      id: appointments.id,
      professionalId: appointments.professionalId,
      firstName: appointments.firstName,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.id, id),
        eq(appointments.paymentMethod, "transfer"),
      ),
    )
    .limit(1);

  if (!row) return null;
  if (!canAccessProfessional(user, row.professionalId)) return null;

  return { user, appointment: row };
}

function refresh() {
  revalidatePath("/admin/transferencias");
  revalidatePath("/admin");
}

/** Acredita la transferencia y confirma el turno. */
export async function approveTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owned = await ownedAppointment(formData);
  if (!owned) return error("No encontramos esa transferencia.");

  const result = await confirmTransfer(owned.appointment.id, {
    reviewedBy: owned.user.id,
  });

  refresh();

  switch (result.outcome) {
    case "confirmed":
      return ok(`Turno de ${owned.appointment.firstName} confirmado.`);
    case "already_confirmed":
      return ok("Ese turno ya estaba confirmado.");
    case "slot_taken":
      return error(
        `El horario de ${owned.appointment.firstName} ya lo tomó otra persona. Hay que devolverle la seña y reprogramarla.`,
      );
    default:
      return error(result.reason);
  }
}

/**
 * Descarta la transferencia y suelta el horario.
 *
 * Se usa cuando la plata no está: pasado el plazo, o alguien que se arrepintió.
 * No manda ningún aviso; ver la nota en `rejectTransfer`.
 */
export async function dismissTransfer(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const owned = await ownedAppointment(formData);
  if (!owned) return error("No encontramos esa transferencia.");

  await rejectTransfer(owned.appointment.id, owned.user.id);
  refresh();

  return ok(
    `Descartamos la reserva de ${owned.appointment.firstName} y liberamos el horario.`,
  );
}
