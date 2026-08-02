import "server-only";

import { headers } from "next/headers";

/**
 * Dirección absoluta del sitio.
 *
 * En pantalla alcanza con una ruta relativa, pero dentro de un email
 * "/turno/abc" no lleva a ninguna parte: el link tiene que traer el dominio
 * completo. Se resuelve en dos pasos:
 *
 *   1. APP_URL, si está cargada. Es la única forma de fijar cuál es el dominio
 *      bueno cuando hay varios apuntando al mismo sitio (el .vercel.app y el
 *      del negocio): sin esto, el link del mail sale con el dominio por el que
 *      entró esa persona, que puede no ser el que querés mostrar.
 *
 *   2. Los headers del pedido, que traen el host real. Cubre producción y
 *      desarrollo sin configurar nada.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    const clean = configured.replace(/\/+$/, "");
    return /^https?:\/\//.test(clean) ? clean : `https://${clean}`;
  }

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";

  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return `${proto}://${host}`;
}
