import Link from "next/link";
import { asc, count } from "drizzle-orm";

import { saveProfessional, toggleProfessionalActive } from "@/app/actions/admin";
import {
  removeProfessionalPhoto,
  uploadProfessionalPhoto,
} from "@/app/actions/photos";
import { createProfessionalWithAccount } from "@/app/actions/users";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

/**
 * Quiénes trabajan: su ficha, su foto y su alta.
 *
 * Es la pantalla de las personas, no la de lo que hacen. Los servicios viven
 * en Servicios —ahí se carga cada uno entero, con su duración, su precio y su
 * explicación—, los horarios y las vacaciones en Horarios, y las cuentas para
 * entrar al panel en Usuarios. Acá solo queda el atajo a cada una de esas
 * pantallas, con la cuenta de servicios al lado para ver de un vistazo a quién
 * le falta cargarlos: sin al menos uno no se le pueden sacar turnos.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Profesionales" };

export default async function ProfessionalsPage() {
  await requireAdmin();

  const [staff, serviceCounts] = await Promise.all([
    db
      .select()
      .from(professionals)
      .orderBy(asc(professionals.sortOrder), asc(professionals.name)),
    // Solo la cuenta: los servicios se editan en su propia pantalla.
    db
      .select({
        professionalId: services.professionalId,
        total: count(services.id),
      })
      .from(services)
      .groupBy(services.professionalId),
  ]);

  const countByProfessional = new Map(
    serviceCounts.map((row) => [row.professionalId, row.total]),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Profesionales</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          La ficha de cada una. Lo que ofrece se carga en{" "}
          <Link href="/admin/servicios" className="underline underline-offset-4">
            Servicios
          </Link>
          , cuándo trabaja en{" "}
          <Link href="/admin/horarios" className="underline underline-offset-4">
            Horarios
          </Link>{" "}
          y su cuenta para entrar al panel en{" "}
          <Link href="/admin/usuarios" className="underline underline-offset-4">
            Usuarios
          </Link>
          .
        </p>
      </div>

      {staff.map((person) => {
        const serviceCount = countByProfessional.get(person.id) ?? 0;

        return (
          <section key={person.id} className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <h2 className="text-sm font-semibold">{person.name}</h2>

                {person.specialty ? (
                  <span className="text-sm text-ink-soft">{person.specialty}</span>
                ) : null}

                {person.onVacation ? (
                  <span className="badge border-warning-line bg-warning-soft text-warning">
                    <Icon name="vacation" className="size-3" />
                    De vacaciones
                  </span>
                ) : null}

                {!person.active ? (
                  <span className="badge border-line-strong bg-surface-sunken text-ink-muted">
                    <Icon name="slash" className="size-3" />
                    No aparece en la web
                  </span>
                ) : null}

                {/* Sin servicios no se le pueden sacar turnos, así que la
                    falta se avisa acá y no solo en la otra pantalla. */}
                {serviceCount === 0 ? (
                  <span className="badge border-warning-line bg-warning-soft text-warning">
                    <Icon name="slash" className="size-3" />
                    Sin servicios
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Link href="/admin/servicios" className="btn btn-secondary btn-sm">
                  <Icon name="tag" className="size-3.5" />
                  Servicios
                  <span className="text-xs text-ink-muted">({serviceCount})</span>
                </Link>

                <Link
                  href={`/admin/horarios?prof=${person.id}`}
                  className="btn btn-secondary btn-sm"
                >
                  <Icon name="calendar" className="size-3.5" />
                  Horarios y vacaciones
                </Link>

                <ActionForm action={toggleProfessionalActive} feedback="none">
                  <input type="hidden" name="id" value={person.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={person.active ? "false" : "true"}
                  />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="…">
                    {person.active ? "Ocultar de la web" : "Mostrar en la web"}
                  </SubmitButton>
                </ActionForm>
              </div>
            </div>

            {person.onVacation ? (
              <p className="border-b border-line bg-warning-soft px-4 py-2 text-xs text-warning">
                Está marcada de vacaciones sin fecha de vuelta. No se le pueden
                sacar turnos hasta que se desmarque desde Horarios.
              </p>
            ) : null}

            {/* ── Datos ─────────────────────────────────────────────── */}
            <details className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm text-ink-soft hover:bg-surface-sunken">
                Foto y datos
                <Icon
                  name="chevronDown"
                  className="size-4 transition-transform group-open:rotate-180"
                />
              </summary>

              {/* Va fuera del formulario de datos: la foto se sube y se quita
                  por su cuenta, sin tocar el resto de la ficha. */}
              <div className="border-b border-line px-4 pb-4">
                <ImageUpload
                  id={`profesional-${person.id}`}
                  label="Foto"
                  noun="foto"
                  hint="Se achica sola, no importa el tamaño. Sale mejor si es cuadrada."
                  imageUrl={person.photoUrl}
                  alt={`Foto de ${person.name}`}
                  upload={uploadProfessionalPhoto}
                  remove={removeProfessionalPhoto}
                  hidden={{ professionalId: person.id }}
                />
              </div>

              <ActionForm action={saveProfessional} className="space-y-3 px-4 py-4">
                <input type="hidden" name="id" value={person.id} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor={`name-${person.id}`}>
                      Nombre
                    </label>
                    <input
                      id={`name-${person.id}`}
                      name="name"
                      className="input"
                      defaultValue={person.name}
                      required
                      maxLength={60}
                    />
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`specialty-${person.id}`}>
                      Qué hace
                    </label>
                    <input
                      id={`specialty-${person.id}`}
                      name="specialty"
                      className="input"
                      defaultValue={person.specialty}
                      placeholder="Uñas"
                      maxLength={60}
                    />
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`order-${person.id}`}>
                      Orden en la web
                    </label>
                    <input
                      id={`order-${person.id}`}
                      name="sortOrder"
                      type="number"
                      className="input"
                      defaultValue={person.sortOrder}
                    />
                  </div>

                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={person.active}
                        className="size-4 accent-[var(--color-accent)]"
                      />
                      Aparece en la web pública
                    </label>
                  </div>
                </div>

                <SubmitButton className="btn btn-primary">Guardar cambios</SubmitButton>
              </ActionForm>
            </details>

          </section>
        );
      })}

      {/* ── Alta ─────────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Agregar una profesional</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Se crea su ficha y su cuenta para entrar al panel, todo junto.
          </p>
        </div>

        <ActionForm action={createProfessionalWithAccount} className="p-4" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="new-name">
                Nombre
              </label>
              <input
                id="new-name"
                name="name"
                className="input"
                placeholder="Bianca Maidana"
                required
                maxLength={60}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="new-specialty">
                Qué hace
              </label>
              <input
                id="new-specialty"
                name="specialty"
                className="input"
                placeholder="Cejas y pestañas"
                maxLength={60}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="new-email">
                Email de contacto
              </label>
              <input
                id="new-email"
                name="email"
                type="email"
                className="input"
                placeholder="bianca@ejemplo.com"
                required
              />
              <p className="mt-1 text-xs text-ink-muted">
                Ahí le llega cada turno que le sacan y cada cancelación.
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="new-username">
                Usuario para entrar
              </label>
              <input
                id="new-username"
                name="username"
                className="input"
                placeholder="bianca"
                required
                pattern="[A-Za-z0-9._-]{3,30}"
                maxLength={30}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-ink-muted">
                Sin espacios ni acentos. Se puede cambiar después.
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="new-password">
                Contraseña
              </label>
              <input
                id="new-password"
                name="password"
                type="text"
                className="input"
                placeholder="Dejalo vacío y se genera una"
                autoComplete="off"
                minLength={8}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Mínimo 8 caracteres. Se muestra una sola vez al crearla.
              </p>
            </div>

            <div className="flex items-end pb-1">
              <SubmitButton className="btn btn-primary">
                <Icon name="plus" className="size-4" />
                Agregar y crear su cuenta
              </SubmitButton>
            </div>
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Después cargale al menos un servicio y sus horarios para que se le
            puedan sacar turnos. Ella misma puede editar su foto y su
            presentación desde Mi perfil.
          </p>
        </ActionForm>
      </section>
    </div>
  );
}
