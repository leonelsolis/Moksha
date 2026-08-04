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
 *
 * Una entrada puede ser una función en vez de una lista fija. Se resuelve
 * ANTES de abrir la transacción y tiene que devolver las sentencias a aplicar;
 * sirve para lo que depende del estado de la base, como no repetir una columna
 * que ya existe. Lo que devuelve se ejecuta igual que cualquier otra: todo
 * junto o nada.
 */
type Migration = string[] | ((client: Client) => Promise<string[]>);

const MIGRATIONS: Migration[] = [
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

  // ── v3 · una cuenta por profesional ─────────────────────────────────────
  [
    /**
     * Cada cuenta del panel puede quedar atada a una profesional.
     *
     * `professional_id` es lo que permite aislar los datos: con él puesto, el
     * usuario solo ve los turnos, horarios y vacaciones de esa profesional. En
     * las cuentas de administración queda en NULL, que significa "todas".
     *
     * `email` es la dirección de contacto de la cuenta, no la del negocio: es
     * a donde le llegan los avisos de turno nuevo y de cancelación, y a futuro
     * será por donde se recupere la contraseña.
     *
     * `active` da de baja una cuenta sin borrarla, para no perder el rastro de
     * quién hizo qué.
     */
    `ALTER TABLE admin_users ADD COLUMN professional_id INTEGER REFERENCES professionals(id)`,
    `ALTER TABLE admin_users ADD COLUMN email TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE admin_users ADD COLUMN active INTEGER NOT NULL DEFAULT 1`,
    `CREATE INDEX IF NOT EXISTS admin_users_professional_idx ON admin_users(professional_id)`,

    /*
     * Los roles cambian de nombre junto con su significado. 'owner' pasa a
     * 'admin' sin perder nada. 'staff' (la vieja recepción, que veía todos los
     * turnos sin poder configurar) pasa a 'profesional' con professional_id en
     * NULL: hasta que un admin la vincule a una profesional concreta no ve
     * ningún turno, que es el lado seguro del cambio.
     */
    `UPDATE admin_users SET role = 'admin' WHERE role = 'owner'`,
    `UPDATE admin_users SET role = 'profesional' WHERE role NOT IN ('admin', 'profesional')`,
  ],

  // ── v4 · qué es cada servicio ───────────────────────────────────────────
  [
    /**
     * La ficha que explica el servicio en la web pública.
     *
     * `description` es el texto ("qué es un kapping"), `photo_url` una imagen
     * de ejemplo y `show_photo` el interruptor que decide si esa imagen se
     * muestra. Son tres columnas y no dos porque el texto y la foto se
     * encienden por separado: se puede querer explicar el servicio sin foto,
     * y se puede querer guardar una foto sin publicarla todavía.
     *
     * `show_photo` arranca apagado: una base existente no empieza a mostrar
     * recuadros que nadie configuró.
     */
    `ALTER TABLE services ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE services ADD COLUMN photo_url TEXT`,
    `ALTER TABLE services ADD COLUMN show_photo INTEGER NOT NULL DEFAULT 0`,
  ],

  /**
   * ── v5 y v6 · números quemados, a propósito vacíos ──────────────────────
   *
   * Un intento anterior de Mercado Pago (señas obligatorias) llegó a aplicar
   * sus migraciones v5 y v6 en las bases de desarrollo antes de que ese
   * trabajo se sacara de `main`. Esas bases tienen `_migrations` en 6, con
   * columnas y tablas que el código actual ya no usa (`services.deposit_amount`,
   * `appointments.mp_preference_id`, la tabla `mp_payments`).
   *
   * Los números no se pueden reciclar: una base que ya registró la 5 y la 6
   * nunca las vuelve a ejecutar, así que si acá pusiéramos SQL nuevo con esos
   * números, en esas bases no correría jamás y el error aparecería recién en
   * producción. Quedan como entradas vacías —se registran sin ejecutar nada— y
   * lo nuevo arranca en v7.
   *
   * Las columnas viejas se dejan donde están: están vacías, no molestan, y
   * sacarlas es un movimiento aparte que no hace falta para esto.
   */
  [],
  [],

  // ── v7 · cobro online opcional (Mercado Pago) ───────────────────────────
  [
    /**
     * Interruptor global de la integración con Mercado Pago.
     *
     * No hay columna nueva: `settings` es clave/valor, así que el flag es una
     * fila más. La migración solo la deja creada para que exista en la base
     * desde el minuto cero, en lugar de aparecer recién cuando alguien guarda
     * Ajustes por primera vez.
     *
     * Arranca apagado a propósito. Sin token cargado en el servidor la web
     * tiene que seguir funcionando exactamente como hasta ahora: se reserva el
     * turno y no se cobra nada online.
     *
     * `INSERT OR IGNORE` hace que correr la migración sobre una base donde el
     * cliente ya lo encendió no se lo apague de vuelta.
     */
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('mp_enabled', 'false')`,
  ],

  // ── v8 · seña por servicio y pre-reserva a la espera del pago ───────────
  async (client) => [
    /**
     * El monto de la seña vive en el servicio, no en Ajustes: una manicuría de
     * $8.000 y un kapping de $25.000 no se señan igual. NULL o 0 significa "no
     * se cobra nada online por este servicio", que es como quedan todos los
     * servicios que ya existen: encender Mercado Pago no empieza a cobrar de
     * golpe, hay que decir servicio por servicio cuánto se seña.
     */
    ...(await addColumns(client, "services", {
      deposit_amount: "REAL",
    })),

    /**
     * Lo que el turno guarda del cobro.
     *
     * `deposit_amount` se copia acá al reservar, igual que `service_name`: es
     * lo que se cobró ese día, y tiene que seguir siendo cierto aunque después
     * cambie el precio del servicio.
     *
     * `hold_expires_at` es hasta cuándo la pre-reserva retiene el horario. Sin
     * esto, alguien que abre el checkout y cierra la pestaña dejaría el horario
     * bloqueado para siempre.
     */
    ...(await addColumns(client, "appointments", {
      deposit_amount: "REAL",
      mp_preference_id: "TEXT",
      mp_checkout_url: "TEXT",
      mp_payment_id: "TEXT",
      paid_at: "INTEGER",
      hold_expires_at: "INTEGER",
    })),

    /**
     * El índice antichoque ahora también cubre las pre-reservas.
     *
     * Mientras el horario está retenido esperando el pago no puede entrar otro
     * turno encima, o dos personas pagarían la seña del mismo lugar. Las
     * pre-reservas vencidas se pasan a 'expired_payment' antes de cada alta
     * (ver `createBooking`), así una que quedó a medias no bloquea el horario
     * para siempre.
     */
    `DROP INDEX IF EXISTS appointments_slot_unique`,
    `CREATE UNIQUE INDEX appointments_slot_unique
       ON appointments(professional_id, date, start_minute)
       WHERE status IN ('booked', 'pending_payment')`,

    /** Cuánto se le espera a alguien que se fue a pagar. */
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('mp_hold_minutes', '30')`,
  ],

  // ── v9 · recuperación de contraseña ─────────────────────────────────────
  [
    /**
     * Los pedidos de "olvidé mi contraseña".
     *
     * Solo el hash del token, nunca el token: el que sirve para entrar viaja
     * únicamente en el link del mail. `expires_at` es un timestamp unix porque
     * es un instante real, y `used_at` marca los que ya se gastaron para que un
     * link reenviado o guardado no vuelva a funcionar.
     *
     * El índice único sobre el hash es a la vez la garantía de que no se repite
     * y la forma en que se busca el token al abrir el link.
     */
    `CREATE TABLE IF NOT EXISTS password_resets (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
       token_hash TEXT    NOT NULL,
       expires_at INTEGER NOT NULL,
       used_at    INTEGER,
       created_at INTEGER NOT NULL DEFAULT (unixepoch())
     )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS password_resets_token_idx ON password_resets(token_hash)`,
    `CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id)`,
  ],

  // ── v10 · turnos cargados a mano desde el panel ─────────────────────────
  async (client) => [
    /**
     * El turno que no salió de la web.
     *
     * Cuando alguien pide el turno por WhatsApp, la profesional lo carga desde
     * el panel. Va a la misma tabla que los demás —es la única forma de que
     * ocupe el horario de verdad y de que la agenda sea una sola— con tres
     * columnas que lo distinguen:
     *
     *   `origin`             'manual' u 'online'. Arranca en 'online' para que
     *                        todo lo que ya está cargado quede como lo que es.
     *   `created_by_user_id` qué cuenta lo anotó. Sin clave foránea a propósito
     *                        (ver la nota del esquema).
     *   `notes`              lo que haya que recordar de ese turno.
     *
     * El texto vacío como valor por defecto de `notes` mantiene la convención
     * de la tabla: los textos opcionales son '' y no NULL, así ninguna pantalla
     * tiene que distinguir entre "sin nota" y "nota nula".
     */
    ...(await addColumns(client, "appointments", {
      origin: "TEXT NOT NULL DEFAULT 'online'",
      created_by_user_id: "INTEGER",
      notes: "TEXT NOT NULL DEFAULT ''",
    })),

    /**
     * Los datos de la clienta dejan de ser obligatorios.
     *
     * En un turno de la web siguen viniendo todos y validados; en uno cargado a
     * mano el único seguro es el nombre. SQLite no sabe cambiar la nulabilidad
     * de una columna con ALTER, pero acá no hace falta: las columnas ya son NOT
     * NULL y lo siguen siendo. Lo que cambia es qué se guarda —cadena vacía en
     * lugar de un dato inventado— y eso no necesita migración. Queda anotado
     * para que la diferencia entre el esquema y la realidad no sorprenda a
     * nadie: el DEFAULT '' que se agrega en `schema.ts` es lo que evita tener
     * que escribir la cadena vacía en cada inserción.
     */
  ],
];

/**
 * ALTER TABLE ADD COLUMN de las que falten, nada más.
 *
 * SQLite no tiene "ADD COLUMN IF NOT EXISTS" y repetir una columna existente
 * aborta la migración entera. Hace falta porque el intento anterior de Mercado
 * Pago (ver la nota de v5 y v6) dejó algunas de estas columnas creadas en las
 * bases de desarrollo: ahí hay que saltearlas, y en una base limpia hay que
 * crearlas.
 *
 * Los nombres de columna se leen de un SELECT vacío y no de un PRAGMA, que es
 * lo que funciona igual en el archivo local y en Turso.
 */
async function addColumns(
  client: Client,
  table: string,
  columns: Record<string, string>,
): Promise<string[]> {
  const result = await client.execute(`SELECT * FROM ${table} LIMIT 0`);
  const existing = new Set(result.columns);

  return Object.entries(columns)
    .filter(([name]) => !existing.has(name))
    .map(([name, type]) => `ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
}

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
 * Cada migración tiene que poder convivir con el código de la versión
 * anterior. En producción esto corre durante el build (`scripts/predeploy.ts`),
 * o sea antes de que el deploy nuevo reemplace al que está sirviendo: hay unos
 * segundos —o para siempre, si el deploy se revierte— en los que la base está
 * adelante del código vivo. Agregar columnas y tablas es seguro; renombrar o
 * borrar algo que el código anterior todavía lee, no. Sacar una columna va en
 * dos pasos y dos despliegues: primero se deja de usar, después se borra.
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
    const entry = MIGRATIONS[version];
    const statements = typeof entry === "function" ? await entry(client) : entry;

    // `batch` con modo "write" corre todo el bloque en una transacción: o se
    // aplica la migración entera o no se aplica nada.
    await client.batch(
      [
        ...statements,
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