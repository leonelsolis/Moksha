import Link from "next/link";

import { logout } from "@/app/actions/auth";
import { Icon, type IconName } from "@/components/Icon";
import { AdminNav } from "@/components/admin/AdminNav";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { pendingTransferCount } from "@/lib/transfer";
import { pendingCount } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

export const metadata = { robots: { index: false, follow: false } };

/**
 * Estructura del panel.
 *
 * La pantalla de login usa este mismo layout pero sin la navegación: cuando no
 * hay sesión se devuelven los children solos. Así el login no necesita estar
 * fuera de /admin ni duplicar el layout raíz.
 *
 * La navegación tiene dos niveles. Arriba, siete grupos que responden a "qué
 * quiero hacer" —los turnos del día, el catálogo, el equipo, la plata, la
 * configuración—; abajo, y solo cuando el grupo tiene más de una pantalla, las
 * pantallas de ese grupo. Una sola fila de doce pestañas obligaba a recordar
 * en cuál de todas estaba cada cosa; agrupadas, alcanza con saber de qué se
 * trata lo que se busca.
 *
 * Un grupo con una sola pantalla visible no dibuja la segunda fila y toma el
 * nombre y el ícono de esa pantalla. Es lo que hace que la misma estructura
 * sirva para los dos roles sin escribir dos navegaciones: para una profesional
 * "Equipo" es directamente "Mi perfil", y "Ajustes" es "Mi cuenta".
 */

export type AdminNavItem = {
  href: string;
  label: string;
  icon: IconName;
  adminOnly: boolean;
  /** Al revés que `adminOnly`: la ficha propia solo la tiene una profesional. */
  professionalOnly?: boolean;
};

export type AdminNavGroup = {
  /** Nombre del grupo. Se ignora si queda una sola pantalla visible. */
  label: string;
  icon: IconName;
  items: AdminNavItem[];
};

const NAV: AdminNavGroup[] = [
  {
    label: "Turnos",
    icon: "list",
    items: [{ href: "/admin", label: "Turnos", icon: "list", adminOnly: false }],
  },
  {
    label: "Mensajes",
    icon: "chat",
    items: [
      { href: "/admin/mensajes", label: "Mensajes", icon: "chat", adminOnly: false },
    ],
  },
  {
    label: "Horarios",
    icon: "calendar",
    items: [
      {
        href: "/admin/horarios",
        label: "Horarios",
        icon: "calendar",
        adminOnly: false,
      },
    ],
  },
  {
    // El catálogo: qué se ofrece y cómo se agrupa en la web.
    label: "Servicios",
    icon: "tag",
    items: [
      { href: "/admin/servicios", label: "Servicios", icon: "tag", adminOnly: false },
      {
        href: "/admin/categorias",
        label: "Categorías",
        icon: "folder",
        adminOnly: true,
      },
    ],
  },
  {
    // Quién trabaja y quién entra al panel. Para una profesional, su ficha.
    label: "Equipo",
    icon: "users",
    items: [
      {
        href: "/admin/profesionales",
        label: "Profesionales",
        icon: "users",
        adminOnly: true,
      },
      { href: "/admin/usuarios", label: "Usuarios", icon: "key", adminOnly: true },
      {
        href: "/admin/perfil",
        label: "Mi perfil",
        icon: "user",
        adminOnly: false,
        professionalOnly: true,
      },
    ],
  },
  {
    // Todo lo que tiene que ver con la plata que entra antes del turno.
    label: "Cobros",
    icon: "card",
    items: [
      {
        href: "/admin/depositos",
        label: "Señas y cobros",
        icon: "card",
        adminOnly: true,
      },
      {
        href: "/admin/transferencias",
        label: "Transferencias",
        icon: "card",
        adminOnly: false,
      },
    ],
  },
  {
    label: "Ajustes",
    icon: "settings",
    items: [
      { href: "/admin/ajustes", label: "Negocio", icon: "settings", adminOnly: true },
      { href: "/admin/cuenta", label: "Mi cuenta", icon: "lock", adminOnly: false },
    ],
  },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await getCurrentUser();

  // Sin sesión solo se puede estar en /admin/login (lo garantiza el middleware).
  if (!account) return <>{children}</>;

  const settings = await getSettings();
  const isAdmin = account.role === "admin";

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.adminOnly || isAdmin) && (!item.professionalOnly || !isAdmin),
    ),
  })).filter((group) => group.items.length > 0);

  /*
   * Cuántos WhatsApp esperan. Va en la navegación porque es lo único que hace
   * que alguien se acuerde de entrar: una cola que hay que ir a mirar a
   * propósito es una cola que no se mira. `pendingCount` no lanza nunca, así
   * que un problema contando no deja a nadie sin panel.
   */
  const [pending, pendingTransfers] = await Promise.all([
    pendingCount(account),
    /*
     * Y cuántas transferencias esperan que alguien las verifique. Es la misma
     * idea que la cola de WhatsApp, pero acá el costo de no mirar es más alto:
     * del otro lado hay una clienta que ya transfirió y todavía no tiene el
     * turno confirmado. Tampoco lanza nunca.
     */
    pendingTransferCount(account),
  ]);

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
              {account.displayName || account.username}
            </span>

            <form action={logout}>
              <button type="submit" className="btn btn-ghost btn-sm" title="Cerrar sesión">
                <Icon name="logout" className="size-4" />
                <span className="sr-only sm:not-sr-only">Salir</span>
              </button>
            </form>
          </div>
        </div>

        <AdminNav
          groups={groups}
          pendingMessages={pending}
          pendingTransfers={pendingTransfers}
        />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
