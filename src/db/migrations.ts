import type { Client } from "@libsql/client";

/**
 * Migraciones versionadas.
 *
 * Cada entrada del array es una versión del esquema. Se aplican las que
 * falten, cada una dentro de una transacción, y se deja registro en la tabla
 * `_migrations`.
 *
 * El control de versión va en una tabla y no en `PRAGMA user_version` porque
 * los PRAGMA no están garantizados en una base alojada como Turso; una tabla
 * funciona igual en cualquier backend.
 *
 * Para cambiar el esquema: agregá una entrada NUEVA al final del array.
 * Nunca edites una que ya se publicó, porque las bases existentes ya la
 * aplicaron y no la volverían a ejecutar.
 */
const MIGRATIONS: string[][] = [
  // ── v1 · esquema inicial ────────────────────────────────────────────────
  [
    `CREATE TABLE IF NOT EXISTS professionals (
       id           INTEGER PRIMARY KEY AUTOINCREMENT,
       name         TEXT    NOT NULL,
       specialty    TEXT    NOT NULL DEFAULT '',
       photo_url    TEXT,
       bio          TEXT    NOT NULL DEFAULT '',
       active       INTEGER NOT NULL DEFAULT 1,
       sort_order   INTEGER NOT NULL DEFAULT 0,
       on_vacation  INTEGER NOT NULL DEFAULT 0,
       created_at   INTEGER NOT NULL DEFAULT (unixepoch())
     )`,

    `CREATE TABLE IF NOT EXISTS services (
       id               INTEGER PRIMARY KEY AUTOINCREMENT,
       professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
       name             TEXT    NOT NULL,
       duration_minutes INTEGER NOT NULL,
       price            REAL,
       active           INTEGER NOT NULL DEFAULT 1,
       sort_order       INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX IF NOT EXISTS services_professional_idx ON services(professional_id)`,

    `CREATE TABLE IF NOT EXISTS vacations (
       id               INTEGER PRIMARY KEY AUTOINCREMENT,
       professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
       start_date       TEXT    NOT NULL,
       end_date         TEXT    NOT NULL,
       note             TEXT    NOT NULL DEFAULT ''
     )`,
    `CREATE INDEX IF NOT EXISTS vacations_professional_idx ON vacations(professional_id)`,

    `CREATE TABLE IF NOT EXISTS working_hours (
       id               INTEGER PRIMARY KEY AUTOINCREMENT,
       professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
       weekday          INTEGER NOT NULL,
       start_minute     INTEGER NOT NULL,
       end_minute       INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS working_hours_professional_idx ON working_hours(professional_id, weekday)`,

    `CREATE TABLE IF NOT EXISTS schedule_overrides (
       id               INTEGER PRIMARY KEY AUTOINCREMENT,
       professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
       date             TEXT    NOT NULL,
       kind             TEXT    NOT NULL,
       start_minute     INTEGER,
       end_minute       INTEGER,
       note             TEXT    NOT NULL DEFAULT ''
     )`,
    `CREATE INDEX IF NOT EXISTS overrides_professional_date_idx ON schedule_overrides(professional_id, date)`,

    `CREATE TABLE IF NOT EXISTS appointments (
       id                INTEGER PRIMARY KEY AUTOINCREMENT,
       professional_id   INTEGER NOT NULL REFERENCES professionals(id),
       service_id        INTEGER,
       service_name      TEXT    NOT NULL DEFAULT '',
       date              TEXT    NOT NULL,
       start_minute      INTEGER NOT NULL,
       end_minute        INTEGER NOT NULL,
       status            TEXT    NOT NULL DEFAULT 'booked',
       first_name        TEXT    NOT NULL,
       last_name         TEXT    NOT NULL,
       dni               TEXT    NOT NULL,
       email             TEXT    NOT NULL,
       phone             TEXT    NOT NULL DEFAULT '',
       cancel_token_hash TEXT    NOT NULL,
       created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
       cancelled_at      INTEGER
     )`,

    /**
     * Red de seguridad contra reservas dobles.
     *
     * Es un índice único PARCIAL: solo aplica a los turnos 'booked'. Al
     * cancelar, la fila cambia de estado, sale del índice y el horario queda
     * libre sin borrar el historial.
     *
     * Cubre el choque exacto (mismo inicio). El solapamiento entre servicios
     * de distinta duración lo resuelve la inserción condicional de
     * `createBooking`.
     */
    `CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_unique
       ON appointments(professional_id, date, start_minute)
       WHERE status = 'booked'`,

    `CREATE UNIQUE INDEX IF NOT EXISTS appointments_cancel_token_idx ON appointments(cancel_token_hash)`,
    `CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(date, professional_id)`,
    `CREATE INDEX IF NOT EXISTS appointments_lookup_idx ON appointments(dni, email)`,

    `CREATE TABLE IF NOT EXISTS admin_users (
       id            INTEGER PRIMARY KEY AUTOINCREMENT,
       username      TEXT    NOT NULL UNIQUE,
       password_hash TEXT    NOT NULL,
       display_name  TEXT    NOT NULL DEFAULT '',
       role          TEXT    NOT NULL DEFAULT 'owner',
       created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
       last_login_at INTEGER
     )`,

    `CREATE TABLE IF NOT EXISTS settings (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
  ],

  // ── v2 · límite de intentos compartido ──────────────────────────────────
  [
    /**
     * Contadores de intentos (login y búsqueda por DNI).
     *
     * Antes vivían en la memoria del proceso. En Vercel corren varias
     * instancias a la vez y cada una tendría su propio contador, así que el
     * límite se multiplicaba por la cantidad de instancias. En la base es un
     * único contador compartido por todas.
     */
    `CREATE TABLE IF NOT EXISTS rate_limits (
       key      TEXT    PRIMARY KEY,
       count    INTEGER NOT NULL,
       reset_at INTEGER NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS rate_limits_reset_idx ON rate_limits(reset_at)`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export type MigrationOutcome = {
  /** Versión desde la que se partió, ya resuelta la adopción de bases viejas. */
  from: number;
  to: number;
  applied: number;
};

/**
 * Aplica las migraciones pendientes.
 *
 * No se ejecuta al arrancar la aplicación: en un entorno sin servidor eso
 * significaría intentarlo en cada arranque en frío y desde varias instancias a
 * la vez. Se corre a mano con `npm run db:migrate`.
 */
export async function runMigrations(client: Client): Promise<MigrationOutcome> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const result = await client.execute(
    "SELECT COALESCE(MAX(version), 0) AS version FROM _migrations",
  );
  let current = Number(result.rows[0]?.version ?? 0);

  /*
   * Bases anteriores al registro en tabla.
   *
   * Las primeras versiones llevaban la cuenta en `PRAGMA user_version`, así
   * que una base creada entonces tiene todas las tablas pero `_migrations`
   * vacía. Sin esto se intentaría recrear el esquema y fallaría.
   */
  if (current === 0) {
    const legacy = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appointments'",
    );

    if (legacy.rows.length > 0) {
      await client.execute({
        sql: "INSERT INTO _migrations (version, applied_at) VALUES (1, unixepoch())",
        args: [],
      });
      current = 1;
    }
  }

  const from = current;

  if (current >= SCHEMA_VERSION) {
    return { from, to: current, applied: 0 };
  }

  for (let version = current; version < SCHEMA_VERSION; version++) {
    // `batch` con modo "write" corre todo el bloque en una transacción: o se
    // aplica la migración entera o no se aplica nada.
    await client.batch(
      [
        ...MIGRATIONS[version],
        {
          sql: "INSERT INTO _migrations (version, applied_at) VALUES (?, unixepoch())",
          args: [version + 1],
        },
      ],
      "write",
    );
  }

  return { from, to: SCHEMA_VERSION, applied: SCHEMA_VERSION - from };
}

/** Versión aplicada actualmente. 0 si la base está vacía. */
export async function currentVersion(client: Client): Promise<number> {
  try {
    const result = await client.execute(
      "SELECT COALESCE(MAX(version), 0) AS version FROM _migrations",
    );
    return Number(result.rows[0]?.version ?? 0);
  } catch {
    return 0;
  }
}