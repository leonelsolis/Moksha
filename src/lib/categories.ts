/**
 * El árbol de categorías, en memoria.
 *
 * Son unas pocas decenas de filas —el catálogo de un local, no un e-commerce—,
 * así que se traen todas de una y se arma el árbol acá en lugar de resolverlo
 * con consultas recursivas. Estas funciones no tocan la base ni son del
 * servidor: las usan igual el panel, la web pública y las acciones que validan
 * lo que llega de un formulario.
 *
 * Regla que gobierna todo el archivo: un ciclo (una categoría colgada de su
 * propia rama) no puede tumbar una pantalla. `saveCategory` lo impide al
 * guardar, pero acá igual se recorre con una marca de visitados, porque una
 * fila torcida en la base tiene que dar un árbol raro y no un cuelgue.
 */

export type CategoryRow = {
  id: number;
  parentId: number | null;
  name: string;
  description: string;
  sortOrder: number;
  active: boolean;
};

export type CategoryNode = CategoryRow & {
  /** 0 = primer nivel. */
  depth: number;
  children: CategoryNode[];
};

/**
 * Cuántos niveles se pueden anidar, contando el primero.
 *
 * Tres alcanza para "Esmaltado semi → Capping gel → los que hay" y es lo que
 * se puede recorrer en el celular sin perderse. Más profundidad no es un
 * problema de la base sino de la persona que tiene que encontrar su servicio.
 */
export const CATEGORY_MAX_DEPTH = 3;

/** Tope de la explicación que se muestra en la card. */
export const CATEGORY_DESCRIPTION_MAX = 200;

export const CATEGORY_NAME_MAX = 60;

/** Separador de la ruta al mostrarla en una línea: "Esmaltado semi › Gel". */
export const CATEGORY_PATH_SEPARATOR = " › ";

function compareCategories(a: CategoryRow, b: CategoryRow) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es");
}

/**
 * Arma el árbol a partir de las filas sueltas.
 *
 * Una categoría cuyo padre no existe (o que forma un ciclo) no se pierde: se
 * cuelga del primer nivel, que es el lugar donde se la puede ver y arreglar.
 */
export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const childrenOf = new Map<number | null, CategoryRow[]>();
  const ids = new Set(rows.map((row) => row.id));

  for (const row of rows) {
    // Un padre que no está entre las filas cuenta como "sin padre".
    const parent = row.parentId !== null && ids.has(row.parentId) ? row.parentId : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(row);
    childrenOf.set(parent, list);
  }

  const visited = new Set<number>();

  function build(parentId: number | null, depth: number): CategoryNode[] {
    const list = childrenOf.get(parentId) ?? [];

    return [...list].sort(compareCategories).flatMap((row) => {
      if (visited.has(row.id)) return [];
      visited.add(row.id);
      return [{ ...row, depth, children: build(row.id, depth + 1) }];
    });
  }

  const tree = build(null, 0);

  // Lo que quedó fuera del recorrido solo puede ser un ciclo. Sube al primer
  // nivel para que exista en el panel y se pueda desarmar.
  const orphans = rows.filter((row) => !visited.has(row.id));
  for (const row of orphans) {
    visited.add(row.id);
    tree.push({ ...row, depth: 0, children: build(row.id, 1) });
  }

  return tree;
}

/** El árbol aplanado en el orden en que se lee: cada rama entera, de arriba abajo. */
export function flattenCategories(tree: CategoryNode[]): CategoryNode[] {
  return tree.flatMap((node) => [node, ...flattenCategories(node.children)]);
}

/** Los ancestros de una categoría, de la raíz hasta ella misma. */
export function categoryPath(
  rows: CategoryRow[],
  id: number | null,
): CategoryRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const path: CategoryRow[] = [];
  const seen = new Set<number>();

  let current = id === null ? undefined : byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }

  return path;
}

/** "Esmaltado semi › Capping gel". Cadena vacía si no tiene categoría. */
export function categoryPathLabel(rows: CategoryRow[], id: number | null) {
  return categoryPath(rows, id)
    .map((row) => row.name)
    .join(CATEGORY_PATH_SEPARATOR);
}

/** Los ids de una categoría y de todo lo que cuelga de ella, ella incluida. */
export function categoryBranch(rows: CategoryRow[], id: number): Set<number> {
  const branch = new Set<number>([id]);

  // Se repasa la lista hasta que deja de crecer: así no importa en qué orden
  // vengan las filas ni hace falta armar el árbol para esto.
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) {
      if (row.parentId !== null && branch.has(row.parentId) && !branch.has(row.id)) {
        branch.add(row.id);
        grew = true;
      }
    }
  }

  return branch;
}

/**
 * A qué nivel quedaría una categoría colgada de ese padre. 0 = primer nivel.
 * Devuelve `null` si el padre no existe.
 */
export function depthUnder(rows: CategoryRow[], parentId: number | null) {
  if (parentId === null) return 0;
  const path = categoryPath(rows, parentId);
  return path.length === 0 ? null : path.length;
}

/**
 * Opciones para un `<select>` de categoría, ya ordenadas y con la sangría
 * hecha con espacios finos: un `<option>` no admite marcado, así que la
 * jerarquía se dibuja en el propio texto.
 */
export function categoryOptions(
  rows: CategoryRow[],
  options: { exclude?: Set<number>; maxDepth?: number } = {},
) {
  const { exclude, maxDepth = CATEGORY_MAX_DEPTH } = options;

  return flattenCategories(buildCategoryTree(rows))
    .filter((node) => node.depth < maxDepth && !exclude?.has(node.id))
    .map((node) => ({
      id: node.id,
      depth: node.depth,
      label: `${"  ".repeat(node.depth)}${node.depth > 0 ? "└ " : ""}${node.name}`,
      active: node.active,
    }));
}
