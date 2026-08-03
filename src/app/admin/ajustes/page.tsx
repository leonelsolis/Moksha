import { saveSettings, sendTestEmailAction } from "@/app/actions/admin";
import { removeLogo, uploadLogo } from "@/app/actions/photos";
import { Alert } from "@/components/Alert";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { ImageUpload } from "@/components/admin/ImageUpload";
import { requireAdmin } from "@/lib/auth";
import { emailConfig } from "@/lib/email";
import { mercadoPagoConfig } from "@/lib/mercadopago";
import { getSettings, settingBool } from "@/lib/settings";

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
  const mp = mercadoPagoConfig(settings);

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
                placeholder="Av. Siempre Viva 742, Buenos Aires"
                maxLength={120}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Con esto se arma el mapa que ve la clienta al confirmar el
                turno. Escribila como la buscarías en Google Maps (calle,
                número y ciudad). Si queda vacía no aparece ningún mapa.
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

        {/* ── Cobros online ─────────────────────────────────────────── */}
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Cobros online</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Cobrar el turno con Mercado Pago al momento de reservarlo. Es
              opcional: con esto apagado la web funciona igual que siempre y el
              turno se reserva sin pagar nada.
            </p>
          </div>

          <div className="space-y-3 p-4">
            {!mp.hasToken ? (
              <Alert tone="warning">
                Falta cargar <code>MERCADOPAGO_ACCESS_TOKEN</code> en el
                servidor. Hasta que esté, no se cobra nada aunque marques la
                casilla.
              </Alert>
            ) : mp.ready && mp.isTestToken ? (
              <Alert tone="warning">
                El cobro está activo pero con credenciales de prueba: los pagos
                no son reales. Cambiá el token por el de producción cuando
                quieras empezar a cobrar de verdad.
              </Alert>
            ) : mp.ready ? (
              <Alert tone="success">El cobro con Mercado Pago está activo.</Alert>
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="mp_enabled"
                defaultChecked={settingBool(settings, "mp_enabled")}
                className="mt-0.5 size-4 accent-[var(--color-accent)]"
              />
              <span>
                Cobrar el turno con Mercado Pago
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Requiere una cuenta de Mercado Pago y su Access Token cargado
                  en el servidor. Ver el README.
                </span>
              </span>
            </label>
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
