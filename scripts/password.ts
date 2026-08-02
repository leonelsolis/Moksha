/**
 * Ver las cuentas del panel y cambiarles la contraseña desde la consola.
 *
 *   npm run db:users                        lista las cuentas que existen
 *   npm run db:password -- ana              le pone una contraseña al azar y la muestra
 *   npm run db:password -- ana MiClave123   le pone esa contraseña
 *
 * Es la salida de emergencia para cuando nadie puede entrar al panel. Lo
 * normal es hacerlo desde /admin/usuarios, que hace exactamente lo mismo.
 *
 * Las contraseñas no se pueden "consultar": en la base solo está su hash
 * bcrypt, que no se puede revertir. Lo único posible es poner una nueva.
 */

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

// Tiene que ir antes de importar la conexión: define qué base se usa.
import "./load-env";

import { client, db, isRemoteDatabase } from "../src/db/connection";
import { adminUsers, professionals } from "../src/db/schema";

/** Mismo costo que usa el login (ver src/lib/auth.ts). */
const hashPassword = (password: string) => bcrypt.hash(password, 12);

function randomPassword() {
  // base64url sin caracteres ambiguos, para que se pueda dictar por teléfono.
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
}

async function list() {
  const rows = await db
    .select({
      username: adminUsers.username,
      displayName: adminUsers.displayName,
      role: adminUsers.role,
      email: adminUsers.email,
      active: adminUsers.active,
      professionalName: professionals.name,
    })
    .from(adminUsers)
    .leftJoin(professionals, eq(adminUsers.professionalId, professionals.id))
    .orderBy(adminUsers.role, adminUsers.username);

  console.log(`\n  Base: ${isRemoteDatabase ? "Turso (producción)" : "archivo local"}\n`);

  if (rows.length === 0) {
    console.log("  No hay ninguna cuenta. Corré: npm run db:seed\n");
    return;
  }

  for (const row of rows) {
    const agenda =
      row.role === "admin"
        ? "todas las profesionales"
        : (row.professionalName ?? "SIN VINCULAR (no ve ningún turno)");

    console.log(`  ${row.username}${row.active ? "" : "   [DESACTIVADA]"}`);
    console.log(`    nombre:  ${row.displayName || "—"}`);
    console.log(`    rol:     ${row.role}`);
    console.log(`    agenda:  ${agenda}`);
    console.log(`    email:   ${row.email || "(sin cargar: no recibe avisos)"}\n`);
  }

  console.log("  Para cambiar una contraseña:  npm run db:password -- <usuario>\n");
}

async function setPassword(username: string, typed: string | undefined) {
  if (typed && typed.length < 8) {
    console.error("\n  La contraseña debe tener al menos 8 caracteres.\n");
    process.exitCode = 1;
    return;
  }

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username.trim().toLowerCase()))
    .limit(1);

  if (!user) {
    console.error(
      `\n  No existe la cuenta "${username}".\n  Mirá cuáles hay con: npm run db:users\n`,
    );
    process.exitCode = 1;
    return;
  }

  const password = typed || randomPassword();

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(adminUsers.id, user.id));

  console.log(`
  Contraseña cambiada.

    usuario:     ${user.username}
    contraseña:  ${password}

  Anotala ahora: no se vuelve a mostrar.
`);
}

async function main() {
  const [username, typed] = process.argv.slice(2);

  if (!username) {
    await list();
    return;
  }

  await setPassword(username, typed);
}

main()
  .catch((error) => {
    console.error("\n  Falló:\n", error, "\n");
    process.exitCode = 1;
  })
  .finally(() => client.close());
