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
import { emailConfig, sendPasswordReset } from "@/lib/email";
import {
  completePasswordReset,
  issuePasswordResets,
  RESET_TTL_MINUTES,
} from "@/lib/password-reset";
import { checkRateLimit, clearRateLimit, clientKey } from "@/lib/rate-limit";
import { getSettings } from "@/lib/settings";
import { siteOrigin } from "@/lib/site-url";
import { isValidEmail, normalizeEmail } from "@/lib/validation";

/** Dónde vive el formulario que abre el link del mail. */
const RESET_PATH = "/admin/recuperar";

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

/**
 * Lo que se le exige a una contraseña nueva, sea al cambiarla desde adentro o
 * al recuperarla desde afuera. El mínimo es el mismo en los dos lados: si acá
 * fuera más flojo, recuperar la contraseña sería la forma de saltearse la
 * regla.
 */
function passwordProblem(next: string, repeat: string): string | null {
  if (next.length < 8) {
    return "La contraseña nueva debe tener al menos 8 caracteres.";
  }
  if (next !== repeat) {
    return "La contraseña nueva y su repetición no coinciden.";
  }
  return null;
}

export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const account = await requireUser();

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const repeat = String(formData.get("repeatPassword") ?? "");

  const problem = passwordProblem(next, repeat);
  if (problem) return { ok: false, message: problem };

  if (!(await bcrypt.compare(current, account.passwordHash))) {
    return { ok: false, message: "La contraseña actual no es correcta." };
  }

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(adminUsers.id, account.id));

  return { ok: true, message: "Contraseña actualizada." };
}

/* ── Olvidé mi contraseña ──────────────────────────────────────────────── */

/**
 * Paso 1: pedir el link.
 *
 * Recibe una dirección de email y, si corresponde a alguna cuenta activa, le
 * manda un link de un solo uso que vence en media hora.
 *
 * La respuesta es siempre la misma, exista o no la cuenta. Es deliberado: este
 * formulario no pide contraseña, así que sin esa precaución cualquiera podría
 * ir probando direcciones y armar la lista de emails que tienen acceso al
 * panel, que es justo lo que después se ataca. Por eso tampoco se avisa cuando
 * la dirección está mal escrita.
 *
 * Hay dos límites de intentos y hacen falta los dos: uno por IP, contra el que
 * prueba direcciones en serie, y otro por email, para que nadie use este
 * formulario para llenarle la casilla a una persona concreta desde muchas IPs.
 */
export async function requestPasswordReset(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  /*
   * Sin Resend configurado el link no sale de acá, y la persona se quedaría
   * esperando un mail que no existe. Esto no revela nada de ninguna cuenta:
   * habla de la configuración del servidor, no de quién está registrado.
   */
  const config = emailConfig(await getSettings());
  if (!config.hasKey || !config.from) {
    return {
      ok: false,
      message:
        "La recuperación por email todavía no está configurada. Pedile a la administración que te cambie la contraseña desde el panel.",
    };
  }

  const neutral: ActionState = {
    ok: true,
    message:
      "Si esa dirección corresponde a una cuenta, te mandamos un mail con el link para cambiar la contraseña. Revisá también el correo no deseado.",
  };

  const byIp = await checkRateLimit(await clientKey("reset"), 5, 900);
  if (!byIp.allowed) {
    return {
      ok: false,
      message: `Demasiados pedidos. Probá de nuevo en ${Math.ceil(
        byIp.retryAfterSeconds / 60,
      )} minutos.`,
    };
  }

  if (!isValidEmail(email)) return neutral;

  const byEmail = await checkRateLimit(`reset-email:${email}`, 3, 3600);
  if (!byEmail.allowed) return neutral;

  const issued = await issuePasswordResets(email);
  const origin = await siteOrigin();

  for (const reset of issued) {
    /*
     * Un mail que no sale no puede hacer fallar la acción ni cambiar la
     * respuesta: la diferencia sería visible desde afuera y volvería a delatar
     * qué direcciones existen. El motivo real queda en los logs, que es lo
     * único que después explica un mail que no llegó.
     */
    const result = await sendPasswordReset({
      to: reset.user.email,
      username: reset.user.username,
      displayName: reset.user.displayName,
      resetUrl: `${origin}${RESET_PATH}/${reset.token}`,
      expiresInMinutes: RESET_TTL_MINUTES,
    }).catch((e) => ({ sent: false, reason: String(e) }));

    if (!result.sent) {
      console.warn("[email] no se envió el link de recuperación:", result.reason);
    }
  }

  return neutral;
}

/**
 * Paso 2: cambiar la contraseña con el token del link.
 *
 * El token llega en un campo oculto del formulario, no en la URL de la acción.
 * Se vuelve a validar acá aunque la página ya lo haya validado al abrirse:
 * entre las dos cosas pasan minutos, y lo único que llega al servidor al
 * enviar el formulario es este campo.
 *
 * Un token que no sirve no dice por qué en detalle —se distingue solo entre
 * "no existe" y "ya no vale"— porque las dos salidas son la misma: pedir otro
 * link.
 */
export async function resetPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const limit = await checkRateLimit(await clientKey("reset-confirm"), 10, 900);
  if (!limit.allowed) {
    return {
      ok: false,
      message: `Demasiados intentos. Probá de nuevo en ${Math.ceil(
        limit.retryAfterSeconds / 60,
      )} minutos.`,
    };
  }

  const token = String(formData.get("token") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const repeat = String(formData.get("repeatPassword") ?? "");

  const problem = passwordProblem(next, repeat);
  if (problem) return { ok: false, message: problem };

  const result = await completePasswordReset(token, next);

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "expired"
          ? "Ese link ya venció o se usó. Pedí uno nuevo."
          : "Ese link no es válido. Pedí uno nuevo.",
    };
  }

  /*
   * La contraseña ya cambió, así que ningún intento posterior con ese link
   * sirve. No se abre sesión sola: se entra por el login como siempre, que es
   * la forma de confirmar que la contraseña nueva quedó bien.
   */
  return {
    ok: true,
    message: `Listo, cambiamos la contraseña de ${result.user.username}. Ya podés entrar.`,
  };
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
