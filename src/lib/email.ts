import "server-only";

import { formatDateLong, formatMinute } from "./dates";
import { getSettings, settingBool } from "./settings";

/**
 * Envío de emails — DESACTIVADO por ahora.
 *
 * Está todo escrito pero apagado: mientras `email_enabled` esté en false (el
 * valor por defecto), estas funciones no hacen nada y el sistema funciona
 * igual, porque el link de cancelación se muestra en pantalla al confirmar.
 *
 * Para activarlo el día que haya hosting y dominio:
 *   1. Crear cuenta en https://resend.com (plan gratuito: 3.000 mails/mes).
 *   2. Verificar el dominio agregando los registros DNS que indica el panel.
 *      Sin dominio propio solo se puede enviar a la casilla del titular.
 *   3. Poner RESEND_API_KEY en el archivo .env.
 *   4. Cargar la dirección remitente en Ajustes y activar el envío.
 *
 * No hace falta instalar el SDK de Resend: se usa su API REST con fetch.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type BookingEmailData = {
  to: string;
  firstName: string;
  professionalName: string;
  serviceName: string;
  date: string;
  startMinute: number;
  manageUrl: string;
};

type SendResult = { sent: boolean; reason?: string };

async function send(payload: {
  to: string;
  subject: string;
  html: string;
}): Promise<SendResult> {
  const settings = await getSettings();

  if (!settingBool(settings, "email_enabled")) {
    return { sent: false, reason: "El envío de emails está desactivado." };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: "Falta RESEND_API_KEY." };
  if (!settings.email_from) {
    return { sent: false, reason: "Falta configurar la dirección remitente." };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: settings.email_from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!response.ok) {
      return { sent: false, reason: `Resend respondió ${response.status}.` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: `No se pudo enviar: ${String(error)}` };
  }
}

function layout(businessName: string, body: string) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917;line-height:1.6;max-width:520px">
  <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#78716c;margin:0 0 16px">${businessName}</p>
  ${body}
</div>`;
}

/**
 * Confirmación de turno. Nunca hace fallar la reserva: si el envío falla, el
 * turno ya está guardado y el cliente tiene el link en pantalla.
 */
export async function sendBookingConfirmation(data: BookingEmailData) {
  const settings = await getSettings();

  return send({
    to: data.to,
    subject: `Turno confirmado — ${formatDateLong(data.date)} a las ${formatMinute(data.startMinute)}`,
    html: layout(
      settings.business_name,
      `<h1 style="font-size:22px;margin:0 0 16px">Hola ${data.firstName}, tu turno quedó confirmado</h1>
       <table style="border-collapse:collapse;margin:0 0 24px">
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Fecha</td><td style="padding:4px 0"><strong>${formatDateLong(data.date, true)}</strong></td></tr>
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Hora</td><td style="padding:4px 0"><strong>${formatMinute(data.startMinute)}</strong></td></tr>
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Atiende</td><td style="padding:4px 0">${data.professionalName}</td></tr>
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Servicio</td><td style="padding:4px 0">${data.serviceName}</td></tr>
       </table>
       <p style="margin:0 0 8px">Si no vas a poder venir, avisanos desde este link:</p>
       <p style="margin:0 0 24px"><a href="${data.manageUrl}" style="color:#2f5d50">${data.manageUrl}</a></p>
       <p style="font-size:13px;color:#78716c;margin:0">Guardá este mail: el link es personal y sirve para ver o cancelar tu turno.</p>`,
    ),
  });
}

export async function sendCancellationConfirmation(data: {
  to: string;
  firstName: string;
  date: string;
  startMinute: number;
}) {
  const settings = await getSettings();

  return send({
    to: data.to,
    subject: `Turno cancelado — ${formatDateLong(data.date)}`,
    html: layout(
      settings.business_name,
      `<h1 style="font-size:22px;margin:0 0 16px">Tu turno fue cancelado</h1>
       <p style="margin:0 0 16px">Hola ${data.firstName}, cancelamos tu turno del <strong>${formatDateLong(data.date, true)} a las ${formatMinute(data.startMinute)}</strong>.</p>
       <p style="margin:0">Cuando quieras podés sacar uno nuevo desde nuestra web.</p>`,
    ),
  });
}
