import "server-only";

import { formatDateLong, formatMinute } from "./dates";
import { formatMoney } from "./money";
import { getSettings, settingBool, type Settings } from "./settings";

/**
 * Envío de emails con Resend.
 *
 * Se usa la API REST con fetch, sin instalar el SDK: es un solo POST.
 *
 * El envío está detrás de dos llaves que tienen que estar puestas las dos:
 *   · RESEND_API_KEY en el servidor (la clave no puede vivir en la base).
 *   · El interruptor "Enviar emails" en Ajustes, más la dirección remitente.
 *
 * Si falta cualquiera de las dos, el sistema sigue funcionando igual: el turno
 * se guarda y el cliente ve su link en la pantalla de confirmación. Un mail que
 * no sale nunca invalida un turno.
 *
 * Para ponerlo en marcha:
 *   1. Crear cuenta en https://resend.com (plan gratuito: 3.000 mails/mes).
 *   2. Verificar el dominio con los registros DNS que indica el panel. Sin
 *      dominio propio se puede probar con onboarding@resend.dev como
 *      remitente, pero Resend solo lo deja llegar a la casilla del titular.
 *   3. Cargar RESEND_API_KEY en el servidor (en Vercel: Settings → Env Vars).
 *   4. Activar el envío y poner el remitente en Ajustes.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type BookingEmailData = {
  to: string;
  firstName: string;
  professionalName: string;
  serviceName: string;
  date: string;
  startMinute: number;
  /**
   * Link personal para ver o cancelar. Puede faltar: cuando el turno lo
   * confirma el aviso de Mercado Pago, del token solo existe el hash en la
   * base, así que no hay link que poner. El mail sale igual, sin esa parte.
   */
  manageUrl?: string;
  /**
   * Seña cobrada, si hubo. Con esto el mail dice cuánto se pagó y avisa que
   * cancelar no lo devuelve. Va en `null` o sin poner cuando el turno se
   * confirmó sin cobro, que es el caso de siempre con Mercado Pago apagado.
   */
  depositAmount?: number | null;
};

export type SendResult = { sent: boolean; reason?: string };

type Payload = { to: string; subject: string; html: string };

/** Escapa lo que escribió el cliente: su nombre viaja dentro del HTML. */
function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Estado de la configuración, para mostrarlo en Ajustes. La dueña no tiene
 * cómo saber si la clave quedó cargada en el servidor: esto se lo dice.
 */
export function emailConfig(settings: Settings) {
  const hasKey = Boolean(process.env.RESEND_API_KEY);
  const enabled = settingBool(settings, "email_enabled");
  const from = settings.email_from.trim();

  return {
    hasKey,
    enabled,
    from,
    /** Solo con las tres cosas salen los mails automáticos. */
    ready: hasKey && enabled && Boolean(from),
  };
}

/**
 * Manda el mail sin mirar el interruptor de Ajustes. Lo usa la prueba de
 * envío, que justamente sirve para verificar la configuración antes de
 * activarla.
 */
async function deliver(payload: Payload, settings: Settings): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, reason: "Falta cargar RESEND_API_KEY en el servidor." };
  }

  const from = settings.email_from.trim();
  if (!from) {
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
        from,
        to: [payload.to],
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!response.ok) {
      // El cuerpo trae el motivo real ("domain is not verified", "invalid
      // api key", …). Sin esto, un mail que no llega no deja ninguna pista.
      const detail = await response.text().catch(() => "");
      console.error("[resend] rechazó el envío", response.status, detail);
      return {
        sent: false,
        reason: resendReason(response.status, detail),
      };
    }

    return { sent: true };
  } catch (e) {
    console.error("[resend] falló la conexión", e);
    return { sent: false, reason: "No se pudo conectar con Resend." };
  }
}

/** Traduce la respuesta de Resend a algo accionable desde el panel. */
function resendReason(status: number, detail: string) {
  const message = (() => {
    try {
      const parsed = JSON.parse(detail) as { message?: string };
      return parsed.message ?? detail;
    } catch {
      return detail;
    }
  })();

  if (status === 401 || status === 403) {
    return "Resend rechazó la clave. Revisá RESEND_API_KEY.";
  }
  if (status === 422 || status === 400) {
    return `Resend rechazó el envío: ${message || "revisá la dirección remitente y el dominio verificado."}`;
  }
  if (status === 429) {
    return "Resend está limitando los envíos. Probá de nuevo en un rato.";
  }
  return `Resend respondió ${status}. ${message}`.trim();
}

/** Manda solo si el envío automático está activado en Ajustes. */
async function send(payload: Payload): Promise<SendResult> {
  const settings = await getSettings();

  if (!settingBool(settings, "email_enabled")) {
    return { sent: false, reason: "El envío de emails está desactivado." };
  }

  return deliver(payload, settings);
}

function layout(businessName: string, body: string) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917;line-height:1.6;max-width:520px">
  <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#78716c;margin:0 0 16px">${esc(businessName)}</p>
  ${body}
</div>`;
}

/**
 * Botón de acción.
 *
 * Va armado con una tabla y no con un `<a>` con padding porque Outlook dibuja
 * el HTML con el motor de Word, que ignora el padding de un enlace: el botón
 * quedaría como un texto suelto del color equivocado. El color de fondo va en
 * `bgcolor` además de en el CSS por la misma razón.
 *
 * Quien lo use tiene que dejar también la URL escrita abajo. Varios clientes
 * recortan el HTML o lo muestran en texto plano, y ahí un botón no existe.
 */
function button(url: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px">
    <tr><td bgcolor="#2f5d50" style="border-radius:6px">
      <a href="${esc(url)}" style="display:inline-block;padding:13px 28px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(label)}</a>
    </td></tr>
  </table>`;
}

/**
 * Confirmación de turno. Nunca hace fallar la reserva: si el envío falla, el
 * turno ya está guardado y el cliente tiene el link en pantalla.
 */
export async function sendBookingConfirmation(data: BookingEmailData) {
  const settings = await getSettings();

  const deposit = data.depositAmount ?? 0;
  const hasDeposit = deposit > 0;

  return send({
    to: data.to,
    subject: `Turno confirmado — ${formatDateLong(data.date)} a las ${formatMinute(data.startMinute)}`,
    html: layout(
      settings.business_name,
      `<h1 style="font-size:22px;margin:0 0 16px">Hola ${esc(data.firstName)}, tu turno quedó confirmado</h1>
       <table style="border-collapse:collapse;margin:0 0 24px">
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Fecha</td><td style="padding:4px 0"><strong>${formatDateLong(data.date, true)}</strong></td></tr>
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Hora</td><td style="padding:4px 0"><strong>${formatMinute(data.startMinute)}</strong></td></tr>
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Atiende</td><td style="padding:4px 0">${esc(data.professionalName)}</td></tr>
         <tr><td style="padding:4px 24px 4px 0;color:#78716c">Servicio</td><td style="padding:4px 0">${esc(data.serviceName)}</td></tr>
         ${
           hasDeposit
             ? `<tr><td style="padding:4px 24px 4px 0;color:#78716c">Seña pagada</td><td style="padding:4px 0"><strong>${esc(formatMoney(deposit))}</strong></td></tr>`
             : ""
         }
       </table>
       ${
         // Junto al importe y antes del link de cancelar: se lee en el mismo
         // orden en el que después se decide cancelar.
         hasDeposit
           ? `<p style="margin:0 0 20px;font-size:13px;color:#78716c">En caso de cancelación no se reembolsa la seña.</p>`
           : ""
       }
       ${
         data.manageUrl
           ? `<p style="margin:0 0 8px">Si no vas a poder venir, avisanos desde este link:</p>
       <p style="margin:0 0 24px"><a href="${esc(data.manageUrl)}" style="color:#2f5d50">${esc(data.manageUrl)}</a></p>
       <p style="font-size:13px;color:#78716c;margin:0">Guardá este mail: el link es personal y sirve para ver o cancelar tu turno.</p>`
           : `<p style="margin:0">Si no vas a poder venir, avisanos con tiempo desde el link de tu turno o escribinos.</p>`
       }`,
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
       <p style="margin:0 0 16px">Hola ${esc(data.firstName)}, cancelamos tu turno del <strong>${formatDateLong(data.date, true)} a las ${formatMinute(data.startMinute)}</strong>.</p>
       <p style="margin:0">Cuando quieras podés sacar uno nuevo desde nuestra web.</p>`,
    ),
  });
}

/**
 * Link para recuperar la contraseña del panel.
 *
 * Sale con `deliver` y no con `send`, o sea salteando el interruptor de
 * Ajustes. Ese interruptor decide si se mandan los avisos de turnos; dejar a
 * alguien afuera de su propio panel no es parte de apagar esos avisos. Con la
 * clave de Resend cargada y un remitente configurado, este mail sale siempre.
 *
 * Lleva el nombre de usuario adentro porque una misma dirección puede estar en
 * más de una cuenta: sin eso, quien recibe dos mails no sabe cuál es cuál.
 */
export async function sendPasswordReset(data: {
  to: string;
  username: string;
  displayName: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Promise<SendResult> {
  const settings = await getSettings();

  return deliver(
    {
      to: data.to,
      subject: `Recuperar tu contraseña — ${settings.business_name}`,
      html: layout(
        settings.business_name,
        `<h1 style="font-size:22px;margin:0 0 16px">Hola ${esc(data.displayName || data.username)}</h1>
         <p style="margin:0 0 20px">Pediste recuperar la contraseña de la cuenta <strong>${esc(data.username)}</strong>. Entrá acá para elegir una nueva:</p>
         ${button(data.resetUrl, "Cambiar mi contraseña")}
         <p style="margin:0 0 8px;font-size:13px;color:#78716c">Si el botón no te funciona, copiá y pegá esta dirección en el navegador:</p>
         <p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${esc(data.resetUrl)}" style="color:#2f5d50">${esc(data.resetUrl)}</a></p>
         <p style="margin:0 0 16px">El link vence en ${data.expiresInMinutes} minutos y sirve una sola vez.</p>
         <p style="font-size:13px;color:#78716c;margin:0">Si no pediste esto, no hace falta que hagas nada: tu contraseña sigue siendo la de siempre.</p>`,
      ),
    },
    settings,
  );
}

/* ── Avisos a la profesional ─────────────────────────────────────────── */

/**
 * Los dos avisos que recibe la profesional en el email de su cuenta.
 *
 * A diferencia de los mails al cliente, estos sí llevan los datos de contacto
 * completos: son para que pueda ubicar a la persona sin entrar al panel.
 */
export type ProfessionalNoticeData = {
  to: string;
  professionalName: string;
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

function customerBlock(data: ProfessionalNoticeData) {
  return `<table style="border-collapse:collapse;margin:0 0 24px">
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">Fecha</td><td style="padding:4px 0"><strong>${formatDateLong(data.date, true)}</strong></td></tr>
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">Hora</td><td style="padding:4px 0"><strong>${formatMinute(data.startMinute)} a ${formatMinute(data.endMinute)}</strong></td></tr>
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">Servicio</td><td style="padding:4px 0">${esc(data.serviceName)}</td></tr>
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">Cliente</td><td style="padding:4px 0">${esc(data.firstName)} ${esc(data.lastName)}</td></tr>
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">DNI</td><td style="padding:4px 0">${esc(data.dni)}</td></tr>
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">Email</td><td style="padding:4px 0">${esc(data.email)}</td></tr>
    <tr><td style="padding:4px 24px 4px 0;color:#78716c">Teléfono</td><td style="padding:4px 0">${esc(data.phone) || "—"}</td></tr>
  </table>`;
}

export async function sendProfessionalBookingNotice(data: ProfessionalNoticeData) {
  const settings = await getSettings();

  return send({
    to: data.to,
    subject: `Turno nuevo — ${formatDateLong(data.date)} a las ${formatMinute(data.startMinute)}`,
    html: layout(
      settings.business_name,
      `<h1 style="font-size:22px;margin:0 0 16px">Te sacaron un turno</h1>
       <p style="margin:0 0 16px">Hola ${esc(data.professionalName)}, tenés un turno nuevo en tu agenda.</p>
       ${customerBlock(data)}
       <p style="font-size:13px;color:#78716c;margin:0">Podés ver toda tu agenda entrando al panel.</p>`,
    ),
  });
}

export async function sendProfessionalCancellationNotice(
  data: ProfessionalNoticeData & { cancelledBy: "client" | "admin" },
) {
  const settings = await getSettings();

  const who =
    data.cancelledBy === "client"
      ? "El cliente canceló el turno."
      : "Se canceló el turno desde el panel.";

  return send({
    to: data.to,
    subject: `Turno cancelado — ${formatDateLong(data.date)} a las ${formatMinute(data.startMinute)}`,
    html: layout(
      settings.business_name,
      `<h1 style="font-size:22px;margin:0 0 16px">Se liberó un horario</h1>
       <p style="margin:0 0 16px">Hola ${esc(data.professionalName)}. ${who} Ese horario vuelve a estar disponible para reservar.</p>
       ${customerBlock(data)}`,
    ),
  });
}

/**
 * Prueba de envío desde Ajustes. Sale aunque el interruptor esté apagado: es
 * para confirmar que la clave y el remitente andan antes de encenderlo.
 */
export async function sendTestEmail(to: string): Promise<SendResult> {
  const settings = await getSettings();

  return deliver(
    {
      to,
      subject: `Prueba de envío — ${settings.business_name}`,
      html: layout(
        settings.business_name,
        `<h1 style="font-size:22px;margin:0 0 16px">Andan los emails</h1>
         <p style="margin:0 0 16px">Si estás leyendo esto, la clave de Resend y la dirección remitente están bien cargadas.</p>
         <p style="margin:0;font-size:13px;color:#78716c">Activá &ldquo;Enviar emails al reservar y al cancelar&rdquo; en Ajustes para que salgan solos.</p>`,
      ),
    },
    settings,
  );
}
