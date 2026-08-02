import { asc, eq } from "drizzle-orm";

import {
  createUser,
  resetUserPassword,
  toggleUserActive,
  updateUser,
} from "@/app/actions/users";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { db } from "@/db";
import { adminUsers, professionals } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

/**
 * Cuentas del panel.
 *
 * Una fila por cuenta, con el rol y la profesional a la que está atada. Es la
 * pantalla que define quién ve qué: una cuenta 'profesional' solo ve la agenda
 * y los horarios de la profesional vinculada acá.
 *
 * Las contraseñas nunca se muestran. Cuando alguien pierde la suya se le
 * genera una nueva desde acá y se le pasa una sola vez.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Usuarios" };

const ROLE_LABEL = {
  admin: "Administración",
  profesional: "Profesional",
} as const;

function formatLastLogin(seconds: number | null) {
  if (!seconds) return "Nunca entró";
  return `Última entrada: ${new Date(seconds * 1000).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}`;
}

export default async function UsersPage() {
  const admin = await requireAdmin();

  const [users, staff] = await Promise.all([
    db
      .select()
      .from(adminUsers)
      .orderBy(asc(adminUsers.role), asc(adminUsers.username)),
    db
      .select()
      .from(professionals)
      .orderBy(asc(professionals.sortOrder), asc(professionals.name)),
  ]);

  const nameOf = new Map(staff.map((person) => [person.id, person.name]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Usuarios</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Quién entra al panel y qué ve cada uno.
        </p>
      </div>

      <Alert tone="info" title="Cómo funcionan los roles">
        <strong>Administración</strong> ve y gestiona los turnos, horarios y
        vacaciones de todas, y administra estas cuentas.{" "}
        <strong>Profesional</strong> solo ve su propia agenda y sus propios
        horarios: no accede a los datos de las demás.
      </Alert>

      {staff.length === 0 ? (
        <Alert tone="warning">
          Todavía no hay profesionales cargadas, así que no se pueden crear
          cuentas de ese rol. Cargalas primero en Profesionales.
        </Alert>
      ) : null}

      {users.map((user) => {
        const isSelf = user.id === admin.id;
        const linkedName =
          user.professionalId !== null
            ? (nameOf.get(user.professionalId) ?? "profesional eliminada")
            : null;

        return (
          <section key={user.id} className="panel overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                <h2 className="text-sm font-semibold">
                  {user.displayName || user.username}
                </h2>

                <span className="text-sm text-ink-soft">{user.username}</span>

                <span className="badge border-line-strong bg-surface-sunken text-ink-soft">
                  {ROLE_LABEL[user.role]}
                </span>

                {linkedName ? (
                  <span className="badge border-accent-line bg-accent-soft text-accent">
                    <Icon name="user" className="size-3" />
                    {linkedName}
                  </span>
                ) : null}

                {user.role === "profesional" && !linkedName ? (
                  <span className="badge border-warning-line bg-warning-soft text-warning">
                    <Icon name="alert" className="size-3" />
                    Sin vincular
                  </span>
                ) : null}

                {!user.active ? (
                  <span className="badge border-line-strong bg-surface text-ink-muted">
                    <Icon name="slash" className="size-3" />
                    Desactivada
                  </span>
                ) : null}

                {isSelf ? (
                  <span className="text-xs text-ink-muted">(sos vos)</span>
                ) : null}
              </div>

              {isSelf ? (
                <span className="text-xs text-ink-muted">
                  No podés desactivar tu propia cuenta
                </span>
              ) : (
                <ActionForm action={toggleUserActive} feedback="none">
                  <input type="hidden" name="id" value={user.id} />
                  <input
                    type="hidden"
                    name="active"
                    value={user.active ? "false" : "true"}
                  />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="…">
                    {user.active ? "Desactivar" : "Reactivar"}
                  </SubmitButton>
                </ActionForm>
              )}
            </div>

            {user.role === "profesional" && !linkedName ? (
              <p className="border-b border-line bg-warning-soft px-4 py-2 text-xs text-warning">
                Esta cuenta no está vinculada a ninguna profesional, así que no
                ve ningún turno. Elegí una abajo y guardá.
              </p>
            ) : null}

            {/* ── Datos y permisos ──────────────────────────────────── */}
            <details className="group border-b border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm text-ink-soft hover:bg-surface-sunken">
                <span>
                  Datos y permisos
                  <span className="ml-2 text-xs text-ink-muted">
                    {user.email || "sin email de contacto"}
                  </span>
                </span>
                <Icon
                  name="chevronDown"
                  className="size-4 transition-transform group-open:rotate-180"
                />
              </summary>

              <ActionForm action={updateUser} className="space-y-3 px-4 py-4">
                <input type="hidden" name="id" value={user.id} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor={`username-${user.id}`}>
                      Usuario para entrar
                    </label>
                    <input
                      id={`username-${user.id}`}
                      name="username"
                      className="input"
                      defaultValue={user.username}
                      required
                      pattern="[A-Za-z0-9._-]{3,30}"
                      maxLength={30}
                      autoComplete="off"
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      Sin espacios ni acentos. Si lo cambiás, avisale: es con lo
                      que entra al panel.
                    </p>
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`display-${user.id}`}>
                      Nombre para mostrar
                    </label>
                    <input
                      id={`display-${user.id}`}
                      name="displayName"
                      className="input"
                      defaultValue={user.displayName}
                      required
                      maxLength={60}
                    />
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`email-${user.id}`}>
                      Email de contacto
                    </label>
                    <input
                      id={`email-${user.id}`}
                      name="email"
                      type="email"
                      className="input"
                      defaultValue={user.email}
                      required
                    />
                    <p className="mt-1 text-xs text-ink-muted">
                      Recibe los avisos de turno nuevo y de cancelación.
                    </p>
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`role-${user.id}`}>
                      Rol
                    </label>
                    <select
                      id={`role-${user.id}`}
                      name="role"
                      className="input"
                      defaultValue={user.role}
                      disabled={isSelf}
                    >
                      <option value="admin">Administración</option>
                      <option value="profesional">Profesional</option>
                    </select>
                    {isSelf ? (
                      <p className="mt-1 text-xs text-ink-muted">
                        No podés cambiarte el rol a vos misma.
                      </p>
                    ) : null}
                    {/* Un select deshabilitado no se envía: sin esto, guardar
                        los datos propios borraría el rol. */}
                    {isSelf ? (
                      <input type="hidden" name="role" value={user.role} />
                    ) : null}
                  </div>

                  <div>
                    <label className="field-label" htmlFor={`prof-${user.id}`}>
                      Profesional vinculada
                    </label>
                    <select
                      id={`prof-${user.id}`}
                      name="professionalId"
                      className="input"
                      defaultValue={
                        user.professionalId !== null ? String(user.professionalId) : ""
                      }
                    >
                      <option value="">— ninguna —</option>
                      {staff.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                          {!person.active ? " (inactiva)" : ""}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-ink-muted">
                      Solo cuenta si el rol es Profesional. Define qué turnos ve.
                    </p>
                  </div>
                </div>

                <SubmitButton className="btn btn-primary">
                  Guardar cambios
                </SubmitButton>
              </ActionForm>
            </details>

            {/* ── Contraseña ────────────────────────────────────────── */}
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm text-ink-soft hover:bg-surface-sunken">
                <span>
                  Resetear contraseña
                  <span className="ml-2 text-xs text-ink-muted">
                    sin saber la anterior · {formatLastLogin(user.lastLoginAt)}
                  </span>
                </span>
                <Icon
                  name="chevronDown"
                  className="size-4 transition-transform group-open:rotate-180"
                />
              </summary>

              <ActionForm
                action={resetUserPassword}
                className="px-4 pb-4"
                resetOnSuccess
              >
                <input type="hidden" name="id" value={user.id} />

                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-52 flex-1">
                    <label className="field-label" htmlFor={`pass-${user.id}`}>
                      Contraseña nueva
                    </label>
                    <input
                      id={`pass-${user.id}`}
                      name="password"
                      type="text"
                      className="input"
                      placeholder="Dejalo vacío y se genera una"
                      autoComplete="off"
                      minLength={8}
                    />
                  </div>

                  <SubmitButton className="btn btn-secondary" pendingLabel="…">
                    Resetear
                  </SubmitButton>
                </div>

                <p className="mt-2 text-xs text-ink-muted">
                  No hace falta la contraseña actual: se pisa por la nueva. La
                  contraseña se muestra una sola vez, así que anotala y pasásela
                  antes de cerrar la pantalla. Las contraseñas se guardan
                  cifradas y no se pueden consultar, solo reemplazar.
                </p>
              </ActionForm>
            </details>
          </section>
        );
      })}

      {/* ── Alta ─────────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Crear una cuenta</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Para sumar una profesional nueva o dar otro acceso de
            administración.
          </p>
        </div>

        <ActionForm action={createUser} className="space-y-3 p-4" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="new-username">
                Usuario para entrar
              </label>
              <input
                id="new-username"
                name="username"
                className="input"
                placeholder="ana"
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
              <label className="field-label" htmlFor="new-display">
                Nombre para mostrar
              </label>
              <input
                id="new-display"
                name="displayName"
                className="input"
                placeholder="Ana"
                required
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
                placeholder="ana@ejemplo.com"
                required
              />
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
            </div>

            <div>
              <label className="field-label" htmlFor="new-role">
                Rol
              </label>
              <select
                id="new-role"
                name="role"
                className="input"
                defaultValue="profesional"
              >
                <option value="profesional">Profesional</option>
                <option value="admin">Administración</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="new-prof">
                Profesional vinculada
              </label>
              <select
                id="new-prof"
                name="professionalId"
                className="input"
                defaultValue="nueva"
              >
                <option value="nueva">— crear su ficha ahora —</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    vincular a {person.name}
                  </option>
                ))}
                <option value="">— ninguna —</option>
              </select>
              <p className="mt-1 text-xs text-ink-muted">
                Obligatoria si el rol es Profesional. Con &ldquo;crear su ficha
                ahora&rdquo; se da de alta la profesional junto con la cuenta.
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="new-specialty">
                Qué hace
              </label>
              <input
                id="new-specialty"
                name="specialty"
                className="input"
                placeholder="Uñas"
                maxLength={60}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Solo se usa al crear la ficha. Después lo edita ella misma desde
                Mi perfil.
              </p>
            </div>
          </div>

          <SubmitButton className="btn btn-primary">
            <Icon name="plus" className="size-4" />
            Crear cuenta
          </SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
