import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import {
  assignLooseServices,
  deleteCategory,
  saveCategory,
} from "@/app/actions/categories";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { getCategoryRows } from "@/lib/catalog";
import {
  buildCategoryTree,
  categoryBranch,
  categoryOptions,
  flattenCategories,
  CATEGORY_DESCRIPTION_MAX,
  CATEGORY_MAX_DEPTH,
  CATEGORY_NAME_MAX,
  type CategoryNode,
  type CategoryRow,
} from "@/lib/categories";

/**
 * Cómo se agrupan los servicios en la web.
 *
 * Es el árbol de cards que ve la clienta: "Esmaltado semipermanente" y adentro
 * los tipos que hay. Acá se arma la estructura; a qué categoría va cada
 * servicio se elige junto al servicio, en Profesionales, porque es un dato del
 * servicio y no de la categoría.
 *
 * Todo el árbol se dibuja de una, con cada categoría abierta en su propio
 * formulario. Son pocas y se acomodan de una sentada: obligar a entrar y salir
 * de una pantalla por cada una haría el doble de clics para lo mismo.
 *
 * La cuenta de servicios que muestra cada fila es la de la rama entera —lo
 * suyo más lo de sus subcategorías—, que es lo que hace falta para decidir si
 * una categoría está de más.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Categorías" };

export default async function CategoriesPage() {
  await requireAdmin();

  const [rows, serviceRows] = await Promise.all([
    getCategoryRows(),
    db
      .select({
        id: services.id,
        name: services.name,
        categoryId: services.categoryId,
        active: services.active,
        professionalName: professionals.name,
      })
      .from(services)
      .innerJoin(professionals, eq(services.professionalId, professionals.id))
      .orderBy(
        asc(professionals.sortOrder),
        asc(professionals.name),
        asc(services.sortOrder),
        asc(services.id),
      ),
  ]);

  const tree = buildCategoryTree(rows);
  const flat = flattenCategories(tree);

  /** Cuántos servicios cuelgan de cada categoría, contando sus subcategorías. */
  const countIn = (node: CategoryNode) => {
    const branch = categoryBranch(rows, node.id);
    return serviceRows.filter(
      (service) => service.categoryId !== null && branch.has(service.categoryId),
    ).length;
  };

  const loose = serviceRows.filter((service) => service.categoryId === null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Categorías</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Cómo se agrupan los servicios en la web: primero las cards grandes y
          adentro las que correspondan. A qué categoría va cada servicio se
          elige en{" "}
          <Link
            href="/admin/profesionales"
            className="underline underline-offset-4"
          >
            Profesionales
          </Link>
          , junto a su precio y su duración.
        </p>
      </div>

      {/* ── El árbol ──────────────────────────────────────────────────── */}
      {flat.length === 0 ? (
        <div className="panel p-6 text-center">
          <p className="text-sm text-ink-soft">
            Todavía no hay categorías. Sin ninguna, la web muestra todos los
            servicios en una sola lista, como hasta ahora.
          </p>
        </div>
      ) : (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">
              {flat.length} {flat.length === 1 ? "categoría" : "categorías"}
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              El orden decide en qué posición sale cada card. Números más chicos,
              más arriba.
            </p>
          </div>

          <ul className="divide-y divide-line">
            {flat.map((node) => (
              <li key={node.id} className="p-4">
                <CategoryRowForm
                  node={node}
                  rows={rows}
                  serviceCount={countIn(node)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Alta ──────────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Agregar una categoría</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Dejá vacío &quot;Dentro de&quot; para una card del primer nivel. Se
            pueden anidar hasta {CATEGORY_MAX_DEPTH} niveles.
          </p>
        </div>

        <ActionForm action={saveCategory} className="space-y-3 p-4" resetOnSuccess>
          <input type="hidden" name="active" value="on" />

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <label className="field-label" htmlFor="new-category-name">
                Nombre
              </label>
              <input
                id="new-category-name"
                name="name"
                className="input"
                placeholder="Esmaltado semipermanente"
                required
                maxLength={CATEGORY_NAME_MAX}
              />
            </div>

            <div className="min-w-44">
              <label className="field-label" htmlFor="new-category-parent">
                Dentro de
              </label>
              <ParentSelect id="new-category-parent" rows={rows} value={null} />
            </div>

            <div>
              <label className="field-label" htmlFor="new-category-order">
                Orden
              </label>
              <input
                id="new-category-order"
                name="sortOrder"
                type="number"
                className="input w-24 tabular"
                defaultValue={0}
              />
            </div>

            <SubmitButton className="btn btn-secondary">
              <Icon name="plus" className="size-3.5" />
              Agregar
            </SubmitButton>
          </div>

          <div>
            <label className="field-label" htmlFor="new-category-description">
              Qué es
              <span className="ml-1 font-normal text-ink-muted">(opcional)</span>
            </label>
            <input
              id="new-category-description"
              name="description"
              className="input"
              maxLength={CATEGORY_DESCRIPTION_MAX}
              placeholder="Una línea que se lee bajo el nombre, en la card."
            />
          </div>
        </ActionForm>
      </section>

      {/* ── Servicios sin categoría ───────────────────────────────────── */}
      {loose.length > 0 && flat.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">
              Servicios sin categoría ({loose.length})
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Se muestran sueltos en el primer nivel, junto a las cards. Marcá
              los que vayan juntos y mandalos a una categoría de una sola vez.
            </p>
          </div>

          <ActionForm action={assignLooseServices} className="p-4 space-y-3">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {loose.map((service) => (
                <li key={service.id}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="serviceIds"
                      value={service.id}
                      className="mt-0.5 size-4 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0">
                      {service.name}
                      <span className="block text-xs text-ink-muted">
                        {service.professionalName}
                        {service.active ? "" : " · no aparece en la web"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <div className="min-w-48">
                <label className="field-label" htmlFor="assign-category">
                  Mandarlos a
                </label>
                <select
                  id="assign-category"
                  name="categoryId"
                  className="input"
                  required
                >
                  {categoryOptions(rows).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <SubmitButton className="btn btn-secondary">Agrupar</SubmitButton>
            </div>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Una categoría, con su formulario propio.
 *
 * La sangría del nombre es la única señal de jerarquía en la lista: repetir la
 * ruta completa en cada fila ("Esmaltado semi › Gel › …") ocuparía la mitad del
 * ancho para decir lo que ya dice la posición.
 */
function CategoryRowForm({
  node,
  rows,
  serviceCount,
}: {
  node: CategoryNode;
  rows: CategoryRow[];
  serviceCount: number;
}) {
  return (
    <div style={{ paddingLeft: `${node.depth * 1.25}rem` }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {node.depth > 0 ? (
          <span aria-hidden="true" className="text-ink-muted">
            └
          </span>
        ) : null}

        <h3 className="text-sm font-medium">{node.name}</h3>

        <span className="text-xs text-ink-muted">
          {serviceCount === 0
            ? "sin servicios"
            : `${serviceCount} ${serviceCount === 1 ? "servicio" : "servicios"}`}
        </span>

        {!node.active ? (
          <span className="badge border-line-strong bg-surface-sunken text-ink-muted">
            <Icon name="slash" className="size-3" />
            No aparece en la web
          </span>
        ) : null}

        {serviceCount === 0 ? (
          <span className="badge border-warning-line bg-warning-soft text-warning">
            <Icon name="alert" className="size-3" />
            Vacía: no se muestra
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <ActionForm
          action={saveCategory}
          className="min-w-0 flex-1 space-y-2"
          feedback="bottom"
        >
          <input type="hidden" name="id" value={node.id} />

          <div className="flex flex-wrap items-center gap-2">
            <input
              name="name"
              defaultValue={node.name}
              className="input min-w-40 flex-1 py-1 text-sm"
              aria-label="Nombre de la categoría"
              required
              maxLength={CATEGORY_NAME_MAX}
            />

            <span className="flex items-center gap-1.5">
              <span className="text-xs text-ink-muted">Dentro de</span>
              <ParentSelect
                id={`parent-${node.id}`}
                rows={rows}
                value={node.parentId}
                exclude={categoryBranch(rows, node.id)}
                className="input w-44 py-1 text-sm"
              />
            </span>

            <span className="flex items-center gap-1.5">
              <span className="text-xs text-ink-muted">Orden</span>
              <input
                name="sortOrder"
                type="number"
                defaultValue={node.sortOrder}
                className="input w-20 py-1 text-sm tabular"
                aria-label="Orden en la web"
              />
            </span>

            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                name="active"
                defaultChecked={node.active}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Se muestra
            </label>

            <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="…">
              Guardar
            </SubmitButton>
          </div>

          <input
            name="description"
            defaultValue={node.description}
            className="input py-1 text-sm"
            aria-label="Qué es esta categoría"
            maxLength={CATEGORY_DESCRIPTION_MAX}
            placeholder="Una línea que se lee bajo el nombre, en la card (opcional)."
          />
        </ActionForm>

        <ActionForm action={deleteCategory} feedback="none">
          <input type="hidden" name="id" value={node.id} />
          <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="…">
            <Icon name="trash" className="size-3.5" />
            <span className="sr-only">Eliminar {node.name}</span>
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

/**
 * De qué categoría cuelga esta. Ofrece solo las que pueden ser padre: las del
 * último nivel no aparecen —anidar ahí pasaría el tope— y tampoco la propia
 * rama de la categoría que se está editando, que sería un ciclo.
 */
function ParentSelect({
  id,
  rows,
  value,
  exclude,
  className = "input",
}: {
  id: string;
  rows: CategoryRow[];
  value: number | null;
  exclude?: Set<number>;
  className?: string;
}) {
  return (
    <select
      id={id}
      name="parentId"
      className={className}
      defaultValue={value ?? ""}
    >
      <option value="">— Primer nivel —</option>
      {categoryOptions(rows, { exclude, maxDepth: CATEGORY_MAX_DEPTH - 1 }).map(
        (option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ),
      )}
    </select>
  );
}
