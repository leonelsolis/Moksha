/**
 * Aplica las migraciones pendientes.
 *
 *   npm run db:migrate
 *
 * Se corre a mano: en local la primera vez, y contra Turso cada vez que se
 * despliega un cambio de esquema. No se ejecuta al arrancar la aplicación
 * porque en Vercel eso significaría intentarlo desde varias instancias a la
 * vez, en cada arranque en frío.
 *
 * Es seguro correrlo de más: si no hay nada pendiente, no hace nada.
 */

import { client, isRemoteDatabase } from "../src/db/connection";
import { runMigrations } from "../src/db/migrations";

async function main() {
  const destino = isRemoteDatabase
    ? "Turso (base remota)"
    : `archivo local (${process.env.DATABASE_PATH ?? "data/turnos.db"})`;

  console.log(`\n  Base: ${destino}`);

  const { from, to, applied } = await runMigrations(client);

  if (applied === 0) {
    console.log(`  Sin cambios pendientes (versión ${to}).\n`);
    return;
  }

  console.log(
    `  ${applied} ${applied === 1 ? "migración aplicada" : "migraciones aplicadas"}.` +
      ` Versión ${from} → ${to}.\n`,
  );
}

main()
  .catch((error) => {
    console.error("\n  Falló la migración:\n", error, "\n");
    process.exitCode = 1;
  })
  .finally(() => client.close());
