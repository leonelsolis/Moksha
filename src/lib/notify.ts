import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { adminUsers, professionals } from "@/db/schema";
import {
  sendBookingConfirmation,
  sendProfessionalBookingNotice,
  sendProfessionalCancellationNotice,
  type ProfessionalNoticeData,
} from "./email";
import { siteOrigin } from "./site-url";
import { isValidEmail, normalizeEmail } from "./validation";

/**
 * Los avisos de un turno: a la clienta y a la profesional.
 *
 * El grueso del archivo son los de la profesional, que son los que necesitan
 * resolver a dónde mandarlos.
 *
 * El destinatario no se configura en ningún lado: es el email de contacto de
 * las cuentas del panel vinculadas a esa profesional. Así, cambiar a quién le
 * llegan los avisos es cambiar el email de la cuenta, sin una segunda lista de
 * direcciones que se desincroniza.
 *
 * Nada de acá puede hacer fallar un turno. Si el envío falla, el turno ya está
 * guardado y el motivo queda en los logs del servidor, que es lo único que
 * explica después un mail que no llegó.
 */

/** Datos del turno que necesita el aviso. Coincide con una fila de `appointments`. */
export type AppointmentNotice = {
  professionalId: number;
  date: string;
  startMinute: number;
  endMinute: number;
  serviceName: string;
  firstName: string;
  lastName: string;
  dni: string;
  email: string;
  phone: string;
};

/**
 * A dónde avisar y con qué nombre saludar.
 *
 * Puede haber más de una cuenta apuntando a la misma profesional (por ejemplo
 * si comparte la agenda con alguien), así que devuelve todas las direcciones
 * activas, sin repetir.
 */
async function recipients(professionalId: number) {
  const [professional] = await db
    .select({ name: professionals.name })
    .from(professionals)
    .where(eq(professionals.id, professionalId))
    .limit(1);

  if (!professional) return null;

  const accounts = await db
    .select({ email: adminUsers.email })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.professionalId, professionalId),
        eq(adminUsers.active, true),
      ),
    );

  const emails = [
    ...new Set(
      accounts
        .map((row) => normalizeEmail(row.email))
        .filter((email) => isValidEmail(email)),
    ),
  ];

  if (emails.length === 0) return null;

  return { name: professional.name, emails };
}

function noticeData(
  appointment: AppointmentNotice,
  to: string,
  professionalName: string,
): ProfessionalNoticeData {
  return {
    to,
    professionalName,
    date: appointment.date,
    startMinute: appointment.startMinute,
    endMinute: appointment.endMinute,
    serviceName: appointment.serviceName,
    firstName: appointment.firstName,
    lastName: appointment.lastName,
    dni: appointment.dni,
    email: appointment.email,
    phone: appointment.phone,
  };
}

export async function notifyProfessionalNewBooking(appointment: AppointmentNotice) {
  try {
    const target = await recipients(appointment.professionalId);
    if (!target) return;

    for (const to of target.emails) {
      const result = await sendProfessionalBookingNotice(
        noticeData(appointment, to, target.name),
      );

      if (!result.sent) {
        console.warn("[email] no se avisó del turno nuevo:", result.reason);
      }
    }
  } catch (e) {
    console.warn("[email] falló el aviso de turno nuevo:", e);
  }
}

/**
 * Todo lo que se manda cuando un turno queda confirmado: el mail con el link a
 * la clienta y el aviso a la profesional.
 *
 * Está junto porque hay dos momentos en los que un turno se confirma —al
 * reservar sin cobro, y cuando se aprueba la seña— y los dos tienen que avisar
 * lo mismo. Nada de acá puede hacer fallar la confirmación: el turno ya está
 * guardado y la clienta ve el link en pantalla.
 */
export async function announceNewBooking(options: {
  appointment: AppointmentNotice;
  professionalName: string;
  /** Token en claro, para armar el link de la clienta. */
  token: string;
}) {
  const { appointment, professionalName, token } = options;

  const mail = await sendBookingConfirmation({
    to: appointment.email,
    firstName: appointment.firstName,
    professionalName,
    serviceName: appointment.serviceName,
    date: appointment.date,
    startMinute: appointment.startMinute,
    manageUrl: `${await siteOrigin()}/turno/${token}`,
  }).catch((e) => ({ sent: false, reason: String(e) }));

  if (!mail.sent) {
    console.warn("[email] no se envió la confirmación:", mail.reason);
  }

  await notifyProfessionalNewBooking(appointment);
}

export async function notifyProfessionalCancellation(
  appointment: AppointmentNotice,
  cancelledBy: "client" | "admin",
) {
  try {
    const target = await recipients(appointment.professionalId);
    if (!target) return;

    for (const to of target.emails) {
      const result = await sendProfessionalCancellationNotice({
        ...noticeData(appointment, to, target.name),
        cancelledBy,
      });

      if (!result.sent) {
        console.warn("[email] no se avisó de la cancelación:", result.reason);
      }
    }
  } catch (e) {
    console.warn("[email] falló el aviso de cancelación:", e);
  }
}
