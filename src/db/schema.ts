import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Convenciones del esquema:
 *
 * - Las fechas se guardan como texto 'YYYY-MM-DD' en la zona horaria del
 *   negocio, nunca como timestamps UTC. Evita por completo los errores de
 *   desplazamiento por horario de verano al calcular disponibilidad.
 * - Las horas se guardan como minutos desde la medianoche (int). Comparar
 *   y sumar rangos horarios pasa a ser aritmética entera.
 * - Los momentos absolutos (creado, cancelado) sí son timestamps unix en
 *   segundos, porque ahí sí importa el instante real.
 */

export const professionals = sqliteTable("professionals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Rubro visible bajo el nombre en la web pública. Ej: "Uñas", "Cejas". */
  specialty: text("specialty").notNull().default(""),
  photoUrl: text("photo_url"),
  bio: text("bio").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  /** Toggle inmediato e indefinido. Los rangos con fecha van en `vacations`. */
  onVacation: integer("on_vacation", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch())`),
});

export const services = sqliteTable(
  "services",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    /** Opcional: si es null no se muestra precio en ninguna pantalla. */
    price: real("price"),
    /**
     * Cuánto se cobra por adelantado para tomar este turno, en pesos.
     *
     * NULL o 0 = sin seña: el turno se confirma en el momento, sin pasar por
     * ningún cobro. Es el valor de todos los servicios que ya existen, así que
     * encender Mercado Pago no empieza a cobrar nada hasta que se cargue un
     * monto acá. Ver src/lib/payments.ts.
     */
    depositAmount: real("deposit_amount"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Qué es el servicio, en las palabras del negocio. Se muestra en una ficha
     * al costado del flujo de reserva cuando el cliente lo elige.
     */
    description: text("description").notNull().default(""),
    photoUrl: text("photo_url"),
    /**
     * El interruptor de la foto, aparte de la foto misma: sin él, la única
     * manera de dejar de mostrarla sería borrarla y volver a subirla.
     */
    showPhoto: integer("show_photo", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("services_professional_idx").on(t.professionalId)],
);

export const vacations = sqliteTable(
  "vacations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    startDate: text("start_date").notNull(),
    /** Inclusivo: el último día de vacaciones también está bloqueado. */
    endDate: text("end_date").notNull(),
    note: text("note").notNull().default(""),
  },
  (t) => [index("vacations_professional_idx").on(t.professionalId)],
);

/** Horario semanal recurrente. Varias filas por día = varios turnos (mañana/tarde). */
export const workingHours = sqliteTable(
  "working_hours",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    /** 0 = domingo … 6 = sábado (igual que Date.getDay). */
    weekday: integer("weekday").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
  },
  (t) => [
    index("working_hours_professional_idx").on(t.professionalId, t.weekday),
  ],
);

/**
 * Excepciones puntuales que pisan al horario semanal para una fecha concreta.
 * kind='closed'  → ese día no atiende (start/end se ignoran)
 * kind='custom'  → ese día atiende exactamente en los rangos declarados acá
 */
export const scheduleOverrides = sqliteTable(
  "schedule_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    kind: text("kind", { enum: ["closed", "custom"] }).notNull(),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    note: text("note").notNull().default(""),
  },
  (t) => [index("overrides_professional_date_idx").on(t.professionalId, t.date)],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionals.id),
    /** Se conserva aunque el servicio se borre: el turno guarda su propia copia. */
    serviceId: integer("service_id"),
    serviceName: text("service_name").notNull().default(""),
    date: text("date").notNull(),
    startMinute: integer("start_minute").notNull(),
    endMinute: integer("end_minute").notNull(),
    /**
     * Estado del turno.
     *
     *   booked             confirmado. Es el único estado con el que se atiende
     *                      a alguien, y el que ocupa el horario de verdad.
     *   pending_payment    pre-reserva: el horario está retenido mientras la
     *                      clienta paga la seña en Mercado Pago. Se confirma
     *                      cuando el pago se aprueba.
     *   expired_payment    la pre-reserva venció sin pago. El horario ya está
     *                      libre; la fila queda como registro.
     *   cancelled_by_*     cancelado, por la clienta o desde el local.
     *
     * Solo hay dos estados que retienen el horario: 'booked' y una
     * 'pending_payment' que todavía no venció. Ver `occupiesSlot`.
     */
    status: text("status", {
      enum: [
        "booked",
        "pending_payment",
        "expired_payment",
        "cancelled_by_client",
        "cancelled_by_admin",
      ],
    })
      .notNull()
      .default("booked"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dni: text("dni").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    /**
     * Solo el hash SHA-256 del token de cancelación. El token en claro existe
     * únicamente en el link que recibe el cliente, así un volcado de la base
     * no permite cancelar turnos ajenos.
     */
    cancelTokenHash: text("cancel_token_hash").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    cancelledAt: integer("cancelled_at"),

    /* ── Cobro de la seña ─────────────────────────────────────────────
     * Todo esto queda en NULL cuando el turno no se cobró online, que es el
     * caso de siempre mientras Mercado Pago esté apagado.
     */
    /** Lo que se cobró por este turno. Copia del servicio al momento de reservar. */
    depositAmount: real("deposit_amount"),
    mpPreferenceId: text("mp_preference_id"),
    /** El link de pago ya creado, para que reintentar no cree otra preferencia. */
    mpCheckoutUrl: text("mp_checkout_url"),
    mpPaymentId: text("mp_payment_id"),
    paidAt: integer("paid_at"),
    /** Hasta cuándo la pre-reserva retiene el horario (timestamp unix). */
    holdExpiresAt: integer("hold_expires_at"),
  },
  (t) => [
    uniqueIndex("appointments_cancel_token_idx").on(t.cancelTokenHash),
    index("appointments_date_idx").on(t.date, t.professionalId),
    index("appointments_lookup_idx").on(t.dni, t.email),
  ],
);

/**
 * Cuentas del panel.
 *
 * El par (role, professionalId) es lo que define qué ve cada una:
 *   · admin       → professionalId NULL, ve y gestiona todo.
 *   · profesional → professionalId apunta a una fila de `professionals`, y solo
 *                   ve los turnos, horarios y vacaciones de esa profesional.
 *
 * El rol por defecto es el más limitado a propósito: una fila insertada a mano
 * sin especificarlo no queda con acceso total por descuido.
 */
export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull().default(""),
    role: text("role", { enum: ["admin", "profesional"] })
      .notNull()
      .default("profesional"),
    /** NULL en las cuentas de administración: no están atadas a ninguna. */
    professionalId: integer("professional_id").references(() => professionals.id),
    /**
     * Dirección de contacto de la cuenta. Recibe los avisos de turno nuevo y de
     * cancelación, y queda lista para la recuperación de contraseña.
     */
    email: text("email").notNull().default(""),
    /** Baja lógica: la cuenta no puede entrar pero su historial se conserva. */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
    lastLoginAt: integer("last_login_at"),
  },
  (t) => [index("admin_users_professional_idx").on(t.professionalId)],
);

/** Configuración clave/valor. Todo lo que distingue a un negocio de otro. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * Contadores de intentos para el login y la búsqueda por DNI.
 *
 * Están en la base y no en memoria porque en producción corren varias
 * instancias del servidor a la vez: con contadores por proceso, el límite real
 * se multiplicaría por la cantidad de instancias.
 */
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: integer("reset_at").notNull(),
});

export type Professional = typeof professionals.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Vacation = typeof vacations.$inferSelect;
export type WorkingHour = typeof workingHours.$inferSelect;
export type ScheduleOverride = typeof scheduleOverrides.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
