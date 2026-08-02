import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

/**
 * Conexión a la base.
 *
 * Se usa el cliente de libSQL, que habla el mismo dialecto en los dos
 * entornos:
 *
 *   · Desarrollo → un archivo local (`file:data/turnos.db`), igual que antes.
 *   · Producción → Turso, con la URL `libsql://…` y su token.
 *
 * Un solo camino de código para ambos: lo que se prueba en la computadora es
 * exactamente lo que corre en producción.
 *
 * Este archivo NO lleva `server-only` a propósito: los scripts de consola
 * (migraciones y carga inicial) lo importan directamente, y esa marca los
 * haría fallar. La aplicación usa `@/db`, que es esto mismo con la marca.
 */

const globalForDb = globalThis as unknown as {
  __moksha_db?: ReturnType<typeof createConnection>;
};

function resolveUrl() {
  const remote = process.env.TURSO_DATABASE_URL?.trim();
  if (remote) return remote;

  // Sin Turso configurado se cae al archivo local. `file:` es relativo al
  // directorio desde el que se ejecuta la aplicación.
  const path = process.env.DATABASE_PATH?.trim() || "data/turnos.db";
  return path.startsWith("file:") ? path : `file:${path}`;
}

function createConnection() {
  const url = resolveUrl();
  const isRemote = !url.startsWith("file:");

  if (isRemote && !process.env.TURSO_AUTH_TOKEN) {
    throw new Error(
      "Falta TURSO_AUTH_TOKEN. Sacalo con: turso db tokens create <nombre-de-la-base>",
    );
  }

  const client = createClient({
    url,
    authToken: isRemote ? process.env.TURSO_AUTH_TOKEN : undefined,
  });

  return { client, db: drizzle(client, { schema }), isRemote };
}

/**
 * En desarrollo Next recarga los módulos con cada cambio; guardar la conexión
 * en `globalThis` evita abrir un descriptor nuevo por recarga. En producción
 * cada instancia crea la suya y la reutiliza mientras esté viva.
 */
const connection = globalForDb.__moksha_db ?? createConnection();
if (process.env.NODE_ENV !== "production") globalForDb.__moksha_db = connection;

/** Cliente Drizzle tipado, para todas las consultas. */
export const db = connection.db;

/** Cliente crudo de libSQL. Para SQL a medida y para las migraciones. */
export const client: Client = connection.client;

/** true cuando se está hablando con Turso y no con el archivo local. */
export const isRemoteDatabase = connection.isRemote;

export { schema };
