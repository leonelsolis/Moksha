import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
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

/**
 * Cómo se agrupan los servicios de cara al cliente.
 *
 * Es un árbol: "Esmaltado semipermanente" arriba y adentro los tipos que hay,
 * cada uno de los cuales puede a su vez tener los suyos. La web pública lo
 * recorre en cards, un nivel por vez, en lugar de tirar treinta servicios
 * sueltos en una lista.
 *
 * Las categorías son del negocio, no de cada profesional: "Capping gel" es lo
 * mismo lo haga quien lo haga, y duplicarlo por profesional obligaría a
 * renombrarlo en tres lugares. Lo que ata una categoría a una profesional es
 * tener servicios suyos adentro; una rama sin ningún servicio de esa persona no
 * aparece en su catálogo.
 *
 * `active` apagado esconde la rama entera —la categoría, sus subcategorías y
 * los servicios que cuelgan de ella— sin borrar nada. Es la forma de sacar de
 * la web una línea completa por una temporada.
 */
export const serviceCategories = sqliteTable(
  "service_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** NULL = categoría de primer nivel. Ver `CATEGORY_MAX_DEPTH`. */
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => serviceCategories.id,
      { onDelete: "set null" },
    ),
    name: text("name").notNull(),
    /** Se muestra bajo el nombre en la card. Vacío = solo el nombre. */
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("service_categories_parent_idx").on(t.parentId)],
);

export const services = sqliteTable(
  "services",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    professionalId: integer("professional_id")
      .notNull()
      .references(() => professionals.id, { onDelete: "cascade" }),
    /**
     * En qué card del catálogo entra. NULL = suelto en el primer nivel, que es
     * como quedan todos los servicios que ya existían.
     */
    categoryId: integer("category_id").references(() => serviceCategories.id, {
      onDelete: "set null",
    }),
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
    /**
     * Datos de la persona.
     *
     * En un turno sacado por la web están todos y validados. En uno cargado a
     * mano desde el panel (`origin = 'manual'`) el único seguro es `firstName`:
     * quien atendió el WhatsApp escribe lo que tenga. `lastName`, `dni` y
     * `email` quedan en cadena vacía —la columna sigue siendo NOT NULL, que es
     * lo que ya esperaba el resto del código— y las pantallas del panel
     * muestran solo lo que esté cargado.
     */
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    dni: text("dni").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),

    /* ── De dónde salió el turno ──────────────────────────────────────── */

    /**
     * Cómo entró el turno a la agenda.
     *
     *   online   la clienta lo sacó sola desde la web. Es el camino de siempre
     *            y el valor por defecto: las filas que ya existen son todas
     *            de ahí.
     *   manual   lo cargó una profesional desde el panel porque el turno se
     *            pidió por WhatsApp, por teléfono o en el mostrador.
     *
     * Un turno manual ocupa el horario exactamente igual que cualquier otro
     * —la disponibilidad y el índice antichoque no miran esta columna—; la
     * distinción es para la agenda, que lo señala con un indicador propio.
     */
    origin: text("origin", { enum: ["online", "manual"] })
      .notNull()
      .default("online"),
    /**
     * Qué cuenta del panel lo cargó. NULL en los que salieron de la web.
     *
     * Es a propósito un id suelto y no una clave foránea: el turno tiene que
     * seguir existiendo tal cual aunque esa cuenta se borre. Es un dato de
     * auditoría —quién lo anotó— y no una relación de la que dependa nada.
     */
    createdByUserId: integer("created_by_user_id"),
    /** Lo que la profesional quiera anotar. Solo se ve en el panel. */
    notes: text("notes").notNull().default(""),
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

/**
 * Pedidos de recuperación de contraseña.
 *
 * Igual que con los tokens de cancelación, acá solo vive el hash SHA-256: el
 * token en claro existe únicamente en el link que llega al mail. Un volcado de
 * la base no alcanza para entrar a ninguna cuenta.
 *
 * Es una tabla aparte y no un par de columnas en `admin_users` porque un token
 * es un hecho con vida propia: se emite, vence y se usa una sola vez. Las filas
 * gastadas se borran solas al día siguiente (ver `sweepPasswordResets`).
 */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** Timestamp unix: es un instante real, no una fecha del negocio. */
    expiresAt: integer("expires_at").notNull(),
    /** Se completa al usarlo. Un token usado no sirve por segunda vez. */
    usedAt: integer("used_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("password_resets_token_idx").on(t.tokenHash),
    index("password_resets_user_idx").on(t.userId),
  ],
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

/**
 * Cola de mensajes de WhatsApp.
 *
 * WhatsApp no se puede mandar solo sin la API oficial de Meta: hace falta un
 * número dedicado, verificación del negocio, plantillas aprobadas y se paga
 * por mensaje. En vez de eso, el sistema arma la cola —a quién escribirle,
 * cuándo y con qué texto— y el panel la despacha con un clic por fila, que
 * abre WhatsApp con el mensaje ya escrito.
 *
 * Cada fila es un mensaje *pendiente*, no uno enviado. Nacen al confirmarse el
 * turno: la confirmación con `dueDate` de hoy y el recordatorio para volver a
 * reservar con la fecha del turno más los días configurados.
 *
 * De la clienta no se copia nada: nombre, teléfono y servicio salen del turno
 * con un JOIN. Así un turno cancelado deja de generar mensajes y una
 * corrección de datos se ve en el texto sin tocar esta tabla.
 */
export const whatsappMessages = sqliteTable(
  "whatsapp_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    appointmentId: integer("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    /**
     *   confirmation  el turno quedó reservado. Corresponde en el momento.
     *   rebooking     pasaron los días de un servicio; se puede volver a
     *                 sacar turno.
     */
    kind: text("kind", { enum: ["confirmation", "rebooking"] }).notNull(),
    /**
     * A partir de qué día corresponde mandarlo, como fecha del negocio. Es un
     * día del calendario y no un instante, igual que la fecha de un turno.
     */
    dueDate: text("due_date").notNull(),
    /** Timestamp unix de cuando se despachó. NULL = sigue pendiente. */
    sentAt: integer("sent_at"),
    /** Se descartó a mano desde el panel: no se manda y no vuelve a aparecer. */
    dismissedAt: integer("dismissed_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("whatsapp_messages_unique_idx").on(t.appointmentId, t.kind),
    index("whatsapp_messages_pending_idx").on(t.dueDate),
  ],
);

export type Professional = typeof professionals.$inferSelect;
export type ServiceCategory = typeof serviceCategories.$inferSelect;
export type Service = typeof services.$inferSelect;
export type Vacation = typeof vacations.$inferSelect;
export type WorkingHour = typeof workingHours.$inferSelect;
export type ScheduleOverride = typeof scheduleOverrides.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type WhatsappKind = WhatsappMessage["kind"];
