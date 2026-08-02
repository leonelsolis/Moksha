import type { Config } from "drizzle-kit";

/**
 * Solo para `npm run db:studio`, un visor de la base en el navegador que sirve
 * para inspeccionar datos a mano.
 *
 * Las migraciones NO se manejan con drizzle-kit: están en
 * src/db/migrations.ts y se aplican con `npm run db:migrate`.
 */
const remote = process.env.TURSO_DATABASE_URL;

export default {
  schema: "./src/db/schema.ts",
  dialect: "turso",
  dbCredentials: remote
    ? { url: remote, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${process.env.DATABASE_PATH ?? "data/turnos.db"}` },
} satisfies Config;
