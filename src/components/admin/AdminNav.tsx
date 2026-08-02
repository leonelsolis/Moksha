"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminNavItem } from "@/app/admin/layout";
import { Icon } from "@/components/Icon";

/**
 * Navegación del panel. En el celular se desplaza en horizontal en lugar de
 * apilarse, para no comerse media pantalla.
 */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
