import "server-only";

import { headers } from "next/headers";

import { client } from "@/db";

/**
 * Límite de intentos.
 *
 * Protege las dos puertas que no piden login: el login del panel y la búsqueda
 * por DNI + email.
 *
 * Los contadores viven en la base y no en memoria. En producción corren varias
 * instancias del servidor a la vez y se reciclan solas: con contadores por
 * proceso, el límite real se multiplicaría por la cantidad de instancias y se
 * reiniciaría con cada arranque en frío, que es justo lo que un ataque de
 * fuerza bruta necesita.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Registra un intento y dice si se puede seguir.
 *
 * Es una sola sentencia: inserta el contador o lo incrementa, y de paso lo
 * reinicia si la ventana anterior ya venció. Al ser atómica, dos pedidos
 * simultáneos no pueden pisarse ni saltearse el conteo.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const resetAt = now + windowSeconds;

  await sweepRateLimits();

  try {
    const result = await client.execute({
      sql: `INSERT INTO rate_limits (key, count, reset_at)
            VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET
              count    = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
              reset_at = CASE WHEN rate_limits.reset_at <= ? THEN ? ELSE rate_limits.reset_at END
            RETURNING count, reset_at`,
      args: [key, resetAt, now, now, resetAt],
    });

    const row = result.rows[0];
    const count = Number(row?.count ?? 1);
    const windowEnd = Number(row?.reset_at ?? resetAt);

    if (count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, windowEnd - now),
      };
    }

    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    /*
     * Si la base falla, se deja pasar el intento en lugar de bloquear a todo
     * el mundo. El login sigue exigiendo la contraseña correcta: se pierde la
     * protección contra fuerza bruta, no el control de acceso.
     */
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Descarta el contador tras una operación exitosa (por ejemplo, un login). */
export async function clearRateLimit(key: string) {
  await client
    .execute({ sql: "DELETE FROM rate_limits WHERE key = ?", args: [key] })
    .catch(() => undefined);
}

/**
 * Limpia los contadores vencidos. Se llama de vez en cuando, no en cada
 * pedido: la tabla es chica y no hace falta un proceso aparte para esto.
 */
export async function sweepRateLimits() {
  if (Math.random() > 0.02) return;

  await client
    .execute({
      sql: "DELETE FROM rate_limits WHERE reset_at <= ?",
      args: [Math.floor(Date.now() / 1000)],
    })
    .catch(() => undefined);
}

/**
 * Identifica a quien hace el pedido.
 *
 * Detrás de Vercel, `x-forwarded-for` trae la IP real del visitante como
 * primer valor de la lista.
 */
export async function clientKey(prefix: string) {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip") ||
    "desconocida";
  return `${prefix}:${ip}`;
}
