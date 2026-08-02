import type { MetadataRoute } from "next";

import { staticSiteOrigin } from "@/lib/site-url";

/**
 * El mapa del sitio.
 *
 * Una sola página, y es correcto que así sea: el resto o es privado (el panel),
 * o lleva el token de una persona (/turno/…), o está marcado como no indexable
 * (/cancelar). Poner acá una página con `noindex` sería mandarle a Google
 * instrucciones contradictorias.
 *
 * Igual conviene declararlo: es lo que se carga en Google Search Console para
 * pedir la indexación en vez de esperar a que el sitio se encuentre solo.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = staticSiteOrigin();
  if (!origin) return [];

  return [
    {
      url: origin,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
