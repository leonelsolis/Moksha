import "server-only";

import { asc } from "drizzle-orm";

import { db } from "@/db";
import { serviceCategories } from "@/db/schema";
import type { CategoryRow } from "./categories";

/**
 * Las categorías del catálogo, todas de una sola consulta.
 *
 * Son unas pocas decenas de filas y siempre se necesitan enteras: el panel
 * dibuja el árbol completo y la web pública tiene que poder subir por los
 * padres de un servicio. Traerlas por partes solo agregaría consultas.
 *
 * Vienen todas, apagadas incluidas: quién las esconde es cada pantalla. El
 * panel las muestra marcadas y `buildCatalog` las descarta.
 */
export async function getCategoryRows(): Promise<CategoryRow[]> {
  return db
    .select({
      id: serviceCategories.id,
      parentId: serviceCategories.parentId,
      name: serviceCategories.name,
      description: serviceCategories.description,
      sortOrder: serviceCategories.sortOrder,
      active: serviceCategories.active,
    })
    .from(serviceCategories)
    .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.name));
}
