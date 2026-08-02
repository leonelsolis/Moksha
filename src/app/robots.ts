import type { MetadataRoute } from "next";

import { staticSiteOrigin } from "@/lib/site-url";

/**
 * Qué puede recorrer Google y qué no.
 *
 * Se bloquean tres zonas, cada una por su motivo:
 *
 *   · /admin      — el panel. No tiene nada que hacer en un buscador.
 *   · /turno/     — cada dirección lleva el token de cancelación de una
 *                   persona. Que aparezca en Google sería filtrar un link
 *                   privado con el que cualquiera podría cancelar ese turno.
 *   · /api/       — devuelve JSON, no páginas.
 *
 * `/cancelar` se deja pasar a propósito aunque la página lleve `noindex`: para
 * respetar esa marca, Google primero tiene que poder leerla. Bloquearla acá
 * conseguiría lo contrario, que es el error clásico de robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = staticSiteOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/turno/", "/api/"],
    },
    // Sin dominio configurado se omite: un sitemap con direcciones relativas
    // es peor que no declarar ninguno.
    sitemap: origin ? `${origin}/sitemap.xml` : undefined,
  };
}
