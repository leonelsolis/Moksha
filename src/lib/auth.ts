import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { and, eq, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { db } from "@/db";
import { adminUsers, type AdminUser } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  signSession,
  verifySession,
  type Role,
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
 *
 * Una cuenta desactivada se trata igual que una contraseña incorrecta: el
 * mensaje del login no distingue los casos, así desactivar a alguien no le
 * confirma que su usuario existe.
 */
const DUMMY_HASH = "$2b$12$abcdefghijklmnopqrstuvOAyMEuFEuRZFbXTgpZDCNc9pQ5W99Iy";

export async function verifyCredentials(username: string, password: string) {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.username, username.trim().toLowerCase()))
    .limit(1);

  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !matches || !user.active) return null;

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

/**
 * El usuario de la sesión, leído de la base.
 *
 * La cookie firmada dice quién es; la base dice qué puede hacer. Se consulta en
 * cada request en lugar de confiar en el rol guardado en el token porque si no
 * un cambio de permisos (o una cuenta desactivada) recién surtiría efecto al
 * vencer la cookie, hasta doce horas después.
 *
 * `cache` de React lo memoriza dentro de un mismo request, así que el layout,
 * la página y las acciones comparten una sola consulta.
 */
export const getCurrentUser = cache(async (): Promise<AdminUser | null> => {
  const session = await getSession();
  if (!session) return null;

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, session.userId))
    .limit(1);

  if (!user || !user.active) return null;

  return user;
});

/** Para páginas y acciones del panel: corta la ejecución si no hay sesión. */
export async function requireUser(): Promise<AdminUser> {
  const user = await getCurrentUser();
  if (user) return user;

  /*
   * Hay un caso en el que la cookie sigue siendo válida pero el usuario ya no:
   * lo desactivaron o le borraron la cuenta mientras tenía la sesión abierta.
   *
   * Mandarlo al login no alcanzaría. El middleware solo verifica la firma del
   * token, daría esa cookie por buena y lo devolvería a /admin, que volvería a
   * mandarlo al login: un rebote infinito. Hay que pasar antes por la ruta que
   * borra la cookie.
   */
  const staleCookie = await getSession();
  redirect(staleCookie ? "/admin/salir" : "/admin/login");
}

/** Para lo que solo toca la administración: profesionales, ajustes, usuarios. */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/admin");
  return user;
}

/* ── Alcance por profesional ────────────────────────────────────────────── */

/**
 * Qué profesionales puede ver o tocar este usuario.
 *
 * `null` significa "todas" (administración). Un número, solo esa. Una cuenta
 * con rol 'profesional' sin vincular devuelve un id imposible en lugar de
 * `null`: sin esto, olvidarse de vincularla la convertiría en administradora
 * de hecho, que es exactamente el error que no se puede cometer acá.
 */
export function scopeOf(user: AdminUser): number | null {
  if (user.role === "admin") return null;
  return user.professionalId ?? -1;
}

/** ¿Puede este usuario operar sobre esta profesional? */
export function canAccessProfessional(user: AdminUser, professionalId: number) {
  const scope = scopeOf(user);
  return scope === null || scope === professionalId;
}

/**
 * Condición SQL que limita una consulta a lo que el usuario puede ver.
 *
 * Devuelve `undefined` para la administración, que combinado con `and(...)` de
 * Drizzle simplemente no agrega ninguna condición.
 *
 * Se usa también en los borrados y actualizaciones por id: agregando esta
 * condición al WHERE, un id ajeno no afecta ninguna fila en lugar de tener que
 * leerla antes para comprobar de quién es.
 */
export function professionalScope(
  user: AdminUser,
  column: SQLiteColumn,
): SQL | undefined {
  const scope = scopeOf(user);
  return scope === null ? undefined : eq(column, scope);
}

/** Igual que la anterior pero combinada con otras condiciones. */
export function withScope(
  user: AdminUser,
  column: SQLiteColumn,
  ...conditions: (SQL | undefined)[]
) {
  return and(...conditions, professionalScope(user, column));
}

export type { AdminUser, Role };
