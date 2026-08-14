import "server-only";

import { alias } from "drizzle-orm/sqlite-core";
import { and, eq, gt, isNull, lte, notExists, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  appointments,
  professionals,
  whatsappMessages,
  type AdminUser,
  type WhatsappKind,
} from "@/db/schema";
import { professionalScope } from "./auth";
import { addDays, formatDateLong, formatMinute, nowInTz } from "./dates";
import { getSettings, settingBool, settingInt, type Settings } from "./settings";
import { siteOrigin } from "./site-url";

/**
 * Mensajes de WhatsApp: la confirmación del turno y el recordatorio para
 * volver a reservar.
 *
 * ── Por qué no se mandan solos ──────────────────────────────────────────
 *
 * Mandar un WhatsApp desde un servidor exige la API oficial de Meta, y eso
 * significa un número de teléfono dedicado —que deja de poder usarse en la app
 * normal de WhatsApp—, verificación de la empresa ante Meta, plantillas de
 * texto aprobadas de antemano y un costo por mensaje. Un recordatorio del tipo
 * "ya podés volver a sacar turno" cae además en la categoría de marketing, la
 * más cara y la que exige consentimiento previo de la persona.
 *
 * Así que acá el sistema hace todo lo que se puede hacer gratis, que es casi
 * todo: decide a quién hay que escribirle, cuándo, y redacta el mensaje. Lo
 * único que queda a mano es el envío: en el panel, cada fila tiene un botón
 * que abre WhatsApp con el número y el texto ya cargados; quien atiende solo
 * aprieta enviar.
 *
 * Si algún día se contrata la API oficial, lo único que cambia es quién
 * despacha la cola. Todo lo de este archivo —a quién, cuándo y qué decirle—
 * sigue igual.
 *
 * ── Qué no puede fallar ─────────────────────────────────────────────────
 *
 * Nada de acá puede hacer fallar un turno. Encolar un mensaje va siempre
 * dentro de un try: si la cola no se escribe, el turno ya está guardado y lo
 * que se pierde es un recordatorio, no una reserva.
 */

/* ── Teléfonos ───────────────────────────────────────────────────────── */

/**
 * El teléfono como lo quiere WhatsApp: solo dígitos, con prefijo de país y sin
 * el 0 ni el 15.
 *
 * Hace falta porque la gente escribe su teléfono de todas las formas posibles
 * —"0341 15 512-3456", "+54 9 341 5123456", "3415123456"— y wa.me solo acepta
 * el número internacional pelado. Un número mal armado no abre ningún chat, y
 * eso es un mensaje que nunca sale.
 *
 * Las dos particularidades argentinas, que son justamente las que más se
 * escriben mal:
 *
 *   · El 0 de larga distancia y el 15 de celular son prefijos para discar
 *     dentro del país. En un número internacional no van.
 *   · WhatsApp exige un 9 entre el 54 y el código de área para los celulares.
 *     Sin ese 9, el link abre un chat vacío con un número inexistente.
 *
 * Devuelve null si lo que quedó no parece un teléfono. Es preferible no
 * mostrar el botón a mostrar uno que lleva a la nada.
 */
export function toWhatsappNumber(
  phone: string,
  countryCode = "54",
): string | null {
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  /*
   * Un + adelante (o el 00 con el que se marca desde un fijo) es la persona
   * diciendo explícitamente "este número ya está completo, con su país".
   */
  const explicit = /^\s*\+/.test(phone) || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);

  const cc = countryCode.replace(/\D/g, "") || "54";
  const isArgentina = cc === "54";

  /*
   * Un número extranjero escrito con su prefijo se devuelve tal cual. Sin
   * esto, un "+1 415…" de alguien de afuera terminaría con el 54 argentino
   * pegado adelante y el link no abriría ningún chat.
   */
  if (explicit && !digits.startsWith(cc)) {
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
  }

  /*
   * ¿Ya viene con el prefijo del país?
   *
   * Se pide además que sobre un número de largo plausible: si no, un celular
   * de Rosario ("341 512-3456") se leería como "34" + el resto solo porque
   * empieza con los mismos dígitos que un prefijo de país.
   */
  const alreadyInternational =
    digits.startsWith(cc) && digits.length >= cc.length + 8;

  let national = alreadyInternational ? digits.slice(cc.length) : digits;

  if (isArgentina) {
    // El 9 de celular no es parte del número: se saca acá y se vuelve a poner
    // al final, así el resultado es el mismo se haya escrito o no.
    if (alreadyInternational && national.length > 10 && national.startsWith("9")) {
      national = national.slice(1);
    }

    national = national.replace(/^0+/, "");

    /*
     * El 15 va después del código de área, que mide entre 2 y 4 dígitos. Como
     * no hay forma de saber cuál es sin una tabla de códigos de área, se busca
     * el 15 en las tres posiciones donde puede estar y se acepta el recorte
     * que deje un número nacional de 10 dígitos, que es lo que mide cualquier
     * teléfono argentino.
     */
    if (national.length > 10) {
      for (const at of [2, 3, 4]) {
        if (
          national.slice(at, at + 2) === "15" &&
          national.length - 2 === 10
        ) {
          national = national.slice(0, at) + national.slice(at + 2);
          break;
        }
      }
    }
  } else {
    national = national.replace(/^0+/, "");
  }

  if (!national) return null;

  // El 9 de celular. Los fijos también lo toleran en wa.me, y en un negocio de
  // turnos el teléfono que deja la clienta es su celular en la práctica.
  const full =
    isArgentina && national.length === 10
      ? `${cc}9${national}`
      : `${cc}${national}`;

  // El rango de la norma E.164, que es el mismo que ya valida el formulario.
  if (full.length < 10 || full.length > 15) return null;

  return full;
}

/** El link que abre WhatsApp con el chat y el mensaje ya cargados. */
export function whatsappLink(number: string, message: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/* ── Los textos ──────────────────────────────────────────────────────── */

/**
 * Lo que se puede intercalar en un mensaje. Se muestra tal cual en Ajustes,
 * así que la descripción es la ayuda que lee quien escribe el texto.
 */
export const MESSAGE_PLACEHOLDERS = [
  { key: "{nombre}", label: "el nombre de la clienta" },
  { key: "{servicio}", label: "el servicio del turno" },
  { key: "{fecha}", label: "la fecha del turno" },
  { key: "{hora}", label: "la hora del turno" },
  { key: "{profesional}", label: "quién la atiende" },
  { key: "{negocio}", label: "el nombre del local" },
  { key: "{link}", label: "el link para sacar turno" },
] as const;

const DEFAULT_CONFIRMATION =
  "¡Hola {nombre}! Te confirmo tu turno en {negocio}: {servicio}, el {fecha} a las {hora} con {profesional}. " +
  "Si no vas a poder venir avisanos con tiempo así se lo damos a otra persona. ¡Te esperamos!";

const DEFAULT_REBOOKING =
  "¡Hola {nombre}! ¿Cómo va todo? Pasaron unos días desde tu último {servicio} en {negocio}, " +
  "así que ya te toca el retoque. Si querés reservar tu lugar podés hacerlo acá: {link}";

export function defaultText(kind: WhatsappKind) {
  return kind === "confirmation" ? DEFAULT_CONFIRMATION : DEFAULT_REBOOKING;
}

/** Los datos con los que se completa un texto. */
export type MessageContext = {
  firstName: string;
  serviceName: string;
  date: string;
  startMinute: number;
  professionalName: string;
  businessName: string;
  bookingUrl: string;
};

/**
 * Reemplaza los marcadores del texto.
 *
 * Se recorren los marcadores y no el texto, así que lo que escriba la clienta
 * en su nombre nunca se vuelve a interpretar: si alguien se llama "{link}", su
 * nombre queda escrito tal cual en el mensaje.
 */
export function renderMessage(template: string, ctx: MessageContext) {
  const values: Record<string, string> = {
    "{nombre}": ctx.firstName,
    "{servicio}": ctx.serviceName || "tu servicio",
    "{fecha}": formatDateLong(ctx.date),
    "{hora}": formatMinute(ctx.startMinute),
    "{profesional}": ctx.professionalName,
    "{negocio}": ctx.businessName,
    "{link}": ctx.bookingUrl,
  };

  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(key).join(value);
  }
  return out;
}

/** El texto configurado para este tipo, o el de fábrica si está vacío. */
export function textFor(settings: Settings, kind: WhatsappKind) {
  const stored =
    kind === "confirmation"
      ? settings.whatsapp_confirmation_text
      : settings.whatsapp_rebooking_text;

  return stored.trim() || defaultText(kind);
}

/** Estado de la configuración, para mostrarlo en el panel. */
export function whatsappConfig(settings: Settings) {
  return {
    enabled: settingBool(settings, "whatsapp_enabled"),
    rebookDays: rebookDays(settings),
    countryCode: settings.whatsapp_country_code.replace(/\D/g, "") || "54",
  };
}

export function rebookDays(settings: Settings) {
  const days = settingInt(settings, "whatsapp_rebook_days", 1);
  // Un recordatorio a los 0 días saldría el mismo día del turno, y uno a dos
  // años no lo va a mandar nadie. Los extremos se recortan acá y no al
  // guardar, para que una fila vieja o editada a mano tampoco los rompa.
  return Math.min(365, Math.max(1, days));
}

/* ── Encolar ─────────────────────────────────────────────────────────── */

/**
 * Deja anotado qué mensajes corresponden por este turno.
 *
 * Se llama al confirmarse un turno, y ahí quedan escritos los dos de una vez:
 * la confirmación para hoy y el recordatorio para dentro de los días
 * configurados. El recordatorio se anota ahora, meses antes de que
 * corresponda, porque de otro modo haría falta un proceso que se despierte
 * todos los días a buscar turnos viejos; así, la fila ya está y la pantalla
 * del panel solo pregunta cuáles ya vencieron.
 *
 * `onConflictDoNothing` sobre el índice (turno, tipo): si el alta se reintenta
 * —o si un pago de Mercado Pago llega dos veces— no se duplica nada.
 *
 * No lanza nunca. Un recordatorio que no se pudo anotar no puede tumbar la
 * reserva que lo originó.
 */
export async function enqueueMessages(options: {
  appointmentId: number;
  /** La fecha del turno, de la que se cuentan los días del recordatorio. */
  date: string;
  kinds: WhatsappKind[];
}) {
  if (options.kinds.length === 0) return;

  try {
    const settings = await getSettings();
    if (!settingBool(settings, "whatsapp_enabled")) return;

    const today = nowInTz(settings.timezone).date;
    const days = rebookDays(settings);

    const rows = options.kinds.map((kind) => ({
      appointmentId: options.appointmentId,
      kind,
      dueDate:
        kind === "confirmation" ? today : addDays(options.date, days),
    }));

    await db.insert(whatsappMessages).values(rows).onConflictDoNothing();
  } catch (e) {
    console.warn("[whatsapp] no se pudo encolar el mensaje:", e);
  }
}

/* ── La cola ─────────────────────────────────────────────────────────── */

export type PendingMessage = {
  id: number;
  kind: WhatsappKind;
  dueDate: string;
  appointmentId: number;
  firstName: string;
  lastName: string;
  phone: string;
  serviceName: string;
  date: string;
  startMinute: number;
  professionalName: string;
  /** El teléfono listo para wa.me. Null si el guardado no se pudo interpretar. */
  number: string | null;
  text: string;
};

/**
 * Los mensajes que hay que mandar hoy.
 *
 * Las condiciones son todas de la forma "no molestar de más", que es lo que
 * separa un recordatorio útil de un mensaje que hace que la clienta bloquee el
 * número:
 *
 *   · El turno tiene que seguir en pie. Un turno cancelado no genera ni
 *     confirmación ni recordatorio, aunque su fila en la cola ya estuviera
 *     escrita. Por eso el estado se lee del turno con un JOIN en lugar de
 *     copiarse al encolar.
 *   · Tiene que haber teléfono. Un turno cargado a mano puede no tenerlo.
 *   · Una confirmación de un turno que ya pasó no se manda: a esa altura ya no
 *     confirma nada y solo confunde.
 *   · Y la más importante: no se le recuerda que saque turno a quien ya volvió.
 *     Si esa persona tiene otro turno posterior —ya sea porque volvió o porque
 *     lo tiene reservado para más adelante— el recordatorio se calla solo.
 *
 * El alcance por profesional es el mismo del resto del panel: una cuenta de
 * profesional ve únicamente los mensajes de sus propias clientas.
 */
export async function pendingMessages(
  user: AdminUser,
): Promise<PendingMessage[]> {
  const settings = await getSettings();
  if (!settingBool(settings, "whatsapp_enabled")) return [];

  const today = nowInTz(settings.timezone).date;
  const origin = await siteOrigin();
  const config = whatsappConfig(settings);

  // Segunda referencia a la misma tabla: la de "¿ya tiene otro turno?".
  const later = alias(appointments, "later_appointment");

  const rows = await db
    .select({
      id: whatsappMessages.id,
      kind: whatsappMessages.kind,
      dueDate: whatsappMessages.dueDate,
      appointmentId: appointments.id,
      firstName: appointments.firstName,
      lastName: appointments.lastName,
      phone: appointments.phone,
      serviceName: appointments.serviceName,
      date: appointments.date,
      startMinute: appointments.startMinute,
      professionalName: professionals.name,
    })
    .from(whatsappMessages)
    .innerJoin(
      appointments,
      eq(whatsappMessages.appointmentId, appointments.id),
    )
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(
      and(
        isNull(whatsappMessages.sentAt),
        isNull(whatsappMessages.dismissedAt),
        lte(whatsappMessages.dueDate, today),
        eq(appointments.status, "booked"),
        ne(appointments.phone, ""),
        // Una confirmación de un turno ya pasado no confirma nada.
        sql`(${whatsappMessages.kind} <> 'confirmation' OR ${appointments.date} >= ${today})`,
        // Quien ya tiene otro turno posterior no necesita que le recuerden
        // que puede sacar uno.
        sql`(${whatsappMessages.kind} <> 'rebooking' OR ${notExists(
          db
            .select({ one: sql`1` })
            .from(later)
            .where(
              and(
                eq(later.phone, appointments.phone),
                eq(later.status, "booked"),
                gt(later.date, appointments.date),
              ),
            ),
        )})`,
        professionalScope(user, appointments.professionalId),
      ),
    )
    .orderBy(whatsappMessages.dueDate, whatsappMessages.id);

  return rows.map((row) => {
    const text = renderMessage(textFor(settings, row.kind), {
      firstName: row.firstName,
      serviceName: row.serviceName,
      date: row.date,
      startMinute: row.startMinute,
      professionalName: row.professionalName,
      businessName: settings.business_name,
      /*
       * El link es el de la web pública, no el link personal del turno. Del
       * token de cancelación la base guarda solo el hash: el token en claro
       * existe únicamente en el mail que se mandó al reservar, y así tiene que
       * seguir siendo. Para el recordatorio, además, el link correcto es
       * justamente el de sacar un turno nuevo.
       */
      bookingUrl: origin,
    });

    const number = toWhatsappNumber(row.phone, config.countryCode);

    return { ...row, number, text };
  });
}

/** Cuántos mensajes esperan. Para el indicador de la navegación del panel. */
export async function pendingCount(user: AdminUser) {
  try {
    return (await pendingMessages(user)).length;
  } catch (e) {
    // El contador es un adorno: que falle no puede dejar sin panel a nadie.
    console.warn("[whatsapp] no se pudo contar la cola:", e);
    return 0;
  }
}

/**
 * Los últimos despachados, para poder deshacer.
 *
 * El botón de enviar marca la fila como enviada en el mismo clic con el que
 * abre WhatsApp, porque el navegador no tiene forma de enterarse de si la
 * persona apretó enviar del otro lado. Esta lista es la contrapartida: si el
 * mensaje al final no salió, se devuelve a la cola desde acá.
 */
export async function recentlySent(
  user: AdminUser,
  limit = 10,
): Promise<{ id: number; firstName: string; lastName: string; kind: WhatsappKind }[]> {
  return db
    .select({
      id: whatsappMessages.id,
      firstName: appointments.firstName,
      lastName: appointments.lastName,
      kind: whatsappMessages.kind,
    })
    .from(whatsappMessages)
    .innerJoin(
      appointments,
      eq(whatsappMessages.appointmentId, appointments.id),
    )
    .where(
      and(
        sql`${whatsappMessages.sentAt} IS NOT NULL`,
        professionalScope(user, appointments.professionalId),
      ),
    )
    .orderBy(sql`${whatsappMessages.sentAt} DESC`)
    .limit(limit);
}
