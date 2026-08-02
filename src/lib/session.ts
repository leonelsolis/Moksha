import { SignJWT, jwtVerify } from "jose";

/**
 * Sesión del administrador.
 *
 * Se firma un JWT corto y se guarda en una cookie httpOnly. No hay tabla de
 * sesiones: para uno o dos usuarios, mantener estado en la base solo agrega
 * mantenimiento. Cerrar sesión borra la cookie; cambiar AUTH_SECRET invalida
 * todas las sesiones activas de golpe.
 *
 * Este archivo NO toca la base de datos ni módulos de Node, a propósito: el
 * middleware corre en el runtime Edge y solo puede usar esto.
 */

export const SESSION_COOKIE = "moksha_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 horas

export type SessionPayload = {
  userId: number;
  username: string;
  displayName: string;
  role: "owner" | "staff";
};

const DEV_SECRET = "moksha-dev-secret-no-usar-en-produccion";

function getSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Falta AUTH_SECRET (mínimo 32 caracteres). Generalo con: openssl rand -base64 32",
      );
    }
    return new TextEncoder().encode(DEV_SECRET);
  }

  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function verifySession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== "number") return null;
    return {
      userId: payload.userId,
      username: String(payload.username ?? ""),
      displayName: String(payload.displayName ?? ""),
      role: payload.role === "staff" ? "staff" : "owner",
    };
  } catch {
    return null;
  }
}
