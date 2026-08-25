import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { appointments, professionals, type Appointment } from "@/db/schema";
import { conflictingAppointmentIds } from "./availability";
import { notifyProfessionalNewBooking } from "./notify";

/**
 * Los otros tramos de una misma visita.
 *
 * Cuando una clienta se reparte entre dos profesionales, cada tramo es una fila
 * común de `appointments` y lo único que los une es `booking_group`. Acá vive
 * lo que hace falta saber sobre ese grupo, que son dos cosas:
 *
 *   · Mostrar la visita entera en la pantalla del turno, porque la clienta
 *     tiene un solo link y espera ver todo lo que sacó.
 *   · Confirmar los tramos que faltan cuando entra la seña, que se cobra una
 *     sola vez por visita y queda anotada en el primer tramo.
 *
 * Lo que NO hace es atarlos: cancelar sigue siendo tramo por tramo, y un tramo
 * que se pierde no arrastra al otro. El grupo es información, no una cadena.
 */

/** Un tramo de la visita, con el nombre de quién atiende. */
export type GroupLeg = {
  appointment: Appointment;
  professionalName: string;
  professionalSpecialty: string;
};

/**
 * Todos los tramos de una visita, en el orden en que se atienden.
 *
 * Devuelve la lista vacía cuando el turno no pertenece a ningún grupo, que es
 * el caso de todos los turnos de una sola profesional: quien llama no tiene
 * que preguntarse si hay grupo o no.
 */
export async function groupLegs(bookingGroup: string | null): Promise<GroupLeg[]> {
  if (!bookingGroup) return [];

  const rows = await db
    .select({
      appointment: appointments,
      professionalName: professionals.name,
      professionalSpecialty: professionals.specialty,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(eq(appointments.bookingGroup, bookingGroup))
    .orderBy(asc(appointments.date), asc(appointments.startMinute));

  return rows;
}

/**
 * Confirma los tramos que quedaron esperando la seña de otro.
 *
 * La seña de una visita repartida se cobra una sola vez, sobre el primer
 * tramo. Cuando ese pago se acredita, los demás tramos —que estaban retenidos
 * como pre-reserva sin importe propio— tienen que pasar a confirmados: para la
 * clienta ya está todo pago.
 *
 * Es idempotente: el estado va en el WHERE, así que si el aviso de Mercado Pago
 * y la vuelta del checkout llegan juntos, el segundo no confirma nada de nuevo
 * ni manda un segundo aviso.
 *
 * Puede pasar que un tramo se haya quedado sin horario mientras se pagaba —la
 * retención vence y otra persona lo toma—. Ese tramo no se confirma: dos turnos
 * encima no se arreglan con nada. Se marca como vencido y queda en los logs,
 * que es lo que después explica por qué la clienta viene con un solo turno
 * habiendo pagado dos.
 *
 * No lanza nunca: lo llaman los caminos de acreditación, y ahí una excepción
 * dejaría un pago sin registrar o a Mercado Pago reintentando en loop.
 */
export async function confirmGroupSiblings(
  head: Pick<Appointment, "id" | "bookingGroup">,
  now = Math.floor(Date.now() / 1000),
): Promise<number[]> {
  if (!head.bookingGroup) return [];

  try {
    const siblings = await db
      .select({
        appointment: appointments,
        professionalName: professionals.name,
      })
      .from(appointments)
      .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
      .where(
        and(
          eq(appointments.bookingGroup, head.bookingGroup),
          ne(appointments.id, head.id),
          eq(appointments.status, "pending_payment"),
        ),
      );

    const confirmed: number[] = [];

    for (const { appointment } of siblings) {
      const conflicts = await conflictingAppointmentIds({
        professionalId: appointment.professionalId,
        date: appointment.date,
        startMinute: appointment.startMinute,
        endMinute: appointment.endMinute,
        excludeId: appointment.id,
      });

      if (conflicts.length > 0) {
        console.error(
          `[reserva] el turno ${appointment.id} es parte de una visita que se pagó, pero su horario ya lo tomó otra persona. Hay que hablar con la clienta.`,
        );
        await db
          .update(appointments)
          .set({ status: "expired_payment", holdExpiresAt: null })
          .where(eq(appointments.id, appointment.id))
          .catch(() => undefined);
        continue;
      }

      /*
       * `paidAt` queda en NULL a propósito: la seña se cobró sobre el primer
       * tramo y es ahí donde está anotada. Ponerla también acá haría figurar
       * dos cobros donde hubo uno.
       */
      const updated = await db
        .update(appointments)
        .set({ status: "booked", holdExpiresAt: null })
        .where(
          and(
            eq(appointments.id, appointment.id),
            eq(appointments.status, "pending_payment"),
          ),
        )
        .returning({ id: appointments.id });

      if (updated.length === 0) continue;

      confirmed.push(appointment.id);

      // A la clienta no se le manda nada por este tramo: el mail de la visita
      // sale una sola vez, desde el tramo que se cobró. A la profesional sí,
      // que es la que tiene que ver el turno en su agenda.
      await notifyProfessionalNewBooking({
        professionalId: appointment.professionalId,
        date: appointment.date,
        startMinute: appointment.startMinute,
        endMinute: appointment.endMinute,
        serviceName: appointment.serviceName,
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        dni: appointment.dni,
        email: appointment.email,
        phone: appointment.phone,
      });
    }

    return confirmed;
  } catch (e) {
    console.error("[reserva] no se pudieron confirmar los tramos de la visita", e);
    return [];
  }
}
