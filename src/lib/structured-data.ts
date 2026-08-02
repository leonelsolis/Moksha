import "server-only";

import type { Settings } from "./settings";

/**
 * Datos estructurados (JSON-LD) del negocio.
 *
 * Es la ficha que Google lee para entender QUÉ es este sitio, en lugar de
 * adivinarlo del texto. Para un local de barrio importa más que cualquier
 * palabra clave: es lo que lo hace elegible para los resultados con mapa y
 * horarios en vez de un link suelto.
 *
 * El tipo es `BeautySalon`, que es un `LocalBusiness` más específico. Todo sale
 * de la configuración del panel: si un dato no está cargado, se omite la
 * propiedad en lugar de mandarla vacía, porque un campo vacío es peor que
 * ausente (Google lo marca como dato inválido).
 */

export type BusinessData = {
  settings: Settings;
  origin: string;
  /** Rubros de las profesionales activas, sin repetir. */
  specialties: string[];
  /** Nombres de los servicios que se pueden reservar. */
  services: string[];
  image: string | null;
};

/** "@usuario" o una URL completa → la dirección del perfil. */
function instagramUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) return raw;
  return `https://instagram.com/${raw.replace(/^@/, "")}`;
}

export function businessJsonLd({
  settings,
  origin,
  specialties,
  services,
  image,
}: BusinessData) {
  const instagram = instagramUrl(settings.contact_instagram);
  const address = settings.contact_address.trim();
  const phone = settings.contact_phone.trim();

  return {
    "@context": "https://schema.org",
    "@type": "BeautySalon",
    name: settings.business_name,
    description: businessDescription({ settings, specialties, address }),
    ...(origin ? { url: origin } : {}),
    ...(image ? { image } : {}),
    ...(phone ? { telephone: phone } : {}),
    ...(address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: address,
            addressCountry: "AR",
          },
        }
      : {}),
    ...(instagram ? { sameAs: [instagram] } : {}),
    ...(services.length > 0
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: "Servicios",
            itemListElement: services.map((name) => ({
              "@type": "Offer",
              itemOffered: { "@type": "Service", name },
            })),
          },
        }
      : {}),
  };
}

/**
 * La descripción que ve la gente en el resultado de búsqueda.
 *
 * Se arma con lo que el negocio ya cargó (rubros y dirección) en vez de pedir
 * un campo más en Ajustes. Google corta alrededor de los 160 caracteres, así
 * que se recorta antes de llegar ahí y siempre en un límite de palabra: una
 * frase cortada a la mitad se lee como un error.
 */
export function businessDescription({
  settings,
  specialties,
  address,
}: {
  settings: Settings;
  specialties: string[];
  address: string;
}) {
  const partes = [`Reservá tu turno online en ${settings.business_name}`];

  if (specialties.length > 0) {
    partes.push(listar(specialties));
  }

  if (address) partes.push(address);

  const texto = `${partes.join(". ")}. Elegís día y hora en un minuto, sin llamar.`;

  return recortar(texto, 160);
}

/**
 * "Uñas, cejas y pestañas".
 *
 * Se unen con comas y no con "y" antes del último, porque los rubros ya suelen
 * traer su propia conjunción ("Cejas y pestañas") y quedaría "uñas y cejas y
 * pestañas". Del segundo en adelante van en minúscula: en el medio de una
 * frase, la mayúscula del panel se lee como un error de tipeo.
 */
function listar(items: string[]) {
  return items
    .map((item, i) => (i === 0 ? item : item.charAt(0).toLowerCase() + item.slice(1)))
    .join(", ");
}

function recortar(texto: string, max: number) {
  if (texto.length <= max) return texto;
  const corte = texto.lastIndexOf(" ", max - 1);
  return `${texto.slice(0, corte > 0 ? corte : max - 1)}…`;
}
