"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import type { ActionState, LoginState, PasswordState } from "@/lib/action-state";
import {
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  verifyCredentials,
} from "@/lib/auth";
import { checkRateLimit, clearRateLimit, clientKey } from "@/lib/rate-limit";
import { isValidEmail, normalizeEmail } from "@/lib/validation";

/**
 * Inicio de sesión del panel.
 *
 * El mensaje de error no distingue entre usuario inexistente y contraseña
 * equivocada, para no confirmarle a nadie qué usuarios existen. El límite de
 * intentos por IP frena la prueba de contraseñas por fuerza bruta.
 */
export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const key = await clientKey("login");
  const limit = await checkRateLimit(key, 8, 900);

  if (!limit.allowed) {
    return {
      message: `Demasiados intentos fallidos. Probá de nuevo en ${Math.ceil(
        limit.retryAfterSeconds / 60,
      )} minutos.`,
    };
  }

  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const target = String(formData.get("volver") ?? "");

  if (!username || !password) {
    return { message: "Completá usuario y contraseña." };
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    return { message: "Usuario o contraseña incorrectos." };
  }

  await clearRateLimit(key);

  await createSession({
    userId: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    role: user.role,
    professionalId: user.professionalId,
  });

  // Solo rutas internas del panel: un destino externo permitiría usar el login
  // como trampolín hacia otro sitio.
  const safeTarget = target.startsWith("/admin") ? target : "/admin";
  redirect(safeTarget);
}

export async function logout() {
  await destroySession();
  redirect("/admin/login");
}

export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const account = await requireUser();

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const repeat = String(formData.get("repeatPassword") ?? "");

  if (next.length < 8) {
    return { ok: false, message: "La contraseña nueva debe tener al menos 8 caracteres." };
  }

  if (next !== repeat) {
    return { ok: false, message: "La contraseña nueva y su repetición no coinciden." };
  }

  if (!(await bcrypt.compare(current, account.passwordHash))) {
    return { ok: false, message: "La contraseña actual no es correcta." };
  }

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(adminUsers.id, account.id));

  return { ok: true, message: "Contraseña actualizada." };
}

/**
 * Cambio del email de contacto propio.
 *
 * Cada quien puede corregir el suyo sin depender de la administración, porque
 * es a donde le llegan los avisos de sus turnos. El de las demás cuentas solo
 * lo toca un admin desde /admin/usuarios.
 */
export async function changeOwnEmail(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const account = await requireUser();

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isValidEmail(email)) {
    return { ok: false, message: "Escribí una dirección de email válida." };
  }

  await db
    .update(adminUsers)
    .set({ email })
    .where(eq(adminUsers.id, account.id));

  revalidatePath("/admin/cuenta");
  return { ok: true, message: `Listo. Los avisos van a llegar a ${email}.` };
}
