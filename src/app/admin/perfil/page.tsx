import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import {
  removeProfessionalPhoto,
  uploadProfessionalPhoto,
} from "@/app/actions/photos";
import { updateOwnProfile } from "@/app/actions/profile";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { db } from "@/db";
import { professionals } from "@/db/schema";
import { requireUser, scopeOf } from "@/lib/auth";

/**
 * La ficha propia, para que cada profesional mantenga lo suyo sin depender de
 * la administración.
 *
 * Es la misma información que se ve en la web pública. No hay selector de
 * profesional ni id en la URL: la fila sale del usuario logueado, así que esta
 * pantalla no tiene forma de mostrar ni guardar la ficha de otra.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const account = await requireUser();
  const scope = scopeOf(account);

  // La administración edita las fichas de todas, con su nombre y su orden, en
  // la pantalla que ya existe para eso.
  if (scope === null) redirect("/admin/profesionales");

  const [me] =
    scope > 0
      ? await db
          .select()
          .from(professionals)
          .where(eq(professionals.id, scope))
          .limit(1)
      : [];

  if (!me) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Mi perfil</h1>
        <Alert tone="warning" title="Tu cuenta no está vinculada a ninguna profesional">
          Por eso no hay ficha para editar. Pedile a la administración que
          vincule tu cuenta desde Usuarios.
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mi perfil</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Así te ven las clientas cuando eligen con quién sacar turno.
        </p>
      </div>

      {!me.active ? (
        <Alert tone="warning" title="Tu ficha no aparece en la web">
          Podés editarla igual, pero no se muestra hasta que la administración
          la vuelva a publicar.
        </Alert>
      ) : null}

      {me.onVacation ? (
        <Alert tone="info">
          Estás marcada de vacaciones, así que no se te pueden sacar turnos.
          Cuando vuelvas, desmarcate en{" "}
          <a href="/admin/horarios" className="underline underline-offset-4">
            Horarios
          </a>
          .
        </Alert>
      ) : null}

      {/* Va afuera del formulario de datos: la foto se sube y se quita por su
          cuenta, y un formulario no puede contener a otro. */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Tu foto</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Sin foto se muestran tus iniciales.
          </p>
        </div>

        <div className="p-4">
          <ImageUpload
            id="mi-foto"
            label="Foto"
            noun="foto"
            hint="Se achica sola, no importa el tamaño. Sale mejor si es cuadrada."
            imageUrl={me.photoUrl}
            alt={`Foto de ${me.name}`}
            upload={uploadProfessionalPhoto}
            remove={removeProfessionalPhoto}
            hidden={{ professionalId: me.id }}
          />
        </div>
      </section>

      {/* ── Datos ────────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Tus datos</h2>
        </div>

        <ActionForm action={updateOwnProfile} className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="perfil-name">
                Tu nombre
              </label>
              <input
                id="perfil-name"
                name="name"
                className="input"
                defaultValue={me.name}
                required
                maxLength={60}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="perfil-specialty">
                Qué hacés
              </label>
              <input
                id="perfil-specialty"
                name="specialty"
                className="input"
                defaultValue={me.specialty}
                placeholder="Uñas"
                maxLength={60}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Se muestra abajo de tu nombre. Dos o tres palabras.
              </p>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="perfil-bio">
              Presentación
            </label>
            <textarea
              id="perfil-bio"
              name="bio"
              className="input min-h-24"
              defaultValue={me.bio}
              maxLength={400}
              placeholder="Contá en qué te especializás, hace cuánto trabajás, lo que quieras que sepan antes de reservar."
            />
            <p className="mt-1 text-xs text-ink-muted">Opcional, hasta 400 caracteres.</p>
          </div>

          <SubmitButton className="btn btn-primary">Guardar mi ficha</SubmitButton>
        </ActionForm>
      </section>

      <p className="text-xs text-ink-muted">
        <Icon name="info" className="mr-1 inline size-3.5 align-[-2px]" />
        Si aparecés en la web y en qué orden lo decide la administración. Tus
        horarios y vacaciones se cargan en Horarios, y la explicación de cada
        servicio en Servicios.
      </p>
    </div>
  );
}
