import Link from "next/link";

import { saveSettings, sendTestEmailAction } from "@/app/actions/admin";
import { removeLogo, uploadLogo } from "@/app/actions/photos";
import { Alert } from "@/components/Alert";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { requireAdmin } from "@/lib/auth";
import { emailConfig } from "@/lib/email";
import { getSettings, settingBool } from "@/lib/settings";
import { defaultText, MESSAGE_PLACEHOLDERS } from "@/lib/whatsapp";

/**
 * Configuración del negocio.
 *
 * Todo lo de esta pantalla se guarda en la base, no en el código. Es lo que
 * permite instalar el mismo sistema en otro local: se despliega una copia
 * limpia y se completa desde acá.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  await requireAdmin();

  const settings = await getSettings();
  const mail = emailConfig(settings);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Datos del negocio y reglas de reserva y cancelación.
        </p>
      </div>

      {/* Va afuera del formulario de ajustes: el logo se sube y se quita por su
          cuenta, y un formulario no puede contener a otro. */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Logo</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Se muestra en el encabezado de la web pública.
          </p>
        </div>

        <div className="p-4">
          <ImageUpload
            id="logo"
            label="Imagen del logo"
            noun="logo"
            emptyIcon="image"
            hint="Sin logo se muestra el nombre en texto. Si el archivo es PNG con fondo transparente, se conserva."
            imageUrl={settings.business_logo_url || null}
            alt={settings.business_name}
            upload={uploadLogo}
            remove={removeLogo}
            maxSide={400}
            keepAlpha
            previewClassName="h-20 w-32"
            imageClassName="object-contain p-1.5"
          />
        </div>
      </section>

      <ActionForm action={saveSettings} className="space-y-5" feedback="top">
        {/* ── Negocio ───────────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Datos del negocio</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Aparecen en el encabezado y el pie de la web pública.
            </p>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="business_name">
                Nombre
              </label>
              <input
                id="business_name"
                name="business_name"
                className="input"
                defaultValue={settings.business_name}
                required
                maxLength={60}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="business_tagline">
                Título de la página de reservas
              </label>
              <input
                id="business_tagline"
                name="business_tagline"
                className="input"
                defaultValue={settings.business_tagline}
                maxLength={120}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="contact_phone">
                Teléfono de contacto
              </label>
              <input
                id="contact_phone"
                name="contact_phone"
                className="input"
                defaultValue={settings.contact_phone}
                maxLength={40}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="contact_instagram">
                Instagram
              </label>
              <input
                id="contact_instagram"
                name="contact_instagram"
                className="input"
                defaultValue={settings.contact_instagram}
                placeholder="@usuario"
                maxLength={60}
              />
            </div>

            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="contact_address">
                Dirección
              </label>
              <input
                id="contact_address"
                name="contact_address"
                className="input"
                defaultValue={settings.contact_address}
                placeholder="Zuviría 7120, Rosario, Santa Fe"
                maxLength={120}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Con esto se arma el mapa: el que acompaña a la reserva y el que
                ve la clienta al confirmar el turno. Si queda vacía no aparece
                ningún mapa.{" "}
                <strong className="font-medium text-ink-soft">
                  Poné siempre la ciudad
                </strong>{" "}
                además de la calle y el número: sin ciudad, Google puede
                confundir la provincia con la capital y marcar otro punto.
                Después de guardar, mirá el mapa en la página de reservas para
                confirmar que cayó donde va.
              </p>
            </div>
          </div>
        </section>

        {/* ── Reservas ──────────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Reglas para sacar turno</h2>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="booking_window_days">
                Hasta cuántos días adelante se puede reservar
              </label>
              <input
                id="booking_window_days"
                name="booking_window_days"
                type="number"
                min={1}
                max={365}
                className="input tabular"
                defaultValue={settings.booking_window_days}
                required
              />
              <p className="mt-1 text-xs text-ink-muted">
                El calendario no muestra fechas más lejanas que esto.
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor="min_hours_before_booking">
                Anticipación mínima para reservar (horas)
              </label>
              <input
                id="min_hours_before_booking"
                name="min_hours_before_booking"
                type="number"
                min={0}
                max={720}
                className="input tabular"
                defaultValue={settings.min_hours_before_booking}
                required
              />
              <p className="mt-1 text-xs text-ink-muted">
                Con 2, nadie puede sacar un turno para dentro de una hora. Poné 0
                para permitir hasta último momento.
              </p>
            </div>

            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="timezone">
                Zona horaria
              </label>
              <input
                id="timezone"
                name="timezone"
                className="input"
                defaultValue={settings.timezone}
                required
              />
              <p className="mt-1 text-xs text-ink-muted">
                Determina qué hora es &ldquo;ahora&rdquo; para el sistema. Salvo
                que el local esté en otro país, dejala como está.
              </p>
            </div>
          </div>
        </section>

        {/* ── Cancelación ───────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Reglas para cancelar</h2>
          </div>

          <div className="space-y-3 p-4">
            <div className="max-w-sm">
              <label className="field-label" htmlFor="cancel_cutoff_hours">
                Hasta cuántas horas antes puede cancelar el cliente
              </label>
              <input
                id="cancel_cutoff_hours"
                name="cancel_cutoff_hours"
                type="number"
                min={0}
                max={720}
                className="input tabular"
                defaultValue={settings.cancel_cutoff_hours}
                required
              />
              <p className="mt-1 text-xs text-ink-muted">
                <strong>0 = sin límite</strong>, puede cancelar hasta la hora del
                turno. Con 24, deja de poder cancelar solo el último día y tiene
                que llamar. Desde el panel siempre podés cancelar cualquier turno.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="allow_client_lookup"
                defaultChecked={settingBool(settings, "allow_client_lookup")}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Permitir buscar el turno con DNI y email
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Es el respaldo para quien perdió el link. Si lo desactivás, solo
                  se puede acceder al turno con el link personal.
                </span>
              </span>
            </label>
          </div>
        </section>

        {/* ── Emails ────────────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Emails de confirmación</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Se mandan con Resend al reservar y al cancelar: uno al cliente y
              otro a la profesional, al email de contacto de su cuenta. El
              cliente ve su link en pantalla igual, así que un mail que no llega
              no le impide manejar el turno.
            </p>
          </div>

          <div className="space-y-3 p-4">
            {!mail.hasKey ? (
              <Alert tone="error">
                Falta cargar <code>RESEND_API_KEY</code> en el servidor. Hasta que
                esté, no sale ningún mail aunque marques la casilla.
              </Alert>
            ) : mail.enabled && !mail.from ? (
              <Alert tone="warning">
                El envío está activado pero falta la dirección remitente, así que
                no sale ningún mail.
              </Alert>
            ) : mail.ready ? (
              <Alert tone="success">
                Los emails están activos y saliendo desde {mail.from}.
              </Alert>
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="email_enabled"
                defaultChecked={settingBool(settings, "email_enabled")}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Enviar emails al reservar y al cancelar
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Requiere una cuenta de Resend con el dominio verificado. Ver el
                  README. Cubre también los avisos a las profesionales: si está
                  apagado, no reciben ninguno.
                </span>
              </span>
            </label>

            <div className="max-w-sm">
              <label className="field-label" htmlFor="email_from">
                Dirección remitente
              </label>
              <input
                id="email_from"
                name="email_from"
                type="email"
                className="input"
                defaultValue={settings.email_from}
                placeholder="turnos@tudominio.com"
              />
              <p className="mt-1 text-xs text-ink-muted">
                Tiene que ser de un dominio verificado en Resend. Para probar sin
                dominio propio podés usar <code>onboarding@resend.dev</code>, pero
                Resend solo lo deja llegar a tu propia casilla.
              </p>
            </div>
          </div>
        </section>

        {/* ── WhatsApp ──────────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Mensajes de WhatsApp</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              El sistema arma la lista de a quién escribirle y redacta el
              mensaje; en{" "}
              <Link
                href="/admin/mensajes"
                className="underline underline-offset-4"
              >
                Mensajes
              </Link>{" "}
              cada fila tiene un botón que abre WhatsApp con todo cargado y solo
              hay que apretar enviar.{" "}
              <strong className="font-medium text-ink-soft">
                No salen solos
              </strong>
              : para eso hace falta la API oficial de Meta, que exige un número
              dedicado, verificar la empresa y se paga por mensaje.
            </p>
          </div>

          <div className="space-y-3 p-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="whatsapp_enabled"
                defaultChecked={settingBool(settings, "whatsapp_enabled")}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Preparar mensajes de WhatsApp
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Si lo apagás, la pantalla de Mensajes queda vacía y deja de
                  anotarse nada nuevo.
                </span>
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="whatsapp_rebook_days">
                  A los cuántos días recordar que vuelva a reservar
                </label>
                <input
                  id="whatsapp_rebook_days"
                  name="whatsapp_rebook_days"
                  type="number"
                  min={1}
                  max={365}
                  className="input tabular"
                  defaultValue={settings.whatsapp_rebook_days}
                  required
                />
                <p className="mt-1 text-xs text-ink-muted">
                  Se cuentan desde la fecha del turno. Con 25, a alguien que se
                  atendió el 1 le aparece el recordatorio el 26. A quien ya
                  tiene otro turno reservado no se le recuerda nada.
                </p>
              </div>

              <div>
                <label className="field-label" htmlFor="whatsapp_country_code">
                  Prefijo del país
                </label>
                <input
                  id="whatsapp_country_code"
                  name="whatsapp_country_code"
                  className="input tabular"
                  defaultValue={settings.whatsapp_country_code}
                  inputMode="numeric"
                  maxLength={4}
                  required
                />
                <p className="mt-1 text-xs text-ink-muted">
                  Sin el +. 54 es Argentina. Se usa para armar el link cuando la
                  clienta dejó su teléfono sin prefijo, que es lo normal; el 0 y
                  el 15 se sacan solos.
                </p>
              </div>
            </div>

            <div>
              <label
                className="field-label"
                htmlFor="whatsapp_confirmation_text"
              >
                Mensaje de confirmación
              </label>
              <textarea
                id="whatsapp_confirmation_text"
                name="whatsapp_confirmation_text"
                className="input"
                rows={3}
                defaultValue={settings.whatsapp_confirmation_text}
                placeholder={defaultText("confirmation")}
                maxLength={900}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="whatsapp_rebooking_text">
                Mensaje para volver a reservar
              </label>
              <textarea
                id="whatsapp_rebooking_text"
                name="whatsapp_rebooking_text"
                className="input"
                rows={3}
                defaultValue={settings.whatsapp_rebooking_text}
                placeholder={defaultText("rebooking")}
                maxLength={900}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Los dos se pueden dejar vacíos: ahí sale el texto que ves en
                gris. Antes de mandar cada mensaje podés retocarlo, y eso no
                cambia lo que está guardado acá.
              </p>
            </div>

            <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
              <p className="text-xs font-medium text-ink-soft">
                Podés intercalar:
              </p>
              <ul className="mt-1 space-y-0.5">
                {MESSAGE_PLACEHOLDERS.map((placeholder) => (
                  <li key={placeholder.key} className="text-xs text-ink-muted">
                    <code className="text-ink-soft">{placeholder.key}</code> —{" "}
                    {placeholder.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <SubmitButton className="btn btn-primary">Guardar ajustes</SubmitButton>
      </ActionForm>

      {/* Va afuera del formulario de ajustes por la misma razón que el logo: un
          formulario no puede contener a otro. */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Probar el envío</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Manda un mail suelto para ver si la configuración anda, sin tener que
            sacar un turno de mentira. Funciona aunque el envío automático esté
            apagado. Guardá los ajustes antes de probar.
          </p>
        </div>

        <div className="p-4">
          <ActionForm action={sendTestEmailAction} className="space-y-3">
            <div className="max-w-sm">
              <label className="field-label" htmlFor="test-email">
                Enviar a
              </label>
              <input
                id="test-email"
                name="to"
                type="email"
                className="input"
                placeholder="vos@ejemplo.com"
                required
              />
            </div>

            <SubmitButton className="btn btn-ghost" pendingLabel="Enviando…">
              Enviar prueba
            </SubmitButton>
          </ActionForm>
        </div>
      </section>

    </div>
  );
}
