import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/Icon";
import { AdminNav } from "@/components/admin/AdminNav";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Estructura del panel.
 *
 * La pantalla de login usa este mismo layout pero sin la navegación: cuando no
 * hay sesión se devuelven los children solos. Así el login no necesita estar
 * fuera de /admin ni duplicar el layout raíz.
 */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: IconName;
  ownerOnly: boolean;
};

const NAV: AdminNavItem[] = [
  { href: "/admin", label: "Turnos", icon: "list", ownerOnly: false },
  { href: "/admin/horarios", label: "Horarios", icon: "calendar", ownerOnly: true },
  { href: "/admin/profesionales", label: "Profesionales", icon: "users", ownerOnly: true },
  { href: "/admin/ajustes", label: "Ajustes", icon: "settings", ownerOnly: true },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // Sin sesión solo se puede estar en /admin/login (lo garantiza el middleware).
  if (!session) return <>{children}</>;

  const settings = await getSettings();
  const items = NAV.filter((item) => !item.ownerOnly || session.role === "owner");

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="truncate text-sm font-semibold tracking-tight">
              {settings.business_name}
            </span>
            <span className="hidden text-xs text-ink-muted sm:inline">Panel</span>
          </div>

          <div className="flex items-center gap-1">
            <Link
              href="/"
              target="_blank"
              className="hidden text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline sm:inline"
            >
              Ver el sitio
            </Link>

            <span className="mx-2 hidden text-sm text-ink-muted sm:inline">
              {session.displayName}
            </span>

            <form action={logout}>
              <button type="submit" className="btn btn-ghost btn-sm" title="Cerrar sesión">
                <Icon name="logout" className="size-4" />
                <span className="sr-only sm:not-sr-only">Salir</span>
              </button>
            </form>
          </div>
        </div>

        <AdminNav items={items} />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
