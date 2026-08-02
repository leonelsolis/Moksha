"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { adminUsers, professionals } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/session";
import { isValidEmail, normalizeEmail } from "@/lib/validation";

/**
 * Gestión de las cuentas del panel. Todo esto es solo para la administración.
 *
 * Dos reglas atraviesan el archivo y no se pueden saltear desde ninguna
 * pantalla:
 *
 *   1. Nadie se desactiva ni se cambia el rol a sí mismo. Es la forma más
 *      común de quedarse afuera del panel sin manera de volver a entrar.
 *
 *   2. Siempre queda al menos una cuenta de administración activa. Sin esto,
 *      desactivar la última dejaría un sistema que nadie puede administrar y
 *      que solo se arregla entrando a la base a mano.
 *
 * Las contraseñas nunca se guardan ni se muestran en claro salvo una vez, la
 * de la que se genera acá, y solo en el mensaje de respuesta de la acción.
 */

function ok(message: string): ActionState {
  return { ok: true, message };
}

function error(message: string): ActionState {
  return { ok: false, message };
}

const MIN_PASSWORD = 8;

/** Sin espacios ni acentos: es lo que se escribe en el login. */
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

const USERNAME_ERROR =
  "El usuario debe tener entre 3 y 30 caracteres: letras, números, punto, guion o guion bajo.";

function readUsername(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** base64url sin caracteres ambiguos, para poder dictarla por teléfono. */
function randomPassword() {
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
}

function readRole(value: FormDataEntryValue | null): Role | null {
  const role = String(value ?? "");
  return ROLES.includes(role as Role) ? (role as Role) : null;
}

/**
 * Valida el par rol + profesional.
 *
 * Un usuario 'profesional' sin vincular no vería ningún turno, y uno 'admin'
 * con profesional vinculada sería una contradicción: el admin ve a todas.
 */
async function resolveLink(
  role: Role,
  rawProfessionalId: FormDataEntryValue | null,
): Promise<{ professionalId: number | null } | { message: string }> {
  if (role === "admin") return { professionalId: null };

  const professionalId = Number(rawProfessionalId) || 0;
  if (!professionalId) {
    return { message: "Elegí a qué profesional corresponde esta cuenta." };
  }

  const [professional] = await db
    .select({ id: professionals.id })
    .from(professionals)
    .where(eq(professionals.id, professionalId))
    .limit(1);

  if (!professional) return { message: "Esa profesional no existe." };

  return { professionalId };
}

/** ¿Queda alguna otra cuenta de administración activa además de esta? */
async function otherActiveAdminExists(exceptUserId: number) {
  const rows = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.role, "admin"),
        eq(adminUsers.active, true),
        ne(adminUsers.id, exceptUserId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

function refresh() {
  revalidatePath("/admin/usuarios");
}

/* ── Alta ───────────────────────────────────────────────────────────── */

export async function createUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const username = readUsername(formData.get("username"));
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const typed = String(formData.get("password") ?? "");

  if (!USERNAME_PATTERN.test(username)) return error(USERNAME_ERROR);

  if (!displayName) return error("Poné un nombre para mostrar.");

  // El email es obligatorio incluso en las cuentas de administración: es por
  // donde va a ir la recuperación de contraseña.
  if (!isValidEmail(email)) return error("Escribí un email de contacto válido.");

  const role = readRole(formData.get("role"));
  if (!role) return error("Rol inválido.");

  if (typed && typed.length < MIN_PASSWORD) {
    return error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }

  const link = await resolveLink(role, formData.get("professionalId"));
  if ("message" in link) return error(link.message);

  const [taken] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(eq(adminUsers.username, username))
    .limit(1);

  if (taken) return error("Ya existe una cuenta con ese usuario.");

  const password = typed || randomPassword();

  await db.insert(adminUsers).values({
    username,
    passwordHash: await hashPassword(password),
    displayName,
    email,
    role,
    professionalId: link.professionalId,
    active: true,
  });

  refresh();

  return ok(
    typed
      ? `Cuenta creada para ${displayName}. Ya puede entrar con el usuario ${username}.`
      : `Cuenta creada para ${displayName}. Usuario: ${username} · Contraseña temporal: ${password} — anotala ahora, no se vuelve a mostrar.`,
  );
}

/* ── Edición ────────────────────────────────────────────────────────── */

export async function updateUser(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return error("Cuenta no encontrada.");

  const username = readUsername(formData.get("username"));
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!USERNAME_PATTERN.test(username)) return error(USERNAME_ERROR);
  if (!displayName) return error("Poné un nombre para mostrar.");
  if (!isValidEmail(email)) return error("Escribí un email de contacto válido.");

  const role = readRole(formData.get("role"));
  if (!role) return error("Rol inválido.");

  if (id === admin.id && role !== admin.role) {
    return error(
      "No podés cambiarte el rol a vos misma. Pedíselo a otra cuenta de administración.",
    );
  }

  const link = await resolveLink(role, formData.get("professionalId"));
  if ("message" in link) return error(link.message);

  const [current] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!current) return error("Cuenta no encontrada.");

  // El usuario es la llave del login, así que dos cuentas no pueden compartirlo.
  if (username !== current.username) {
    const [taken] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.username, username))
      .limit(1);

    if (taken) return error("Ya existe otra cuenta con ese usuario.");
  }

  // Bajar de rol a la última administración activa dejaría el panel sin nadie
  // que pueda gestionarlo.
  if (
    current.role === "admin" &&
    current.active &&
    role !== "admin" &&
    !(await otherActiveAdminExists(id))
  ) {
    return error("Tiene que quedar al menos una cuenta de administración activa.");
  }

  await db
    .update(adminUsers)
    .set({ username, displayName, email, role, professionalId: link.professionalId })
    .where(eq(adminUsers.id, id));

  refresh();

  return ok(
    username === current.username
      ? "Cuenta actualizada."
      : `Cuenta actualizada. A partir de ahora entra con el usuario ${username}.`,
  );
}

/* ── Contraseña ─────────────────────────────────────────────────────── */

/**
 * Reseteo desde la administración: no pide la contraseña actual, porque
 * justamente se usa cuando alguien la perdió. Se puede escribir una o dejar
 * que se genere sola.
 */
export async function resetUserPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const id = Number(formData.get("id"));
  if (!id) return error("Cuenta no encontrada.");

  const typed = String(formData.get("password") ?? "");
  if (typed && typed.length < MIN_PASSWORD) {
    return error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  }

  const [user] = await db
    .select({ username: adminUsers.username })
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!user) return error("Cuenta no encontrada.");

  const password = typed || randomPassword();

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(adminUsers.id, id));

  refresh();

  return ok(
    typed
      ? `Contraseña cambiada para ${user.username}.`
      : `Contraseña nueva de ${user.username}: ${password} — anotala ahora, no se vuelve a mostrar.`,
  );
}

/* ── Alta y baja ────────────────────────────────────────────────────── */

export async function toggleUserActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();

  const id = Number(formData.get("id"));
  const active = formData.get("active") === "true";
  if (!id) return error("Cuenta no encontrada.");

  if (id === admin.id) {
    return error("No podés desactivar tu propia cuenta.");
  }

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);

  if (!user) return error("Cuenta no encontrada.");

  if (
    !active &&
    user.role === "admin" &&
    !(await otherActiveAdminExists(id))
  ) {
    return error("Tiene que quedar al menos una cuenta de administración activa.");
  }

  await db.update(adminUsers).set({ active }).where(eq(adminUsers.id, id));

  refresh();

  return ok(
    active
      ? `${user.displayName || user.username} puede volver a entrar.`
      : `${user.displayName || user.username} ya no puede entrar al panel. Sus sesiones abiertas se cortan en el acto.`,
  );
}
