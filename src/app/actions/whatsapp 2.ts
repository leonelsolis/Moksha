"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { appointments, whatsappMessages } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUser, scopeOf } from "@/lib/auth";

/**
 * Despacho de la cola de WhatsApp desde el panel.
 *
 * Son tres botones y las tres acciones hacen lo mismo con distinta columna:
 * marcar una fila como enviada, descartarla, o devolverla a la cola.
 *
 * El alcance por profesional no se puede aplicar con `withScope` como en el
 * resto del panel, porque la profesional no está en `whatsapp_messages` sino
 * en el turno del que cuelga el mensaje. Se resuelve leyendo primero el mensaje
 * junto a su turno: si la consulta con el alcance aplicado no devuelve nada,
 * ese id no es de quien lo está pidiendo y la respuesta es la misma que si no
 * existiera.
 */

function ok(message: string): ActionState {
  return { ok: true, message };
}

function error(message: string): ActionState {
  return { ok: false, message };
}

function refresh() {
  revalidatePath("/admin/mensajes");
  revalidatePath("/admin");
}

/**
 * Comprueba que el mensaje exista y sea de este usuario, y devuelve su id.
 *
 * Devuelve null en los dos casos —no existe, o es de otra profesional— a
 * propósito: distinguirlos le confirmaría a una cuenta que cierto id existe en
 * la agenda de otra persona.
 */
async function ownedMessageId(
  userScope: number | null,
  id: number,
): Promise<number | null> {
  const [row] = await db
    .select({
      id: whatsappMessages.id,
      professionalId: appointments.professionalId,
    })
    .from(whatsappMessages)
    .innerJoin(
      appointments,
      eq(whatsappMessages.appointmentId, appointments.id),
    )
    .where(eq(whatsappMessages.id, id))
    .limit(1);

  if (!row) return null;
  if (userScope !== null && row.professionalId !== userScope) return null;

  return row.id;
}

/**
 * Marca el mensaje como enviado.
 *
 * Se llama en el mismo clic con el que se abre WhatsApp, no después: el
 * navegador no tiene forma de enterarse de si la persona apretó enviar del
 * otro lado, así que esperar la confirmación real sería esperar para siempre.
 * La contrapartida es `returnToQueue`, que devuelve a la lista lo que al final
 * no se mandó.
 */
export async function markMessageSent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Mensaje no encontrado.");

  const owned = await ownedMessageId(scopeOf(user), id);
  if (owned === null) return error("Mensaje no encontrado.");

  const result = await db
    .update(whatsappMessages)
    .set({ sentAt: Math.floor(Date.now() / 1000) })
    .where(
      and(eq(whatsappMessages.id, owned), isNull(whatsappMessages.sentAt)),
    );

  refresh();

  if (result.rowsAffected === 0) return ok("Ese mensaje ya estaba enviado.");
  return ok("Listo, marcado como enviado.");
}

/** Descarta el mensaje: no se manda y no vuelve a aparecer en la cola. */
export async function dismissMessage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Mensaje no encontrado.");

  const owned = await ownedMessageId(scopeOf(user), id);
  if (owned === null) return error("Mensaje no encontrado.");

  await db
    .update(whatsappMessages)
    .set({ dismissedAt: Math.floor(Date.now() / 1000) })
    .where(eq(whatsappMessages.id, owned));

  refresh();
  return ok("Mensaje descartado.");
}

/** Deshace: el mensaje vuelve a la lista de pendientes. */
export async function returnToQueue(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const id = Number(formData.get("id"));
  if (!id) return error("Mensaje no encontrado.");

  const owned = await ownedMessageId(scopeOf(user), id);
  if (owned === null) return error("Mensaje no encontrado.");

  await db
    .update(whatsappMessages)
    .set({ sentAt: null, dismissedAt: null })
    .where(eq(whatsappMessages.id, owned));

  refresh();
  return ok("El mensaje volvió a la lista.");
}

/**
 * Despacha de una vez todo lo que está en pantalla.
 *
 * Es para después de haber mandado varios seguidos: en lugar de marcar uno por
 * uno lo que ya se envió, se marca la tanda entera. Los ids llegan del
 * formulario y cada uno pasa por la misma comprobación de alcance que los
 * botones de a uno.
 */
export async function markAllSent(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const scope = scopeOf(user);

  const ids = formData
    .getAll("id")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (ids.length === 0) return error("No había mensajes para marcar.");

  const owned: number[] = [];
  for (const id of ids) {
    const check = await ownedMessageId(scope, id);
    if (check !== null) owned.push(check);
  }

  if (owned.length === 0) return error("No había mensajes para marcar.");

  const result = await db
    .update(whatsappMessages)
    .set({ sentAt: Math.floor(Date.now() / 1000) })
    .where(
      and(
        inArray(whatsappMessages.id, owned),
        isNull(whatsappMessages.sentAt),
      ),
    );

  refresh();

  const count = result.rowsAffected;
  if (count === 0) return ok("Ya estaban todos marcados.");

  return ok(
    count === 1
      ? "1 mensaje marcado como enviado."
      : `${count} mensajes marcados como enviados.`,
  );
}
