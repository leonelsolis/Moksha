/**
 * Carga inicial de la base.
 *
 *   npm run db:seed          crea los usuarios del panel y datos de ejemplo
 *   npm run db:seed -- --reset   borra todo y vuelve a empezar (¡pide confirmación!)
 *
 * Es seguro correrlo dos veces: si ya hay datos, avisa y no toca nada.
 *
 * Las contraseñas salen de ADMIN_PASSWORD / STAFF_PASSWORD. Si no están, se
 * generan al azar y se imprimen una única vez por pantalla: no quedan
 * guardadas en ningún archivo.
 */

import { randomBytes } from "node:crypto";
import readline from "node:readline/promises";
import bcrypt from "bcryptjs";

// Se importa `connection` y no `@/db`: ese último lleva la marca `server-only`,
// que sirve dentro de Next pero hace fallar a un script de consola.
// Tiene que ir antes de importar la conexión: define qué base se usa.
import "./load-env";

import { client, db } from "../src/db/connection";
import {
  adminUsers,
  professionals,
  services,
  workingHours,
} from "../src/db/schema";
import { runMigrations } from "../src/db/migrations";

const reset = process.argv.includes("--reset");

/** Mismo costo que usa el login (ver src/lib/auth.ts). */
const hashPassword = (password: string) => bcrypt.hash(password, 12);

function randomPassword() {
  // base64url sin caracteres ambiguos, para que se pueda dictar por teléfono.
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
}

async function confirmReset() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(
    "\n  Esto BORRA todos los turnos, profesionales y usuarios. ¿Seguir? (escribí: si)  ",
  );
  rl.close();

  return answer.trim().toLowerCase() === "si";
}

async function main() {
  // Crea las tablas si es la primera vez, así arrancar es un solo comando.
  await runMigrations(client);

  if (reset) {
    if (!(await confirmReset())) {
      console.log("\n  Cancelado. No se tocó nada.\n");
      return;
    }

    // El orden importa por las claves foráneas.
    await client.batch(
      [
        "DELETE FROM appointments",
        "DELETE FROM schedule_overrides",
        "DELETE FROM working_hours",
        "DELETE FROM vacations",
        "DELETE FROM services",
        "DELETE FROM professionals",
        "DELETE FROM admin_users",
        "DELETE FROM settings",
        "DELETE FROM rate_limits",
      ],
      "write",
    );
    console.log("\n  Base vaciada.");
  }

  const existingUsers = await db.select().from(adminUsers);

  if (existingUsers.length > 0) {
    console.log(
      "\n  Ya hay usuarios cargados, no se hizo nada.\n" +
        "  Si querés empezar de cero: npm run db:seed -- --reset\n",
    );
    return;
  }

  /*
   * La tabla de configuración se deja vacía a propósito: `getSettings` aplica
   * los valores por defecto cuando falta una clave, y solo se guarda en la
   * base lo que se cambie desde el panel.
   */

  /* ── Usuarios del panel ─────────────────────────────────────────── */

  const adminPassword = process.env.ADMIN_PASSWORD ?? randomPassword();
  const staffPassword = process.env.STAFF_PASSWORD ?? randomPassword();

  await db.insert(adminUsers).values([
    {
      username: "admin",
      passwordHash: await hashPassword(adminPassword),
      displayName: "Administración",
      role: "owner",
    },
    {
      // Segundo usuario para probar el rol limitado: ve la agenda pero no
      // puede cambiar horarios ni ajustes.
      username: "recepcion",
      passwordHash: await hashPassword(staffPassword),
      displayName: "Recepción",
      role: "staff",
    },
  ]);

  /* ── Datos de ejemplo ───────────────────────────────────────────── */

  const [first] = await db
    .insert(professionals)
    .values({
      name: "Profesional 1",
      specialty: "Uñas",
      sortOrder: 1,
      bio: "",
    })
    .returning();

  const [second] = await db
    .insert(professionals)
    .values({
      name: "Profesional 2",
      specialty: "Cejas y pestañas",
      sortOrder: 2,
      bio: "",
    })
    .returning();

  await db.insert(services).values([
    {
      professionalId: first.id,
      name: "Esmaltado semipermanente",
      durationMinutes: 60,
      sortOrder: 1,
    },
    {
      professionalId: first.id,
      name: "Kapping",
      durationMinutes: 90,
      sortOrder: 2,
    },
    {
      professionalId: second.id,
      name: "Perfilado de cejas",
      durationMinutes: 30,
      sortOrder: 1,
    },
  ]);

  // Lunes a viernes, mañana y tarde.
  const weekdays = [1, 2, 3, 4, 5];

  await db.insert(workingHours).values(
    weekdays.flatMap((weekday) => [
      { professionalId: first.id, weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
      { professionalId: first.id, weekday, startMinute: 15 * 60, endMinute: 19 * 60 },
      { professionalId: second.id, weekday, startMinute: 10 * 60, endMinute: 18 * 60 },
    ]),
  );

  console.log(`
  Listo. Datos iniciales cargados.

  ┌─ Usuarios del panel ──────────────────────────────
  │
  │  Administración (acceso total)
  │    usuario:     admin
  │    contraseña:  ${adminPassword}
  │
  │  Recepción (solo ve la agenda)
  │    usuario:     recepcion
  │    contraseña:  ${staffPassword}
  │
  └───────────────────────────────────────────────────

  Anotá estas contraseñas ahora: no se vuelven a mostrar.
  Cambialas desde Ajustes cuando entres.

  Se crearon dos profesionales de ejemplo con horarios de
  lunes a viernes. Editalas en /admin/profesionales.
`);
}

main()
  .catch((error) => {
    console.error("\n  Falló la carga inicial:\n", error, "\n");
    process.exitCode = 1;
  })
  .finally(() => client.close());
