import { readServiceIds } from "./booking-services";

/**
 * Los tramos de una visita, cuando se reparte entre varias profesionales.
 *
 * Una clienta puede hacerse las manos con una y las cejas con otra en la misma
 * salida. Eso no es un turno con dos dueñas: son dos turnos, uno pegado al
 * otro, que se sacan de una sola vez. Cada tramo tiene su profesional y sus
 * servicios; la agenda de cada una ve un turno común y corriente.
 *
 * Van uno después del otro y en el orden en que se eligieron: el segundo
 * empieza cuando termina el primero. Nadie está en dos sillas a la vez.
 *
 * Acá vive solo cómo se escriben y se leen: es el formato que viaja en la URL
 * de la disponibilidad y en el formulario de reserva, así que el navegador y
 * el servidor tienen que entenderlo igual. Buscar el hueco es cosa de
 * `availability.ts`, y guardarlos, de la acción de reserva.
 */

/** Cuántas profesionales pueden repartirse una misma visita. */
export const MAX_LEGS = 3;

/** Un tramo tal como llega del navegador: ids y nada más. */
export type BookingLegIds = {
  professionalId: number;
  serviceIds: number[];
};

/**
 * El formato: `profesional:servicio,servicio|profesional:servicio`.
 *
 * Se eligió texto plano y no JSON porque esto viaja en un parámetro de la URL
 * de la disponibilidad, que se pide desde el navegador y queda a la vista; un
 * JSON escapado ahí adentro es ilegible al depurar y no aporta nada, porque lo
 * único que hay son números.
 */
export function writeLegs(legs: BookingLegIds[]): string {
  return legs
    .filter((leg) => leg.serviceIds.length > 0)
    .map((leg) => `${leg.professionalId}:${leg.serviceIds.join(",")}`)
    .join("|");
}

/**
 * Lee los tramos que llegan del navegador.
 *
 * Es la puerta de entrada de un dato que escribe el cliente, así que descarta
 * todo lo que no sea un tramo utilizable en vez de confiar: ids que no son
 * números, tramos sin servicios, una profesional repetida —que pediría dos
 * huecos en la misma agenda cuando lo suyo es un solo tramo con los dos
 * servicios— y lo que pase del tope.
 *
 * El tope existe por la misma razón que el de servicios: que una URL armada a
 * mano no pueda pedir un hueco de una jornada entera repartido en veinte
 * agendas.
 */
export function readLegs(raw: string | null | undefined): BookingLegIds[] {
  if (!raw) return [];

  const legs: BookingLegIds[] = [];
  for (const part of raw.split("|")) {
    const [rawProfessional, rawServices = ""] = part.split(":");

    const professionalId = Number(rawProfessional?.trim());
    if (!Number.isInteger(professionalId) || professionalId <= 0) continue;
    if (legs.some((leg) => leg.professionalId === professionalId)) continue;

    const serviceIds = readServiceIds(rawServices);
    if (serviceIds.length === 0) continue;

    legs.push({ professionalId, serviceIds });
    if (legs.length === MAX_LEGS) break;
  }

  return legs;
}

/**
 * Lee un pedido de reserva, venga en la forma nueva o en la vieja.
 *
 * La vieja —`professionalId` y `serviceIds` sueltos— es la que manda una
 * pestaña abierta desde antes de que existieran los tramos, y la que sigue
 * usando cualquier link viejo a la disponibilidad. Se traduce a un tramo
 * único, que es exactamente lo que significa.
 */
export function readLegsOrSingle(source: {
  legs?: string | null;
  professionalId?: string | null;
  serviceIds?: string | null;
}): BookingLegIds[] {
  const legs = readLegs(source.legs);
  if (legs.length > 0) return legs;

  const professionalId = Number(source.professionalId ?? "");
  if (!Number.isInteger(professionalId) || professionalId <= 0) return [];

  const serviceIds = readServiceIds(source.serviceIds);
  if (serviceIds.length === 0) return [];

  return [{ professionalId, serviceIds }];
}

