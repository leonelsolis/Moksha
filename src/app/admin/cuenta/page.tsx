import { eq } from "drizzle-orm";

import { changeOwnEmail } from "@/app/actions/auth";
import { Alert } from "@/components/Alert";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { PasswordForm } from "@/components/admin/PasswordForm";
import { db } from "@/db";
import { professionals } from "@/db/schema";
import { requireUser } from "@/lib/auth";

/**
 * La cuenta propia: contraseña y email de contacto.
 *
 * Está fuera de Ajustes porque Ajustes configura el negocio y solo lo abre la
 * administración, mientras que esto lo necesita cualquiera que entre al panel.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const account = await requireUser();

  const linked =
    account.professionalId === null
      ? null
      : ((
          await db
            .select({ name: professionals.name })
            .from(professionals)
            .where(eq(professionals.id, account.professionalId))
            .limit(1)
        )[0]?.name ?? null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mi cuenta</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Tu contraseña y la dirección donde recibís los avisos.
        </p>
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Datos de acceso</h2>
        </div>

        <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">
          <div>
            <dt className="field-label">Usuario</dt>
            <dd className="text-sm tabular">{account.username}</dd>
          </div>

          <div>
            <dt className="field-label">Nombre para mostrar</dt>
            <dd className="text-sm">{account.displayName || "—"}</dd>
          </div>

          <div>
            <dt className="field-label">Rol</dt>
            <dd className="text-sm">
              {account.role === "admin" ? "Administración" : "Profesional"}
            </dd>
          </div>

          <div>
            <dt className="field-label">Agenda que ves</dt>
            <dd className="text-sm">
              {account.role === "admin"
                ? "Todas las profesionales"
                : (linked ?? "Ninguna: tu cuenta no está vinculada")}
            </dd>
          </div>
        </dl>

        <p className="border-t border-line px-4 py-2.5 text-xs text-ink-muted">
          El usuario, el nombre y el rol solo los cambia una cuenta de
          administración.
        </p>
      </section>

      {/* ── Email de contacto ────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Email de contacto</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            {account.role === "admin"
              ? "Queda guardado para la recuperación de contraseña."
              : "Acá te avisamos cuando te sacan un turno y cuando te lo cancelan."}
          </p>
        </div>

        <div className="p-4">
          {!account.email ? (
            <Alert tone="warning">
              Todavía no tenés email cargado, así que no te llega ningún aviso.
            </Alert>
          ) : null}

          <ActionForm action={changeOwnEmail} className="mt-3 space-y-3">
            <div className="max-w-sm">
              <label className="field-label" htmlFor="account-email">
                Dirección
              </label>
              <input
                id="account-email"
                name="email"
                type="email"
                className="input"
                defaultValue={account.email}
                placeholder="vos@ejemplo.com"
                required
              />
            </div>

            <SubmitButton className="btn btn-secondary">Guardar email</SubmitButton>
          </ActionForm>
        </div>
      </section>

      {/* ── Contraseña ───────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Tu contraseña</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Si la perdiste, pedile a la administración que te la resetee.
          </p>
        </div>

        <div className="p-4">
          <PasswordForm />
        </div>
      </section>
    </div>
  );
}
