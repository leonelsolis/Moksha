"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminNavItem } from "@/app/admin/layout";
import { Icon } from "@/components/Icon";

/**
 * Navegación del panel. En el celular se desplaza en horizontal en lugar de
 * apilarse, para no comerse media pantalla.
 */
export function AdminNav({
  items,
  pendingMessages = 0,
  pendingTransfers = 0,
}: {
  items: AdminNavItem[];
  /** WhatsApp esperando en la cola. 0 = no se dibuja el indicador. */
  pendingMessages?: number;
  /** Transferencias esperando verificación. 0 = no se dibuja el indicador. */
  pendingTransfers?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="mx-auto max-w-6xl px-4">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? "border-accent font-medium text-accent"
                    : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"
                }`}
              >
                <Icon name={item.icon} className="size-4" />
                {item.label}

                {/* El contador de la cola de WhatsApp. Es lo que hace que
                    alguien se acuerde de entrar a mandarlos. */}
                {item.href === "/admin/mensajes" && pendingMessages > 0 ? (
                  <span
                    className="tabular rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium leading-none text-white"
                    aria-label={`${pendingMessages} mensajes sin mandar`}
                  >
                    {pendingMessages}
                  </span>
                ) : null}

                {/* Lo mismo para las transferencias sin verificar. Del otro
                    lado hay alguien que ya pagó y espera la confirmación. */}
                {item.href === "/admin/transferencias" && pendingTransfers > 0 ? (
                  <span
                    className="tabular rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-medium leading-none text-white"
                    aria-label={`${pendingTransfers} transferencias sin verificar`}
                  >
                    {pendingTransfers}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
