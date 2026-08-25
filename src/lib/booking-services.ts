/**
 * Los servicios de un turno, que pueden ser más de uno.
 *
 * Una clienta que se hace pies y manos saca un solo turno con las dos cosas.
 * Eso no cambia la agenda: sigue siendo un turno, un horario y una fila; lo
 * que cambia es que la duración, el nombre y la seña salen de sumar lo
 * elegido. Esa cuenta se hace acá y no en cada pantalla para que el navegador
 * y el servidor cuenten igual.
 *
 * El tope existe para que un id repetido a mano en la URL no pida un hueco de
 * ocho horas en la agenda. Nadie se hace veinte servicios de una sentada.
 */

/** Cuántos servicios se pueden juntar en un mismo turno. */
export const MAX_SERVICES_PER_BOOKING = 6;

/**
 * Lee la lista de ids que llega del navegador.
 *
 * Acepta la forma nueva ("3,7") y la vieja ("3"), porque la disponibilidad se
 * pide por URL y puede haber una pestaña abierta de antes. Descarta lo que no
 * sea un id, saca repetidos —que solo servirían para inflar la duración— y
 * corta en el tope.
 */
export function readServiceIds(raw: string | null | undefined): number[] {
  if (!raw) return [];

  const ids: number[] = [];
  for (const part of raw.split(",")) {
    const id = Number(part.trim());
    if (!Number.isInteger(id) || id <= 0) continue;
    if (ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === MAX_SERVICES_PER_BOOKING) break;
  }

  return ids;
}

/** El nombre que se guarda y se muestra: "Pies + Manos". */
export function combinedServiceName(names: string[]): string {
  return names.join(" + ");
}
