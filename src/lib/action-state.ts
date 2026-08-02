import type { FieldErrors } from "./validation";

/**
 * Tipos y valores iniciales de los formularios.
 *
 * Viven acá y no junto a cada acción porque un archivo `"use server"` solo
 * puede exportar funciones asíncronas: cada cosa que exporta se convierte en
 * un endpoint HTTP, así que una constante ahí adentro no tiene sentido y Next
 * lo rechaza al compilar.
 */

/** Resultado de una acción del panel. */
export type ActionState = { ok: boolean; message: string | null };

export const emptyActionState: ActionState = { ok: false, message: null };

/** Alta de un turno: además del mensaje general, errores por campo. */
export type BookingState = {
  ok: boolean;
  message: string | null;
  errors: FieldErrors;
};

export const emptyBookingState: BookingState = {
  ok: false,
  message: null,
  errors: {},
};

export type CancelState = { ok: boolean; message: string | null };

export const emptyCancelState: CancelState = { ok: false, message: null };

/** Búsqueda de turno por DNI + email. */
export type LookupResult = {
  token: string;
  date: string;
  startMinute: number;
  professionalName: string;
  serviceName: string;
};

export type LookupState = {
  message: string | null;
  results: LookupResult[];
};

export const emptyLookupState: LookupState = { message: null, results: [] };

export type LoginState = { message: string | null };

export const emptyLoginState: LoginState = { message: null };

export type PasswordState = { ok: boolean; message: string | null };

export const emptyPasswordState: PasswordState = { ok: false, message: null };
