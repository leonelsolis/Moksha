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
function normalize(value: string) {
  const clean = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(clean) ? clean : `https://${clean}`;
}

/**
 * El dominio del sitio sin mirar el pedido.
 *
 * `robots.txt` y `sitemap.xml` se generan fuera de un request, así que ahí no
 * hay headers de los que sacar el host. Se resuelve con lo que haya:
 *
 *   1. APP_URL, la dirección definitiva que se carga a mano.
 *   2. El dominio de producción que Vercel expone solo, como red de seguridad
 *      para no publicar un sitemap vacío si APP_URL se olvidó.
 *
 * Si no hay ninguna, devuelve cadena vacía y quien llama decide qué hacer.
 */
export function staticSiteOrigin(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return normalize(configured);

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return normalize(vercel);

  return "";
}

export async function siteOrigin(): Promise<string> {
  const configured = process.env.APP_URL?.trim();
  if (configured) return normalize(configured);

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
