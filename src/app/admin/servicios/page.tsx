import { asc, eq } from "drizzle-orm";

import { deleteService, saveService, saveServiceInfo } from "@/app/actions/admin";
import { removeServicePhoto, uploadServicePhoto } from "@/app/actions/photos";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { professionalScope, requireUser } from "@/lib/auth";
import { getCategoryRows } from "@/lib/catalog";
import {
  buildCategoryTree,
  categoryOptions,
  categoryPathLabel,
  flattenCategories,
  type CategoryRow,
} from "@/lib/categories";
import { SERVICE_DESCRIPTION_MAX } from "@/lib/validation";

/**
 * Todo lo que es un servicio, en una sola pantalla.
 *
 * Antes estaba partido en dos: el nombre, la duración, la categoría, el precio
 * y la seña se cargaban en Profesionales, y la explicación y la foto acá. Eran
 * el mismo servicio en dos lugares —y el precio se editaba en los dos, que es
 * la peor versión del problema: dos campos para un dato—. Ahora cada servicio
 * es una sola ficha con todos sus campos y un solo botón de guardar.
 *
 * Los dos roles comparten la pantalla. Cada profesional entra y ve solo sus
 * servicios, y de cada uno edita lo que le toca escribir: la explicación y la
 * foto. Lo que define el negocio —qué se ofrece, cuánto dura, cuánto sale— lo
 * carga la administración. El aislamiento no depende de esta pantalla: las
 * acciones vuelven a aplicar el alcance por su cuenta, porque un server action
 * es un endpoint propio al que se puede llamar sin pasar por acá.
 *
 * Cómo se agrupan los servicios en la web se arma en Categorías, que es la
 * otra pestaña de esta misma sección.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Servicios" };

export default async function ServicesPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";

  const categories = await getCategoryRows();

  const rows = await db
    .select({
      id: services.id,
      professionalId: services.professionalId,
      professionalName: professionals.name,
      categoryId: services.categoryId,
      name: services.name,
      durationMinutes: services.durationMinutes,
      price: services.price,
      depositAmount: services.depositAmount,
      sortOrder: services.sortOrder,
      active: services.active,
      description: services.description,
      photoUrl: services.photoUrl,
      showPhoto: services.showPhoto,
    })
    .from(services)
    .innerJoin(professionals, eq(services.professionalId, professionals.id))
    .where(professionalScope(user, services.professionalId))
    .orderBy(
      asc(professionals.sortOrder),
      asc(professionals.name),
      asc(services.sortOrder),
      asc(services.id),
    );

  /*
   * La administración necesita ver también a las que todavía no tienen ningún
   * servicio: es justo donde hay que cargar el primero. Con la lista de
   * servicios sola, esas profesionales no aparecerían en ningún lado.
   */
  const staff = isAdmin
    ? await db
        .select({ id: professionals.id, name: professionals.name })
        .from(professionals)
        .orderBy(asc(professionals.sortOrder), asc(professionals.name))
    : [...new Map(rows.map((row) => [row.professionalId, row])).values()].map(
        (row) => ({ id: row.professionalId, name: row.professionalName }),
      );

  /*
   * En qué posición va cada categoría, leyendo el árbol de arriba abajo. Es lo
   * que hace que la lista de acá salga en el mismo orden que las cards de la
   * web: sin esto, dos servicios de la misma categoría podrían quedar separados
   * por uno de otra.
   *
   * Los que no tienen categoría van al final, igual que en la web: primero las
   * cards, después lo que quedó suelto.
   */
  const categoryRank = new Map<number, number>(
    flattenCategories(buildCategoryTree(categories)).map((node, index) => [
      node.id,
      index,
    ]),
  );

  const rankOf = (categoryId: number | null) =>
    categoryId === null
      ? Number.MAX_SAFE_INTEGER
      : (categoryRank.get(categoryId) ?? Number.MAX_SAFE_INTEGER);

  // El orden dentro de cada categoría ya viene de la consulta y `sort` es
  // estable, así que reordenar por categoría no lo pisa.
  const servicesOf = (professionalId: number) =>
    rows
      .filter((row) => row.professionalId === professionalId)
      .sort((a, b) => rankOf(a.categoryId) - rankOf(b.categoryId));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Servicios</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          {isAdmin
            ? "Qué ofrece cada profesional: cuánto dura, cuánto sale y qué se le explica a la clienta."
            : "Qué es cada servicio tuyo. Aparece al costado cuando alguien lo elige para sacar un turno."}
        </p>
      </div>

      {staff.length === 0 ? (
        <div className="panel p-6 text-center">
          <p className="text-sm text-ink-soft">
            {isAdmin
              ? "Todavía no hay profesionales cargadas. Cargalas en Equipo → Profesionales y después volvé acá a darles sus servicios."
              : "Todavía no tenés servicios cargados. Los carga la administración."}
          </p>
        </div>
      ) : null}

      {staff.map((person) => {
        const items = servicesOf(person.id);

        return (
          <section key={person.id} className="panel overflow-hidden">
            {/* Con un solo grupo el encabezado sobra: es el propio usuario. */}
            {isAdmin ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                <h2 className="text-sm font-semibold">{person.name}</h2>
                <span className="text-xs text-ink-muted">
                  {items.length === 0
                    ? "sin servicios"
                    : `${items.length} servicio${items.length === 1 ? "" : "s"}`}
                </span>
              </div>
            ) : null}

            {isAdmin && items.length === 0 ? (
              <p className="border-b border-line bg-warning-soft px-4 py-2.5 text-xs text-warning">
                Sin servicios cargados no se le pueden sacar turnos. Cargá al
                menos uno acá abajo, con su duración.
              </p>
            ) : null}

            <ul className="divide-y divide-line">
              {items.map((service, index) => (
                <li key={service.id} className="space-y-4 p-4">
                  {/* Encabezado de categoría: se dibuja al empezar cada grupo, o
                      sea cuando el servicio anterior estaba en otra. Es la misma
                      estructura que ve la clienta en las cards. */}
                  {index === 0 ||
                  items[index - 1].categoryId !== service.categoryId ? (
                    <p className="eyebrow">
                      {service.categoryId === null
                        ? "Sin categoría"
                        : categoryPathLabel(categories, service.categoryId)}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <h3 className="text-sm font-medium">{service.name}</h3>

                      {/* Para la administración los números están justo abajo,
                          en sus campos; repetirlos acá solo daría datos que se
                          contradicen mientras se edita. */}
                      {!isAdmin ? (
                        <span className="text-xs tabular text-ink-muted">
                          {service.durationMinutes} min
                          {service.price != null
                            ? ` · $${service.price.toLocaleString("es-AR")}`
                            : ""}
                        </span>
                      ) : null}

                      {!service.active ? (
                        <span className="badge border-line-strong bg-surface-sunken text-ink-muted">
                          <Icon name="slash" className="size-3" />
                          No aparece en la web
                        </span>
                      ) : null}
                    </div>

                    {/* Borrar va suelto y al costado: es su propio formulario,
                        y lejos del botón de guardar a propósito. */}
                    {isAdmin ? (
                      <ActionForm action={deleteService} feedback="none">
                        <input type="hidden" name="id" value={service.id} />
                        <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="…">
                          <Icon name="trash" className="size-3.5" />
                          <span className="sr-only">Eliminar {service.name}</span>
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </div>

                  {/* Fuera del formulario de la ficha: la foto se sube y se quita
                      por su cuenta, y un formulario no puede anidarse en otro. */}
                  <ImageUpload
                    id={`servicio-${service.id}`}
                    label="Foto de ejemplo"
                    noun="foto"
                    hint="Opcional. Se achica sola. Sale mejor apaisada."
                    imageUrl={service.photoUrl}
                    alt={`Foto de ${service.name}`}
                    upload={uploadServicePhoto}
                    remove={removeServicePhoto}
                    hidden={{ serviceId: service.id }}
                    previewClassName="h-[4.5rem] w-24"
                    emptyIcon="image"
                  />

                  {/*
                    Un solo formulario con todo el servicio. La administración
                    manda la ficha completa; una profesional manda nada más lo
                    que escribe ella, y por eso va a otra acción: la que no
                    exige ser administración.
                  */}
                  <ActionForm
                    action={isAdmin ? saveService : saveServiceInfo}
                    className="space-y-3"
                  >
                    <input type="hidden" name="id" value={service.id} />

                    {isAdmin ? (
                      <>
                        <input
                          type="hidden"
                          name="professionalId"
                          value={service.professionalId}
                        />

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              className="field-label"
                              htmlFor={`nombre-${service.id}`}
                            >
                              Nombre
                            </label>
                            <input
                              id={`nombre-${service.id}`}
                              name="name"
                              className="input"
                              defaultValue={service.name}
                              required
                              maxLength={60}
                            />
                          </div>

                          <div>
                            <label
                              className="field-label"
                              htmlFor={`categoria-${service.id}`}
                            >
                              Categoría
                            </label>
                            <CategorySelect
                              id={`categoria-${service.id}`}
                              categories={categories}
                              value={service.categoryId}
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label
                              className="field-label"
                              htmlFor={`duracion-${service.id}`}
                            >
                              Duración
                            </label>
                            <div className="flex items-center gap-1.5">
                              <input
                                id={`duracion-${service.id}`}
                                name="durationMinutes"
                                type="number"
                                className="input w-24 tabular"
                                defaultValue={service.durationMinutes}
                                min={5}
                                max={480}
                                step={5}
                                required
                              />
                              <span className="text-xs text-ink-muted">min</span>
                            </div>
                          </div>

                          {/*
                            El precio viaja siempre en el formulario, aunque esté
                            vacío: si no se enviara, guardar la ficha lo
                            borraría. Vacío significa "sin precio" y es la manera
                            de sacarlo de la web.
                          */}
                          <div>
                            <label
                              className="field-label"
                              htmlFor={`precio-${service.id}`}
                            >
                              Precio
                            </label>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-ink-muted">$</span>
                              <input
                                id={`precio-${service.id}`}
                                name="price"
                                type="number"
                                className="input w-32 tabular"
                                defaultValue={service.price ?? ""}
                                min={0}
                                step="0.01"
                                placeholder="Sin precio"
                              />
                            </div>
                          </div>

                          {/* Lo mismo con la seña: si no se enviara, guardar
                              cualquier otro cambio la borraría. */}
                          <div>
                            <label
                              className="field-label"
                              htmlFor={`sena-${service.id}`}
                            >
                              Seña
                            </label>
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-ink-muted">$</span>
                              <input
                                id={`sena-${service.id}`}
                                name="depositAmount"
                                type="number"
                                className="input w-32 tabular"
                                defaultValue={service.depositAmount ?? ""}
                                min={0}
                                step="0.01"
                                placeholder="Sin seña"
                              />
                            </div>
                          </div>

                          <div>
                            <label
                              className="field-label"
                              htmlFor={`orden-${service.id}`}
                            >
                              Orden
                            </label>
                            <input
                              id={`orden-${service.id}`}
                              name="sortOrder"
                              type="number"
                              className="input w-20 tabular"
                              defaultValue={service.sortOrder}
                              aria-label="Orden dentro de su categoría"
                            />
                          </div>

                          <label className="flex items-center gap-2 pb-2 text-sm">
                            <input
                              type="checkbox"
                              name="active"
                              defaultChecked={service.active}
                              className="size-4 accent-[var(--color-accent)]"
                            />
                            Aparece en la web
                          </label>
                        </div>

                        <p className="text-xs text-ink-muted">
                          La seña se cobra al reservar, y solo si el cobro online
                          está encendido en Cobros. Vacío o 0 = el turno se
                          confirma sin pagar nada.
                        </p>
                      </>
                    ) : null}

                    <div>
                      <label
                        className="field-label"
                        htmlFor={`descripcion-${service.id}`}
                      >
                        Qué es
                      </label>

                      <textarea
                        id={`descripcion-${service.id}`}
                        name="description"
                        className="input"
                        rows={3}
                        maxLength={SERVICE_DESCRIPTION_MAX}
                        defaultValue={service.description}
                        placeholder={`Explicá en dos o tres líneas de qué se trata ${service.name.toLowerCase()}.`}
                      />

                      <p className="mt-1.5 text-xs text-ink-muted">
                        Hasta {SERVICE_DESCRIPTION_MAX} caracteres. Si lo dejás
                        vacío, no se muestra ninguna ficha.
                      </p>
                    </div>

                    <label className="flex items-start gap-2 text-sm">
                      {/*
                        Deshabilitado sin foto cargada: un check encendido sin
                        imagen prometería un recuadro que no existe. Al estar
                        deshabilitado tampoco se envía, así que la acción lo
                        guarda apagado, que es justamente lo que corresponde.
                      */}
                      <input
                        type="checkbox"
                        name="showPhoto"
                        defaultChecked={service.showPhoto}
                        disabled={!service.photoUrl}
                        className="mt-0.5 size-4 accent-[var(--color-accent)] disabled:opacity-50"
                      />
                      <span>
                        Mostrar la foto en la web
                        <span className="block text-xs text-ink-muted">
                          {service.photoUrl
                            ? "Con esto apagado se muestra solo la explicación, sin recuadro."
                            : "Subí una foto para poder activarlo."}
                        </span>
                      </span>
                    </label>

                    <SubmitButton className="btn btn-primary">
                      Guardar servicio
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>

            {/* ── Alta ──────────────────────────────────────────────── */}
            {isAdmin ? (
              <div className="border-t border-line bg-surface-sunken px-4 py-4">
                <ActionForm action={saveService} resetOnSuccess>
                  <input type="hidden" name="professionalId" value={person.id} />
                  <input type="hidden" name="active" value="on" />

                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-40 flex-1">
                      <label
                        className="field-label"
                        htmlFor={`new-service-${person.id}`}
                      >
                        Servicio nuevo
                      </label>
                      <input
                        id={`new-service-${person.id}`}
                        name="name"
                        className="input"
                        placeholder="Esmaltado semipermanente"
                        required
                        maxLength={60}
                      />
                    </div>

                    <div>
                      <label
                        className="field-label"
                        htmlFor={`new-duration-${person.id}`}
                      >
                        Duración
                      </label>
                      <input
                        id={`new-duration-${person.id}`}
                        name="durationMinutes"
                        type="number"
                        className="input w-28 tabular"
                        defaultValue={60}
                        min={5}
                        max={480}
                        step={5}
                        required
                      />
                    </div>

                    <div>
                      <label
                        className="field-label"
                        htmlFor={`new-price-${person.id}`}
                      >
                        Precio
                      </label>
                      <input
                        id={`new-price-${person.id}`}
                        name="price"
                        type="number"
                        className="input w-28 tabular"
                        min={0}
                        step="0.01"
                        placeholder="Opcional"
                      />
                    </div>

                    <div>
                      <label
                        className="field-label"
                        htmlFor={`new-deposit-${person.id}`}
                      >
                        Seña
                      </label>
                      <input
                        id={`new-deposit-${person.id}`}
                        name="depositAmount"
                        type="number"
                        className="input w-28 tabular"
                        min={0}
                        step="0.01"
                        placeholder="Opcional"
                      />
                    </div>

                    <div>
                      <label
                        className="field-label"
                        htmlFor={`new-category-${person.id}`}
                      >
                        Categoría
                      </label>
                      <CategorySelect
                        id={`new-category-${person.id}`}
                        categories={categories}
                        value={null}
                        className="input w-52"
                      />
                    </div>

                    <SubmitButton className="btn btn-secondary">
                      <Icon name="plus" className="size-3.5" />
                      Agregar
                    </SubmitButton>
                  </div>

                  <p className="mt-2 text-xs text-ink-muted">
                    La explicación y la foto se cargan después, en la ficha que
                    aparece acá arriba.
                  </p>
                </ActionForm>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

/**
 * En qué card del catálogo entra el servicio.
 *
 * Sin categoría es una opción válida y la primera de la lista: el servicio
 * queda suelto en el primer nivel, que es donde estaban todos antes de que
 * existiera esta pantalla. Las categorías apagadas se ofrecen igual —con la
 * aclaración al lado—, porque asignar un servicio a una rama escondida es lo
 * que se hace justo antes de encenderla.
 */
function CategorySelect({
  id,
  categories,
  value,
  className = "input",
}: {
  id: string;
  categories: CategoryRow[];
  value: number | null;
  className?: string;
}) {
  return (
    <select
      id={id}
      name="categoryId"
      className={className}
      defaultValue={value ?? ""}
      aria-label="Categoría del servicio"
    >
      <option value="">— Sin categoría —</option>
      {categoryOptions(categories).map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
          {option.active ? "" : " (oculta)"}
        </option>
      ))}
    </select>
  );
}
