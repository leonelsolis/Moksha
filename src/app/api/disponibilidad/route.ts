import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { readLegsOrSingle } from "@/lib/booking-legs";
import { bookingWindow, getChainAvailability, type AvailabilityLeg } from "@/lib/availability";
import { isValidDateString, nowInTz } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

/**
 * Horarios libres para lo que la clienta está por reservar.
 *
 * La pantalla de reserva pide un mes entero de una vez y se queda con la
 * respuesta, así navegar entre días no dispara una consulta por día.
 *
 * Lo que se pide puede ser de tres formas, y todas terminan en lo mismo:
 *
 *   · Un servicio con una profesional, que es el caso de siempre.
 *   · Varios servicios con la misma profesional (pies y manos): se busca un
 *     hueco del largo de todos juntos.
 *   · Varios tramos con profesionales distintas: se busca un horario en el que
 *     entren todos, uno detrás del otro. Ver `booking-legs.ts`.
 *
 * Devuelve únicamente los horarios reservables. Los ocupados no se envían al
 * navegador: no hace falta que el cliente sepa cuándo está tomada la agenda,
 * y así no se puede deducir la actividad del local desde afuera.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const legIds = readLegsOrSingle({
    legs: params.get("legs"),
    professionalId: params.get("professionalId"),
    serviceIds: params.get("serviceIds") ?? params.get("serviceId"),
  });

  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  if (legIds.length === 0) {
    return NextResponse.json({ error: "Faltan parámetros." }, { status: 400 });
  }

  if (!isValidDateString(from) || !isValidDateString(to) || to < from) {
    return NextResponse.json({ error: "Rango de fechas inválido." }, { status: 400 });
  }

  const settings = await getSettings();
  const today = nowInTz(settings.timezone).date;
  const window = bookingWindow(settings, today);

  // El rango pedido se recorta a la ventana configurada, así nadie puede pedir
  // disponibilidad de dentro de dos años y forzar un cálculo enorme.
  const fromDate = from < window.from ? window.from : from;
  const toDate = to > window.to ? window.to : to;

  if (toDate < fromDate) {
    return NextResponse.json({ days: {}, window });
  }

  /*
   * Las profesionales y los servicios se traen en dos consultas para todos los
   * tramos juntos, no una por tramo: son como mucho un puñado de filas y así el
   * costo no crece con la cantidad de profesionales elegidas.
   */
  const professionalRows = await db
    .select()
    .from(professionals)
    .where(
      and(
        inArray(professionals.id, legIds.map((leg) => leg.professionalId)),
        eq(professionals.active, true),
      ),
    );

  const serviceRows = await db
    .select()
    .from(services)
    .where(
      and(
        inArray(services.id, legIds.flatMap((leg) => leg.serviceIds)),
        eq(services.active, true),
      ),
    );

  const legs: AvailabilityLeg[] = [];
  for (const leg of legIds) {
    const professional = professionalRows.find(
      (row) => row.id === leg.professionalId,
    );
    if (!professional) {
      return NextResponse.json(
        { error: "Profesional no encontrada." },
        { status: 404 },
      );
    }

    const chosen = serviceRows.filter(
      (row) =>
        leg.serviceIds.includes(row.id) && row.professionalId === professional.id,
    );

    // Alcanza con que falte uno para que la duración pedida sea otra: no se
    // contesta con los horarios de una elección distinta a la que se hizo.
    if (chosen.length !== leg.serviceIds.length) {
      return NextResponse.json(
        { error: "Servicio no encontrado." },
        { status: 404 },
      );
    }

    legs.push({
      professional,
      duration: chosen.reduce((total, row) => total + row.durationMinutes, 0),
    });
  }

  const availability = await getChainAvailability({
    legs,
    fromDate,
    toDate,
    settings,
  });

  const days: Record<string, number[]> = {};
  for (const [date, starts] of availability) {
    days[date] = starts;
  }

  const duration = legs.reduce((total, leg) => total + leg.duration, 0);

  return NextResponse.json(
    { days, window, duration },
    { headers: { "Cache-Control": "no-store" } },
  );
}
