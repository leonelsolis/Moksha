"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import type { LoginState, PasswordState } from "@/lib/action-state";
import {
  createSession,
  destroySession,
  hashPassword,
  requireSession,
  verifyCredentials,
} from "@/lib/auth";
import { checkRateLimit, clearRateLimit, clientKey } from "@/lib/rate-limit";

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
  const session = await requireSession();

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const repeat = String(formData.get("repeatPassword") ?? "");

  if (next.length < 8) {
    return { ok: false, message: "La contraseña nueva debe tener al menos 8 caracteres." };
  }

  if (next !== repeat) {
    return { ok: false, message: "La contraseña nueva y su repetición no coinciden." };
  }

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, session.userId))
    .limit(1);

  if (!user || !(await bcrypt.compare(current, user.passwordHash))) {
    return { ok: false, message: "La contraseña actual no es correcta." };
  }

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(adminUsers.id, session.userId));

  return { ok: true, message: "Contraseña actualizada." };
}
