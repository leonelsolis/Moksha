/**
 * Tipos que cruzan del servidor al navegador.
 *
 * Se declaran aparte de las tablas a propósito: acá solo viaja lo que la web
 * pública necesita mostrar. Los datos de los clientes de otros turnos nunca
 * entran en estas estructuras.
 */

import type { CategoryRow } from "./categories";

export type PublicService = {
  id: number;
  name: string;
  durationMinutes: number;
  price: number | null;
  /** En qué card del catálogo entra. NULL = suelto en el primer nivel. */
  categoryId: number | null;
  /** Qué es el servicio. Vacío = no se muestra ninguna explicación. */
  description: string;
  /**
   * Foto de ejemplo, ya filtrada por el interruptor del panel: si está
   * apagado llega en `null` y la URL ni siquiera viaja al navegador.
   */
  photoUrl: string | null;
};

/** ¿Hay algo que mostrar en la ficha del servicio? */
export function hasServiceInfo(service: PublicService) {
  return service.description.length > 0 || service.photoUrl !== null;
}

/**
 * El catálogo de una profesional: un nivel de cards.
 *
 * Cada nodo tiene las categorías que se abren y los servicios que se eligen
 * ahí mismo. La raíz tiene la misma forma que una categoría a propósito: el
 * flujo de reserva dibuja un nivel sin preguntarse si es el primero o el
 * tercero, y navegar es cambiar qué nodo se está mirando.
 */
export type CatalogNode = {
  categories: PublicCategory[];
  services: PublicService[];
};

export type PublicCategory = CatalogNode & {
  id: number;
  name: string;
  /** Se muestra bajo el nombre en la card. Vacío = solo el nombre. */
  description: string;
};

/**
 * Arma el catálogo de una profesional a partir de sus servicios activos.
 *
 * Dos cosas quedan afuera y no es lo mismo por qué:
 *
 *   · Las ramas apagadas (`active` en false, ellas o cualquiera por encima).
 *     Es lo que el panel pidió esconder, así que no viaja al navegador.
 *   · Las ramas sin ningún servicio de esta profesional. Una card que se abre
 *     y está vacía es peor que no mostrarla: las categorías son del negocio y
 *     cada profesional hace lo suyo.
 *
 * Un servicio sin categoría —o cuya categoría se borró— queda suelto en el
 * primer nivel, junto a las cards. Es lo que hace que un local que nunca creó
 * ninguna categoría siga viendo la lista de siempre.
 */
export function buildCatalog(
  services: PublicService[],
  categories: CategoryRow[],
): CatalogNode {
  const active = categories.filter((row) => row.active);
  const ids = new Set(active.map((row) => row.id));

  const childrenOf = new Map<number | null, CategoryRow[]>();
  for (const row of active) {
    const parent = row.parentId !== null && ids.has(row.parentId) ? row.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(row);
    childrenOf.set(parent, list);
  }

  const servicesOf = new Map<number | null, PublicService[]>();
  for (const service of services) {
    // Categoría inexistente o apagada: el servicio no se esconde, sube al
    // primer nivel. Que se pueda reservar no depende de cómo esté ordenado.
    const key =
      service.categoryId !== null && ids.has(service.categoryId)
        ? service.categoryId
        : null;
    const list = servicesOf.get(key) ?? [];
    list.push(service);
    servicesOf.set(key, list);
  }

  const visited = new Set<number>();

  function build(parentId: number | null): CatalogNode {
    const children = [...(childrenOf.get(parentId) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"),
    );

    return {
      categories: children.flatMap((row) => {
        // Guarda contra un ciclo en la base: una rama se recorre una sola vez.
        if (visited.has(row.id)) return [];
        visited.add(row.id);

        const node = build(row.id);
        if (countServices(node) === 0) return [];

        return [{ id: row.id, name: row.name, description: row.description, ...node }];
      }),
      services: servicesOf.get(parentId) ?? [],
    };
  }

  return build(null);
}

/** Cuántos servicios hay en un nodo contando todo lo que cuelga de él. */
export function countServices(node: CatalogNode): number {
  return (
    node.services.length +
    node.categories.reduce((total, child) => total + countServices(child), 0)
  );
}

/** Todos los servicios del catálogo, en el orden en que se leen las cards. */
export function catalogServices(node: CatalogNode): PublicService[] {
  return [
    ...node.services,
    ...node.categories.flatMap((child) => catalogServices(child)),
  ];
}

export type PublicProfessionalView = {
  id: number;
  name: string;
  specialty: string;
  photoUrl: string | null;
  bio: string;
  /** Todos sus servicios reservables, sin la estructura de cards. */
  services: PublicService[];
  /** Los mismos servicios, ordenados en el árbol de categorías. */
  catalog: CatalogNode;
  onVacation: boolean;
  /** Última fecha de vacaciones, para el mensaje "Vuelve el …". */
  vacationUntil: string | null;
};

export type BookingWindowView = {
  /** Primer día reservable, en la zona horaria del negocio. */
  today: string;
  /** Último día reservable. */
  lastDate: string;
};

/** Respuesta de /api/disponibilidad: fecha → minutos de inicio libres. */
export type AvailabilityMap = Record<string, number[]>;
