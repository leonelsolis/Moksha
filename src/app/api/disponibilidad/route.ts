import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import { readServiceIds } from "@/lib/booking-services";
import { bookingWindow, getRangeAvailability } from "@/lib/availability";
import { isValidDateString, nowInTz } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

/**
 * Horarios libres de una profesional para un rango de fechas.
 *
 * La pantalla de reserva pide un mes entero de una vez y se queda con la
 * respuesta, así navegar entre días no dispara una consulta por día.
 *
 * El turno puede juntar varios servicios (pies y manos), así que el parámetro
 * es una lista de ids y lo que se busca en la agenda es un hueco del largo de
 * todos juntos.
 *
 * Devuelve únicamente los horarios reservables. Los ocupados no se envían al
 * navegador: no hace falta que el cliente sepa cuándo está tomada la agenda,
 * y así no se puede deducir la actividad del local desde afuera.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const professionalId = Number(params.get("professionalId"));
  const serviceIds = readServiceIds(params.get("serviceIds") ?? params.get("serviceId"));
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  if (!professionalId || serviceIds.length === 0) {
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

  const [professional] = await db
    .select()
    .from(professionals)
    .where(
      and(eq(professionals.id, professionalId), eq(professionals.active, true)),
    )
    .limit(1);

  if (!professional) {
    return NextResponse.json({ error: "Profesional no encontrada." }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(services)
    .where(
      and(
        inArray(services.id, serviceIds),
        eq(services.professionalId, professionalId),
        eq(services.active, true),
      ),
    );

  // Alcanza con que falte uno para que la duración pedida sea otra: no se
  // contesta con los horarios de una elección distinta a la que se hizo.
  if (rows.length !== serviceIds.length) {
    return NextResponse.json({ error: "Servicio no encontrado." }, { status: 404 });
  }

  const duration = rows.reduce((total, row) => total + row.durationMinutes, 0);

  const availability = await getRangeAvailability({
    professional,
    duration,
    fromDate,
    toDate,
    settings,
  });

  const days: Record<string, number[]> = {};
  for (const [date, day] of availability) {
    if (day.openSlots.length > 0) {
      days[date] = day.openSlots.map((slot) => slot.startMinute);
    }
  }

  return NextResponse.json(
    { days, window, duration },
    { headers: { "Cache-Control": "no-store" } },
  );
}
