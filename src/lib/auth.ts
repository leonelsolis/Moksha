import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { adminUsers } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session";

const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Valida usuario y contraseña.
 *
 * Si el usuario no existe igual se ejecuta una comparación bcrypt contra un
 * hash falso. Sin eso, un usuario inexistente respondería mucho más rápido que
 * uno real con contraseña equivocada, y eso permite enumerar usuarios válidos
 * midiendo el tiempo de respuesta.
 */
const DUMMY_HASH = "$2b$12$abcdefghijklmnopqrstuvOAyMEuFEuRZFbXTgpZDCNc9pQ5W99Iy";

export async function verifyCredentials(username: string, password: string) {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username.trim().toLowerCase()))
    .limit(1);

  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches) return null;

  await db
    .update(adminUsers)
    .set({ lastLoginAt: Math.floor(Date.now() / 1000) })
    .where(eq(adminUsers.id, user.id));

  return user;
}

export async function createSession(payload: SessionPayload) {
  const token = await signSession(payload);
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Para páginas y acciones del panel: corta la ejecución si no hay sesión. */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return session;
}

/** Para lo que solo puede tocar una dueña: ajustes, profesionales, horarios. */
export async function requireOwner(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/admin");
  return session;
}
