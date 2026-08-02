import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tokens de cancelación.
 *
 * El token en claro existe en un solo lugar: el link que recibe el cliente.
 * En la base se guarda únicamente su hash SHA-256, igual que se hace con las
 * contraseñas. Así, quien consiga una copia del archivo .db no puede cancelar
 * turnos ajenos ni fabricar links válidos.
 *
 * No hace falta salt ni bcrypt acá: a diferencia de una contraseña, el token
 * son 256 bits aleatorios, así que no es adivinable ni vulnerable a
 * diccionario. SHA-256 alcanza y permite buscarlo por índice.
 */

const TOKEN_BYTES = 32;

export function generateCancelToken() {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Comparación en tiempo constante, para no filtrar información por timing. */
export function tokensMatch(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Descarta rápido cualquier cosa que no tenga forma de token. */
export function looksLikeToken(value: string) {
  return /^[A-Za-z0-9_-]{20,64}$/.test(value);
}
