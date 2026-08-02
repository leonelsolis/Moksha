"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { professionals } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireUser, scopeOf } from "@/lib/auth";

/**
 * La ficha pública de la profesional, editada por ella misma.
 *
 * Es lo mismo que edita la administración en /admin/profesionales, pero
 * limitado a la fila propia. Va en su propio archivo y no dentro de
 * `saveProfessional` porque las reglas son distintas: acá el id NO se lee del
 * formulario. Se toma del usuario logueado, así no hay ningún dato de entrada
 * que pueda apuntar a la ficha de otra.
 *
 * Quedan afuera dos campos a propósito, porque son decisiones del negocio y no
 * del perfil:
 *   · `active`    — si aparece o no en la web.
 *   · `sortOrder` — en qué orden se listan.
 */
export async function updateOwnProfile(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const scope = scopeOf(user);

  // La administración no tiene ficha propia: edita las de todas desde
  // /admin/profesionales.
  if (scope === null) {
    return { ok: false, message: "Editá las fichas desde Profesionales." };
  }

  if (scope < 0) {
    return {
      ok: false,
      message:
        "Tu cuenta no está vinculada a ninguna profesional. Pedile a la administración que la vincule.",
    };
  }

  const name = String(formData.get("name") ?? "").trim();
  const specialty = String(formData.get("specialty") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();

  if (!name) return { ok: false, message: "El nombre no puede quedar vacío." };
  if (name.length > 60) return { ok: false, message: "El nombre es demasiado largo." };
  if (specialty.length > 60) {
    return { ok: false, message: "El rubro es demasiado largo." };
  }
  if (bio.length > 400) {
    return { ok: false, message: "La presentación no puede pasar de 400 caracteres." };
  }

  /*
   * La foto no se toca acá: tiene su propio formulario de subir y quitar. Si
   * viajara en este, guardar los datos la borraría sin que nadie lo pidiera.
   */
  await db
    .update(professionals)
    .set({ name, specialty, bio })
    .where(eq(professionals.id, scope));

  revalidatePath("/");
  revalidatePath("/admin/perfil");
  revalidatePath("/admin/profesionales");

  return { ok: true, message: "Tu ficha quedó actualizada." };
}
