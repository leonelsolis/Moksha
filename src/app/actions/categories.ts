"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { serviceCategories, services } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireAdmin } from "@/lib/auth";
import { getCategoryRows } from "@/lib/catalog";
import {
  categoryBranch,
  depthUnder,
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_MAX_DEPTH,
  CATEGORY_NAME_MAX,
} from "@/lib/categories";

/**
 * Las categorías con las que se ordena el catálogo.
 *
 * Todo acá es administración: una categoría no es de nadie en particular, es
 * cómo el negocio presenta lo que ofrece. Una profesional elige sus servicios
 * y sus horarios, no cómo se agrupan las cards de la web.
 *
 * Las dos reglas que se cuidan al guardar —y que la base no puede cuidar sola—
 * son que ninguna categoría cuelgue de su propia rama y que el árbol no pase
 * de `CATEGORY_MAX_DEPTH` niveles. Sin la primera, cualquier pantalla que
 * recorra el árbol se quedaría dando vueltas.
 */

function ok(message: string): ActionState {
  return { ok: true, message };
}

function error(message: string): ActionState {
  return { ok: false, message };
}

function refresh() {
  revalidatePath("/");
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/servicios");
}

/** Alta y edición: es el mismo formulario, con `id` o sin él. */
export async function saveCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "")
    .trim()
    .slice(0, CATEGORY_DESCRIPTION_MAX);
  const parentId = Number(formData.get("parentId")) || null;
  const sortOrder = Number(formData.get("sortOrder")) || 0;
  const active = formData.get("active") === "on";

  if (!name) return error("Poné un nombre a la categoría.");
  if (name.length > CATEGORY_NAME_MAX) {
    return error(`El nombre no puede pasar de ${CATEGORY_NAME_MAX} caracteres.`);
  }

  const rows = await getCategoryRows();

  if (id && !rows.some((row) => row.id === id)) {
    return error("Categoría no encontrada.");
  }

  if (parentId !== null) {
    if (parentId === id) {
      return error("Una categoría no puede estar dentro de sí misma.");
    }

    if (!rows.some((row) => row.id === parentId)) {
      return error("La categoría de arriba no existe.");
    }

    /*
     * Colgarla de su propia descendencia dejaría un ciclo: la rama quedaría
     * cerrada sobre sí misma y no colgaría de ningún primer nivel, o sea que
     * desaparecería del catálogo además de trabar cualquier recorrido.
     */
    if (id && categoryBranch(rows, id).has(parentId)) {
      return error(
        "Esa categoría está dentro de la que estás editando: no puede ser también la de arriba.",
      );
    }
  }

  const depth = depthUnder(rows, parentId);
  if (depth === null) return error("La categoría de arriba no existe.");

  /*
   * El tope se mide sobre la rama entera, no sobre la categoría sola: mover
   * "Capping gel" un nivel más abajo empuja a todo lo que tiene adentro.
   */
  const branchDepth = id ? deepestUnder(rows, id) : 0;
  if (depth + branchDepth >= CATEGORY_MAX_DEPTH) {
    return error(
      `No se puede anidar más de ${CATEGORY_MAX_DEPTH} niveles. ` +
        "Sacá una subcategoría o subila un nivel antes de mover esta.",
    );
  }

  const values = { parentId, name, description, sortOrder, active };

  if (id) {
    await db.update(serviceCategories).set(values).where(eq(serviceCategories.id, id));
  } else {
    await db.insert(serviceCategories).values(values);
  }

  refresh();
  return ok(id ? "Categoría actualizada." : `"${name}" agregada.`);
}

/**
 * Cuántos niveles cuelgan de una categoría. 0 = no tiene subcategorías.
 * Es lo que hay que sumarle a su nueva profundidad para saber si entra.
 *
 * `seen` es la guarda contra una fila torcida que ya estuviera en la base: sin
 * ella un ciclo dejaría esta recursión dando vueltas para siempre.
 */
function deepestUnder(
  rows: { id: number; parentId: number | null }[],
  id: number,
  seen: Set<number> = new Set(),
): number {
  if (seen.has(id)) return 0;
  seen.add(id);

  const children = rows.filter((row) => row.parentId === id && row.id !== id);
  if (children.length === 0) return 0;

  return 1 + Math.max(...children.map((child) => deepestUnder(rows, child.id, seen)));
}

/**
 * Borra una categoría sin llevarse nada puesto.
 *
 * Lo que tenía adentro sube un nivel: las subcategorías pasan a colgar de
 * donde colgaba ella y sus servicios pasan a su categoría de arriba (o quedan
 * sueltos en el primer nivel, si era de primer nivel). Nunca desaparece un
 * servicio del catálogo por borrar la card que lo contenía; en el peor caso
 * queda peor ordenado, que se arregla desde la misma pantalla.
 */
export async function deleteCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return error("Categoría no encontrada.");

  const rows = await getCategoryRows();
  const category = rows.find((row) => row.id === id);
  if (!category) return error("Categoría no encontrada.");

  const parentId = category.parentId;

  await db
    .update(serviceCategories)
    .set({ parentId })
    .where(eq(serviceCategories.parentId, id));

  await db
    .update(services)
    .set({ categoryId: parentId })
    .where(eq(services.categoryId, id));

  await db.delete(serviceCategories).where(eq(serviceCategories.id, id));

  refresh();

  return ok(
    parentId === null
      ? `"${category.name}" eliminada. Lo que tenía adentro quedó en el primer nivel.`
      : `"${category.name}" eliminada. Lo que tenía adentro subió un nivel.`,
  );
}

/**
 * Manda a una categoría todos los servicios que se llamen igual.
 *
 * Es el atajo para el momento en que se arma el catálogo por primera vez, con
 * los servicios ya cargados de antes: en lugar de abrir Profesionales y elegir
 * la categoría de "Esmaltado semipermanente" tres veces —una por cada
 * profesional que lo ofrece—, se agrupan de un saque los que todavía no tienen
 * ninguna. Los que ya están clasificados no se tocan: reordenar a mano no se
 * pierde por volver a apretar el botón.
 */
export async function assignLooseServices(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const categoryId = Number(formData.get("categoryId"));
  const ids = formData
    .getAll("serviceIds")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!categoryId) return error("Elegí la categoría.");
  if (ids.length === 0) return error("Elegí al menos un servicio.");

  const [category] = await db
    .select()
    .from(serviceCategories)
    .where(eq(serviceCategories.id, categoryId))
    .limit(1);

  if (!category) return error("Categoría no encontrada.");

  // Solo los que están sueltos: esto agrupa lo que falta clasificar, no
  // reacomoda lo que alguien ya ordenó a mano.
  const result = await db
    .update(services)
    .set({ categoryId })
    .where(and(inArray(services.id, ids), isNull(services.categoryId)));

  refresh();

  return result.rowsAffected === 0
    ? error("Esos servicios ya tenían categoría.")
    : ok(
        `${result.rowsAffected} ${result.rowsAffected === 1 ? "servicio" : "servicios"} en "${category.name}".`,
      );
}
