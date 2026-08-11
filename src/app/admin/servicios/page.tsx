import Link from "next/link";
import { asc, eq } from "drizzle-orm";

import { saveServiceInfo } from "@/app/actions/admin";
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
  categoryPathLabel,
  flattenCategories,
} from "@/lib/categories";
import { SERVICE_DESCRIPTION_MAX } from "@/lib/validation";

/**
 * La ficha pública de cada servicio: qué es, su foto y su precio.
 *
 * Es la única pantalla de configuración que comparten los dos roles. Cada
 * profesional entra y ve solo sus servicios; la administración los ve todos,
 * agrupados por profesional. El aislamiento no depende de esta pantalla: las
 * acciones vuelven a aplicar el alcance por su cuenta, porque un server action
 * es un endpoint propio al que se puede llamar sin pasar por acá.
 *
 * El precio se edita acá, junto al resto de lo que se muestra en la web, pero
 * solo la administración lo ve editable: para una profesional sigue siendo un
 * dato de lectura. El alta de servicios (nombre y duración) tampoco está acá:
 * eso define el negocio y vive en Profesionales.
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

  // Agrupadas en el orden en que vienen, que ya es el de la consulta.
  const groups = new Map<number, { name: string; items: typeof rows }>();
  for (const row of rows) {
    const group = groups.get(row.professionalId) ?? {
      name: row.professionalName,
      items: [] as typeof rows,
    };
    group.items.push(row);
    groups.set(row.professionalId, group);
  }

  // El orden dentro de cada categoría ya viene de la consulta y `sort` es
  // estable, así que reordenar por categoría no lo pisa.
  for (const group of groups.values()) {
    group.items.sort((a, b) => rankOf(a.categoryId) - rankOf(b.categoryId));
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Servicios</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Qué es cada servicio y cuánto sale. Aparece al costado cuando alguien
          lo elige para sacar un turno.
          {isAdmin ? (
            <>
              {" "}
              El nombre y la duración se cargan en{" "}
              <Link
                href="/admin/profesionales"
                className="underline underline-offset-4"
              >
                Profesionales
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="panel p-6 text-center">
          <p className="text-sm text-ink-soft">
            {isAdmin
              ? "Todavía no hay servicios cargados."
              : "Todavía no tenés servicios cargados. Los carga la administración."}
          </p>
        </div>
      ) : null}

      {[...groups].map(([professionalId, group]) => (
        <section key={professionalId} className="panel overflow-hidden">
          {/* Con un solo grupo el encabezado sobra: es el propio usuario. */}
          {isAdmin ? (
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">{group.name}</h2>
            </div>
          ) : null}

          <ul className="divide-y divide-line">
            {group.items.map((service, index) => (
              <li key={service.id} className="space-y-4 p-4">
                {/* Encabezado de categoría: se dibuja al empezar cada grupo, o
                    sea cuando el servicio anterior estaba en otra. Es la misma
                    estructura que ve la clienta en las cards. */}
                {index === 0 ||
                group.items[index - 1].categoryId !== service.categoryId ? (
                  <p className="eyebrow">
                    {service.categoryId === null
                      ? "Sin categoría"
                      : categoryPathLabel(categories, service.categoryId)}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <h3 className="text-sm font-medium">{service.name}</h3>

                  {/* Para la administración el precio está justo abajo, en su
                      campo; repetirlo acá solo daría dos números que se
                      contradicen mientras se edita. */}
                  <span className="text-xs tabular text-ink-muted">
                    {service.durationMinutes} min
                    {!isAdmin && service.price != null
                      ? ` · $${service.price.toLocaleString("es-AR")}`
                      : ""}
                  </span>

                  {!service.active ? (
                    <span className="badge border-line-strong bg-surface-sunken text-ink-muted">
                      <Icon name="slash" className="size-3" />
                      No aparece en la web
                    </span>
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

                <ActionForm action={saveServiceInfo} className="space-y-3">
                  <input type="hidden" name="id" value={service.id} />

                  {/*
                    El precio viaja siempre en el formulario, aunque esté vacío:
                    si no se enviara, guardar la ficha lo borraría. Vacío
                    significa "sin precio" y es la manera de sacarlo de la web.

                    Solo para la administración. La acción vuelve a comprobar el
                    rol: que el campo no se dibuje no impide mandarlo a mano.
                  */}
                  {isAdmin ? (
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
                          className="input w-36 tabular"
                          defaultValue={service.price ?? ""}
                          min={0}
                          step="0.01"
                          placeholder="Sin precio"
                        />
                      </div>

                      <p className="mt-1.5 text-xs text-ink-muted">
                        Se muestra junto al servicio al reservar. Si lo dejás
                        vacío no se muestra ningún precio.
                      </p>
                    </div>
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
                    Guardar ficha
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
