import Link from "next/link";

import type { Settings } from "@/lib/settings";

/**
 * Encabezado y pie de la zona pública.
 *
 * El nombre, el logo y los datos de contacto salen de la configuración, no
 * del código: es lo que permite usar el mismo proyecto en otro negocio sin
 * tocar nada. Si no hay logo cargado, se muestra el nombre en texto.
 */

export function SiteHeader({ settings }: { settings: Settings }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3.5">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          {settings.business_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.business_logo_url}
              alt={settings.business_name}
              className="h-7 w-auto"
            />
          ) : (
            <span className="truncate text-base font-semibold tracking-tight">
              {settings.business_name}
            </span>
          )}
        </Link>

        <Link
          href="/cancelar"
          className="shrink-0 text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
        >
          Mi turno
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter({ settings }: { settings: Settings }) {
  const contacts = [
    settings.contact_phone,
    settings.contact_address,
    settings.contact_instagram,
  ].filter(Boolean);

  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>{settings.business_name}</span>
          {contacts.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </footer>
  );
}
