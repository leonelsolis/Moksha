"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminNavGroup, AdminNavItem } from "@/app/admin/layout";
import { Icon } from "@/components/Icon";

/**
 * Navegación del panel, en dos filas.
 *
 * Arriba los grupos; abajo, solo si el grupo abierto tiene más de una
 * pantalla, sus pantallas. En el celular las dos filas se desplazan en
 * horizontal en lugar de apilarse, para no comerse media pantalla.
 */

/** Si la URL actual cae dentro de esta pantalla. */
function matches(href: string, pathname: string) {
  // "/admin" es prefijo de todo lo demás, así que solo cuenta exacto.
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminNav({
  groups,
  pendingMessages = 0,
  pendingTransfers = 0,
}: {
  groups: AdminNavGroup[];
  /** WhatsApp esperando en la cola. 0 = no se dibuja el indicador. */
  pendingMessages?: number;
  /** Transferencias esperando verificación. 0 = no se dibuja el indicador. */
  pendingTransfers?: number;
}) {
  const pathname = usePathname();

  /** Cuántos avisos le corresponden a una pantalla. */
  const badgeFor = (item: AdminNavItem) => {
    if (item.href === "/admin/mensajes") {
      return { count: pendingMessages, label: "mensajes sin mandar" };
    }
    if (item.href === "/admin/transferencias") {
      return { count: pendingTransfers, label: "transferencias sin verificar" };
    }
    return { count: 0, label: "" };
  };

  const activeGroup = groups.find((group) =>
    group.items.some((item) => matches(item.href, pathname)),
  );

  // La segunda fila solo aparece cuando hay algo que elegir en ella.
  const subItems =
    activeGroup && activeGroup.items.length > 1 ? activeGroup.items : [];

  return (
    <div className="mx-auto max-w-6xl px-4">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {groups.map((group) => {
          /*
           * Un grupo de una sola pantalla se presenta como esa pantalla: su
           * nombre y su ícono. "Equipo" con una sola ficha adentro no le dice
           * nada a nadie; "Mi perfil", sí.
           */
          const solo = group.items.length === 1 ? group.items[0] : null;
          const isActive = group === activeGroup;

          // El aviso del grupo junta los de sus pantallas: si la cola está en
          // una pantalla de adentro, desde afuera no se vería.
          const count = group.items.reduce(
            (total, item) => total + badgeFor(item).count,
            0,
          );

          return (
            <li key={group.label}>
              <Link
                href={group.items[0].href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "border-accent font-medium text-accent"
                    : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"
                }`}
              >
                <Icon name={solo?.icon ?? group.icon} className="size-4" />
                {solo?.label ?? group.label}

                {/* El contador de las colas. Es lo que hace que alguien se
                    acuerde de entrar a resolverlas. */}
                {count > 0 ? (
                  <span
                    className="tabular rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium leading-none text-white"
                    aria-label={`${count} pendientes`}
                  >
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      {subItems.length > 0 ? (
        <ul className="flex gap-1 overflow-x-auto border-t border-line py-1.5">
          {subItems.map((item) => {
            const isActive = matches(item.href, pathname);
            const badge = badgeFor(item);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors ${
                    isActive
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-ink-soft hover:bg-surface-sunken hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} className="size-3.5" />
                  {item.label}

                  {badge.count > 0 ? (
                    <span
                      className="tabular rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium leading-none text-white"
                      aria-label={`${badge.count} ${badge.label}`}
                    >
                      {badge.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
