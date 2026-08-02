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
