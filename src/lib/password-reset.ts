import "server-only";

import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { adminUsers, passwordResets, type AdminUser } from "@/db/schema";
import { hashPassword } from "./auth";
import { generateToken, hashToken, looksLikeToken } from "./tokens";
import { isValidEmail, normalizeEmail } from "./validation";

/**
 * Recuperación de contraseña del panel.
 *
 * El flujo entero en tres piezas: se pide un link, se comprueba el link, se
 * cambia la contraseña. Las tres viven acá y las acciones de `actions/auth.ts`
 * solo las conectan con el formulario.
 *
 * Dos decisiones que atraviesan todo el archivo:
 *
 *   · Nada de lo que devuelve una función deja saber si una dirección
 *     corresponde a una cuenta. Quien pide un link ve siempre la misma
 *     respuesta, exista o no la cuenta. Enumerar los emails del panel sería el
 *     primer paso para atacarlo.
 *
 *   · En la base solo está el hash del token. El token en claro se devuelve una
 *     única vez —para armar el link del mail— y no se puede volver a leer.
 */

/**
 * Cuánto vale un link.
 *
 * Media hora es el equilibrio habitual: alcanza para ir a buscar el mail y
 * volver, y es poco tiempo para que sirva un token que quedó en una casilla
 * abierta o en el historial de un navegador prestado.
 */
export const RESET_TTL_MINUTES = 30;

/** Cuánto tiempo se guardan los pedidos ya vencidos o usados. */
const KEEP_SPENT_HOURS = 24;

const now = () => Math.floor(Date.now() / 1000);

export type IssuedReset = {
  user: AdminUser;
  /** Token en claro. Solo existe acá y en el link del mail. */
  token: string;
  expiresAt: number;
};

/**
 * Emite un link de recuperación por cada cuenta activa con ese email.
 *
 * Son varias y no una porque `admin_users.email` no es único: una misma persona
 * puede tener la cuenta de administración y la suya de profesional con la misma
 * dirección. Mandar un link por cuenta —cada uno diciendo a qué usuario
 * pertenece— es lo único que le permite elegir cuál está recuperando.
 *
 * Devuelve una lista vacía cuando no hay ninguna coincidencia, sin distinguir
 * ese caso de un email mal escrito: quien llama tiene que responder igual en
 * los dos.
 */
export async function issuePasswordResets(rawEmail: string): Promise<IssuedReset[]> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) return [];

  await sweepPasswordResets();

  /*
   * La comparación es sobre `lower(email)` y no sobre la columna tal cual: el
   * panel guarda las direcciones normalizadas, pero las de la carga inicial
   * salen de variables de entorno escritas a mano y pueden traer mayúsculas.
   */
  const accounts = await db
    .select()
    .from(adminUsers)
    .where(
      and(
        eq(sql`lower(${adminUsers.email})`, email),
        eq(adminUsers.active, true),
      ),
    );

  const expiresAt = now() + RESET_TTL_MINUTES * 60;
  const issued: IssuedReset[] = [];

  for (const user of accounts) {
    /*
     * Pedir un link nuevo invalida el anterior. Si no, cada pedido dejaría una
     * puerta más abierta durante media hora, y una casilla comprometida hace
     * rato serviría para entrar aunque la persona ya haya recuperado la cuenta.
     */
    await db
      .delete(passwordResets)
      .where(
        and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)),
      );

    const { token, hash } = generateToken();

    await db.insert(passwordResets).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt,
    });

    issued.push({ user, token, expiresAt });
  }

  return issued;
}

export type ResetLookup =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Qué cuenta abre este token, si es que abre alguna.
 *
 * Se usa dos veces: al abrir el link, para decidir si se muestra el formulario
 * o el aviso de link vencido, y de nuevo al guardar la contraseña. La segunda
 * vez no es redundante: entre una y otra pasan minutos, y lo que llega al
 * servidor al enviar el formulario es un token que hay que volver a validar.
 *
 * Un token usado, uno vencido y uno inventado se distinguen solo para poder
 * explicarle a la persona qué pasó. Ninguno de los tres da acceso, y en los
 * tres casos la salida es la misma: pedir otro link.
 */
export async function resolvePasswordReset(token: string): Promise<ResetLookup> {
  if (!looksLikeToken(token)) return { ok: false, reason: "invalid" };

  const [row] = await db
    .select({ reset: passwordResets, user: adminUsers })
    .from(passwordResets)
    .innerJoin(adminUsers, eq(adminUsers.id, passwordResets.userId))
    .where(eq(passwordResets.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) return { ok: false, reason: "invalid" };
  if (row.reset.usedAt !== null) return { ok: false, reason: "expired" };
  if (row.reset.expiresAt <= now()) return { ok: false, reason: "expired" };

  /*
   * La cuenta puede haberse desactivado después de pedir el link. Se responde
   * "inválido" y no "esta cuenta está desactivada": el link llegó por mail, así
   * que quien lo abre no necesariamente es la dueña de la casilla.
   */
  if (!row.user.active) return { ok: false, reason: "invalid" };

  return { ok: true, user: row.user };
}

export type ResetOutcome =
  | { ok: true; user: AdminUser }
  | { ok: false; reason: "invalid" | "expired" };

/**
 * Cambia la contraseña y gasta el token.
 *
 * El orden importa: primero se marca el token como usado con un UPDATE
 * condicional (`used_at IS NULL`) y recién si esa fila cambió se toca la
 * contraseña. Dos envíos simultáneos del mismo formulario compiten por ese
 * UPDATE y solo uno lo gana; el otro ve el token gastado. Si algo fallara
 * después, el token queda quemado y la contraseña sin cambiar, que es el lado
 * seguro: se pide otro link.
 *
 * La contraseña ya viene validada por quien llama. Acá se asume larga y
 * repetida correctamente.
 */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetOutcome> {
  const lookup = await resolvePasswordReset(token);
  if (!lookup.ok) return lookup;

  const claimed = await db
    .update(passwordResets)
    .set({ usedAt: now() })
    .where(
      and(
        eq(passwordResets.tokenHash, hashToken(token)),
        isNull(passwordResets.usedAt),
      ),
    );

  if (claimed.rowsAffected === 0) return { ok: false, reason: "expired" };

  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(adminUsers.id, lookup.user.id));

  /*
   * Cualquier otro pedido pendiente de esta cuenta deja de servir. Si alguien
   * más pidió links para esta cuenta, la contraseña recién cambiada no puede
   * volver a cambiarse con uno de ellos.
   */
  await db
    .delete(passwordResets)
    .where(
      and(
        eq(passwordResets.userId, lookup.user.id),
        isNull(passwordResets.usedAt),
      ),
    );

  return { ok: true, user: lookup.user };
}

/**
 * Borra los pedidos vencidos hace rato.
 *
 * Se llama al emitir un link, que es lo bastante infrecuente como para no
 * necesitar un proceso aparte. Los recién vencidos se dejan un día a propósito:
 * son los que permiten responder "ese link ya venció" en lugar de "ese link no
 * existe", que es la diferencia entre una explicación y un misterio.
 */
export async function sweepPasswordResets() {
  await db
    .delete(passwordResets)
    .where(lte(passwordResets.expiresAt, now() - KEEP_SPENT_HOURS * 3600))
    .catch(() => undefined);
}
