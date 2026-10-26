/**
 * Entorno de la demo: una base aparte y ninguna salida al mundo.
 *
 * Se importa PRIMERO en los scripts de demo. Lee el .env como cualquier otro
 * script y después pisa lo que podría tocar algo real:
 *
 *   · la base pasa a ser data/demo.db, nunca la de desarrollo ni Turso;
 *   · sin clave de Resend no sale ningún mail, aunque se encienda en Ajustes;
 *   · sin Mercado Pago ni Blob no se cobra ni se sube nada.
 *
 * Se vacían con "" y no con `delete`: Next lee el .env por su cuenta y solo
 * completa las variables que no existen, así que una borrada volvería a
 * aparecer y una vacía no.
 */

import "./load-env";

export const DEMO_DB = "data/demo.db";

const BLOCKED = [
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "RESEND_API_KEY",
  "MERCADOPAGO_ACCESS_TOKEN",
  "MERCADOPAGO_WEBHOOK_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "CRON_SECRET",
  "APP_URL",
];

for (const key of BLOCKED) process.env[key] = "";

process.env.DATABASE_PATH = DEMO_DB;

// La demo tiene que arrancar aunque no haya .env todavía.
if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
  process.env.AUTH_SECRET = "demo-local-solo-para-mostrar-no-usar-en-produccion";
}
