import Link from "next/link";

import { BookingFlow } from "@/components/public/BookingFlow";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { bookingWindow, getPublicProfessionals } from "@/lib/availability";
import { nowInTz } from "@/lib/dates";
import { hasServiceInfo, type PublicProfessionalView } from "@/lib/public-types";
import { getSettings, settingInt } from "@/lib/settings";

/**
 * Página pública de reserva.
 *
 * Se calcula en cada visita (sin caché) porque la disponibilidad cambia con
 * cada turno que se toma o se cancela.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const settings = await getSettings();
  const today = nowInTz(settings.timezone).date;
  const window = bookingWindow(settings, today);

  const professionals = await getPublicProfessionals(today);

  const views: PublicProfessionalView[] = professionals.map((item) => ({
    id: item.professional.id,
    name: item.professional.name,
    specialty: item.professional.specialty,
    photoUrl: item.professional.photoUrl,
    bio: item.professional.bio,
    onVacation: item.onVacation,
    vacationUntil: item.vacationUntil,
    services: item.services.map((service) => ({
      id: service.id,
      name: service.name,
      durationMinutes: service.durationMinutes,
      price: service.price,
      description: service.description,
      // El interruptor del panel se resuelve acá: con la foto desactivada, su
      // dirección ni siquiera llega al navegador.
      photoUrl: service.showPhoto ? service.photoUrl : null,
    })),
  }));

  const everyoneOnVacation =
    views.length > 0 && views.every((item) => item.onVacation);

  /*
   * La página se ensancha solo si hay fichas de servicio que mostrar, porque
   * esa es la única razón para reservar la columna del costado. Sin ninguna
   * cargada, queda en la columna única de siempre.
   */
  const wide = views.some((item) => item.services.some(hasServiceInfo));

  return (
    <>
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
