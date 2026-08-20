import "server-only";

import { db } from "@/db";
import { settings } from "@/db/schema";

/**
 * Configuración del negocio.
 *
 * Todo lo que distingue a un negocio de otro vive acá, no en el código. Para
 * usar el sistema en otro local alcanza con desplegar una copia con su propia
 * base y completar estos valores desde el panel: no hay que tocar nada.
 */

export const SETTING_DEFAULTS = {
  /** Marca ─────────────────────────────────────────────────────────── */
  business_name: "Moksha",
  business_tagline: "Reservá tu turno online",
  business_logo_url: "",
  contact_phone: "",
  contact_address: "",
  contact_instagram: "",

  /** Reglas de reserva ──────────────────────────────────────────────── */
  timezone: "America/Argentina/Buenos_Aires",
  /** Cuántos días hacia adelante se puede reservar. */
  booking_window_days: "45",
  /** Antelación mínima para tomar un turno, en horas. 0 = hasta último momento. */
  min_hours_before_booking: "2",

  /** Reglas de cancelación ──────────────────────────────────────────── */
  /** Horas mínimas de antelación para que el cliente cancele. 0 = sin límite. */
  cancel_cutoff_hours: "0",
  /** Habilita la búsqueda por DNI + email en /cancelar. */
  allow_client_lookup: "true",

  /** Notificaciones ─────────────────────────────────────────────────── */
  /** Requiere dominio verificado en Resend. Ver README. */
  email_enabled: "false",
  email_from: "",

  /** WhatsApp ───────────────────────────────────────────────────────
   * Los mensajes no salen solos: el sistema arma la cola y desde el panel se
   * despachan de a uno, con un clic que abre WhatsApp con el texto escrito.
   * Ver src/lib/whatsapp.ts.
   */
  whatsapp_enabled: "true",
  /** Cuántos días después del turno se sugiere volver a reservar. */
  whatsapp_rebook_days: "25",
  /**
   * Prefijo del país para armar el link, sin el +. 54 = Argentina. Los
   * teléfonos que ya vengan con prefijo internacional se respetan.
   */
  whatsapp_country_code: "54",
  /**
   * Los textos. Admiten {nombre}, {servicio}, {fecha}, {hora}, {profesional},
   * {negocio} y {link}; ver `MESSAGE_PLACEHOLDERS` en src/lib/whatsapp.ts.
   * Vacío = se usa el texto de fábrica.
   */
  whatsapp_confirmation_text: "",
  whatsapp_rebooking_text: "",

  /** Cobros online ──────────────────────────────────────────────────── */
  /**
   * Interruptor global de Mercado Pago. Apagado por defecto: la web funciona
   * completa sin cobro online, y recién cuando el cliente carga su
   * MERCADOPAGO_ACCESS_TOKEN en el servidor y enciende esto empieza a cobrar.
   * Ver src/lib/mercadopago.ts.
   */
  mp_enabled: "false",
  /**
   * Cuántos minutos se retiene el horario mientras la clienta paga la seña.
   * Vencido el plazo, la pre-reserva se descarta y el horario vuelve a estar
   * disponible. Ver src/lib/payments.ts.
   */
  mp_hold_minutes: "30",

  /** Seña por transferencia ─────────────────────────────────────────
   * El otro camino para señar, independiente de Mercado Pago: los dos pueden
   * estar encendidos a la vez y la clienta elige. Ver src/lib/transfer.ts.
   */
  /**
   * Interruptor. Apagado por defecto. Para encenderlo hace falta además el
   * alias o el CBU cargado: sin eso no hay a dónde transferir.
   */
  transfer_enabled: "false",
  /** A dónde se transfiere. Con uno de los dos alcanza; se muestran los dos. */
  transfer_alias: "",
  transfer_cbu: "",
  /** A nombre de quién está la cuenta. Se muestra para dar confianza. */
  transfer_holder: "",
  transfer_bank: "",
  /**
   * Cuántos minutos se retiene el horario esperando la transferencia.
   *
   * De fábrica 24 horas, y no los 30 minutos de Mercado Pago, porque una
   * transferencia depende del horario del banco: quien reserva un viernes a la
   * noche recién puede transferir el lunes.
   */
  transfer_hold_minutes: "1440",
  /**
   * Verificación automática contra la API de Mercado Pago.
   *
   * Solo sirve si la cuenta que recibe las transferencias es de Mercado Pago
   * Y su API lista los movimientos entrantes. Eso último hay que comprobarlo
   * con una transferencia de prueba antes de encender esto; mientras esté
   * apagado, las transferencias se aprueban con un clic desde el panel.
   *
   * Encendido no reemplaza la aprobación manual: la deja como respaldo para
   * lo que el automático no puede resolver (alguien que transfiere de menos,
   * o desde una cuenta que no es la suya).
   */
  transfer_auto_verify: "false",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export type Settings = Record<SettingKey, string>;

/** Lee todas las settings, completando con los valores por defecto. */
export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(settings);
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  const result = {} as Settings;
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    result[key] = stored.get(key) ?? SETTING_DEFAULTS[key];
  }
  return result;
}

export async function updateSettings(values: Partial<Settings>) {
  const entries = Object.entries(values).filter(
    ([key]) => key in SETTING_DEFAULTS,
  ) as [SettingKey, string][];

  for (const [key, value] of entries) {
    await db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } });
  }
}

/** Helpers de lectura tipada, porque todo se guarda como texto. */

export function settingInt(settings: Settings, key: SettingKey, min = 0) {
  const parsed = Number.parseInt(settings[key], 10);
  if (!Number.isFinite(parsed)) {
    return Number.parseInt(SETTING_DEFAULTS[key], 10) || min;
  }
  return Math.max(min, parsed);
}

export function settingBool(settings: Settings, key: SettingKey) {
  return settings[key] === "true";
}
