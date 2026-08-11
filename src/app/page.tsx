import type { Metadata } from "next";
import Link from "next/link";

import { BookingFlow } from "@/components/public/BookingFlow";
import { LocationCard } from "@/components/public/LocationCard";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { bookingWindow, getPublicProfessionals } from "@/lib/availability";
import { getCategoryRows } from "@/lib/catalog";
import { nowInTz } from "@/lib/dates";
import {
  buildCatalog,
  catalogServices,
  hasServiceInfo,
  type PublicProfessionalView,
} from "@/lib/public-types";
import { getSettings, settingInt } from "@/lib/settings";
import { staticSiteOrigin } from "@/lib/site-url";
import { businessDescription, businessJsonLd } from "@/lib/structured-data";

/**
 * Página pública de reserva.
 *
 * Se calcula en cada visita (sin caché) porque la disponibilidad cambia con
 * cada turno que se toma o se cancela.
 */
export const dynamic = "force-dynamic";

/**
 * Lo que se ve en el resultado de Google y al compartir el link.
 *
 * La descripción no está escrita a mano: se arma con los rubros que hay
 * cargados y la dirección del negocio, así acompaña sola a lo que ofrece el
 * local sin que nadie tenga que acordarse de actualizarla.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const today = nowInTz(settings.timezone).date;
  const professionals = await getPublicProfessionals(today);

  const specialties = [
    ...new Set(
      professionals
        .map((item) => item.professional.specialty.trim())
        .filter(Boolean),
    ),
  ];

  const description = businessDescription({
    settings,
    specialties,
    address: settings.contact_address.trim(),
  });

  const origin = staticSiteOrigin();

  return {
    description,
    alternates: origin ? { canonical: "/" } : undefined,
    openGraph: { description, ...(origin ? { url: origin } : {}) },
    twitter: { description },
  };
}

export default async function HomePage() {
  const settings = await getSettings();
  const today = nowInTz(settings.timezone).date;
  const window = bookingWindow(settings, today);

  const [professionals, categories] = await Promise.all([
    getPublicProfessionals(today),
    getCategoryRows(),
  ]);

  const views: PublicProfessionalView[] = professionals.map((item) => {
    /*
     * El catálogo manda: la lista plana sale de recorrerlo, no al revés. Así
     * lo que se puede reservar y lo que se puede ver son exactamente lo mismo,
     * y una rama escondida desde el panel no deja un servicio reservable por
     * una vía y no por la otra.
     */
    const catalog = buildCatalog(
      item.services.map((service) => ({
        id: service.id,
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: service.price,
        categoryId: service.categoryId,
        description: service.description,
        // El interruptor del panel se resuelve acá: con la foto desactivada, su
        // dirección ni siquiera llega al navegador.
        photoUrl: service.showPhoto ? service.photoUrl : null,
      })),
      categories,
    );

    return {
      id: item.professional.id,
      name: item.professional.name,
      specialty: item.professional.specialty,
      photoUrl: item.professional.photoUrl,
      bio: item.professional.bio,
      onVacation: item.onVacation,
      vacationUntil: item.vacationUntil,
      services: catalogServices(catalog),
      catalog,
    };
  });

  const everyoneOnVacation =
    views.length > 0 && views.every((item) => item.onVacation);

  // El mapa sale de la dirección cargada en Ajustes; sin dirección no se
  // muestra nada y la página queda igual que antes.
  const address = settings.contact_address.trim();
  const showMap = address !== "";

  /*
   * La página se ensancha solo si hay algo para la columna del costado: el mapa
   * del local o fichas de servicio. Sin nada de eso, queda en la columna única
   * de siempre.
   */
  const wide =
    showMap || views.some((item) => item.services.some(hasServiceInfo));

  /*
   * Ficha del negocio para los buscadores. Se arma con lo que ya está cargado
   * en el panel; si falta un dato, sale sin esa propiedad.
   */
  const jsonLd = businessJsonLd({
    settings,
    origin: staticSiteOrigin(),
    specialties: [
      ...new Set(views.map((v) => v.specialty.trim()).filter(Boolean)),
    ],
    services: [
      ...new Set(views.flatMap((v) => v.services.map((s) => s.name.trim()))),
    ].filter(Boolean),
    image:
      settings.business_logo_url.trim() ||
      views.find((v) => v.photoUrl)?.photoUrl ||
      null,
  });

  return (
    <>
      {/*
        Va en el HTML que llega de entrada, no inyectado después: el robot de
        Google lee la primera respuesta y no siempre ejecuta el JavaScript.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <SiteHeader settings={settings} />

      {/*
        67rem = las 48 de la columna del flujo (max-w-3xl) + 1 de separación +
        las 18 de la ficha del costado. Con esa medida exacta, el flujo
        conserva su ancho de siempre y el texto de arriba sigue alineado con él.
      */}
      <main
        className={`mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10 ${
          wide ? "xl:max-w-[67rem]" : ""
        }`}
      >
        <div className="mb-6 sm:mb-8 xl:max-w-3xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {settings.business_tagline}
          </h1>
          <p className="mt-2 text-sm text-ink-soft sm:text-base">
            Elegí con quién, qué día y a qué hora. Lleva menos de un minuto y no
            hace falta crear ninguna cuenta.
          </p>
        </div>

        {views.length === 0 ? (
          <div className="panel p-6 text-center">
            <p className="text-sm text-ink-soft">
              Todavía no hay profesionales cargadas. Si administrás el negocio,
              entrá al{" "}
              <Link
                href="/admin"
                className="text-accent underline underline-offset-4"
              >
                panel
              </Link>{" "}
              para configurarlas.
            </p>
          </div>
        ) : everyoneOnVacation ? (
          <div className="panel p-6">
            <h2 className="text-base font-medium">Estamos de vacaciones</h2>
            <p className="mt-1.5 text-sm text-ink-soft">
              Por ahora no estamos tomando turnos. Volvé a intentar en unos días.
            </p>
          </div>
        ) : (
          <BookingFlow
            professionals={views}
            window={{ today, lastDate: window.to }}
            cancelCutoffHours={settingInt(settings, "cancel_cutoff_hours")}
            location={
              showMap ? (
                <LocationCard
                  address={address}
                  businessName={settings.business_name}
                />
              ) : null
            }
          />
        )}

        <div className="mt-8 border-t border-line pt-5 xl:max-w-3xl">
          <p className="text-sm text-ink-soft">
            ¿Ya tenés un turno?{" "}
            <Link
              href="/cancelar"
              className="font-medium text-accent underline underline-offset-4"
            >
              Consultalo o cancelalo acá
            </Link>
          </p>
        </div>
      </main>

      <SiteFooter settings={settings} />
    </>
  );
}
