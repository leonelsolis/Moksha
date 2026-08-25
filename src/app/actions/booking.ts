"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray, ne } from "drizzle-orm";

import { client, db } from "@/db";
import { appointments, professionals, services } from "@/db/schema";
import type { Professional, Service } from "@/db/schema";
import type {
  BookingState,
  CancelState,
  LookupResult,
  LookupState,
} from "@/lib/action-state";
import { isChainBookable, releaseExpiredHolds } from "@/lib/availability";
import { readLegsOrSingle } from "@/lib/booking-legs";
import { combinedServiceName } from "@/lib/booking-services";
import { formatDateLong, formatMinute, minutesUntil, nowInTz } from "@/lib/dates";
import { sendCancellationConfirmation } from "@/lib/email";
import {
  announceNewBooking,
  notifyProfessionalCancellation,
  notifyProfessionalNewBooking,
} from "@/lib/notify";
import { createDepositCheckout, depositFor, paymentPlanFor } from "@/lib/payments";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { getSettings, settingBool, settingInt } from "@/lib/settings";
import {
  generateCancelToken,
  generateGroupId,
  hashToken,
  looksLikeToken,
} from "@/lib/tokens";
import {
  assignTransferAmount,
  transferAvailableFor,
  transferHoldMinutes,
} from "@/lib/transfer";
import {
  normalizeDni,
  normalizeEmail,
  readCustomer,
  validateCustomer,
  type FieldErrors,
} from "@/lib/validation";

function fail(message: string, errors: FieldErrors = {}): BookingState {
  return { ok: false, message, errors };
}

/**
 * Confirma una reserva.
 *
 * Una reserva puede ser un turno o varios. La forma de siempre —una
 * profesional, uno o varios servicios suyos— sigue guardando una sola fila. La
 * nueva es la visita repartida: las manos con una profesional y las cejas con
 * otra, uno detrás del otro en la misma salida. Ahí se guarda una fila por
 * tramo, cada una en la agenda de su profesional, unidas por `booking_group`.
 *
 * Cada tramo es un turno de verdad y no un pedazo de otra cosa: ocupa su
 * horario, avisa a su profesional y se cancela solo. Lo que hace el grupo es
 * que la clienta tenga un único link que muestra la visita entera y que una
 * sola seña alcance para confirmarla toda.
 *
 * El punto delicado es que dos personas pueden confirmar el mismo horario en
 * el mismo instante. Se resuelve en dos capas, tramo por tramo:
 *
 *   1. La inserción es un único `INSERT … SELECT … WHERE NOT EXISTS`: la
 *      comprobación de choques y el alta viajan en la misma sentencia, y
 *      SQLite ejecuta cada sentencia de forma atómica. No hay ventana entre
 *      "miré si estaba libre" y "lo guardé", que es donde se cuelan las
 *      reservas dobles. Esto cubre el solapamiento entre servicios de distinta
 *      duración (uno de 60' a las 10:00 contra uno de 30' a las 10:30).
 *
 *      Se escribe a mano en vez de usar el constructor de consultas porque
 *      esa forma condicional no se puede expresar con él.
 *
 *   2. El índice único parcial de la tabla es la red de seguridad: aunque un
 *      error de código saltee lo anterior, la base rechaza un segundo turno
 *      con el mismo inicio exacto.
 *
 * Si en esa carrera se pierde un tramo pero no el otro, lo que se salvó se
 * guarda igual y se dice en pantalla cuál faltó. Es lo contrario de tirar
 * abajo la visita entera: la clienta se queda con el turno que consiguió y
 * saca el otro cuando quiera, en vez de perder los dos.
 *
 * Lo que se guarda en cada fila —nombre del servicio, duración, seña— se arma
 * acá con lo que traiga la base, nunca con lo que diga el formulario: del
 * navegador solo se aceptan los ids.
 *
 * De acá salen dos finales distintos, y cuál es lo decide `paymentPlanFor`:
 *
 *   · Sin cobro (Mercado Pago apagado, sin token, o servicios sin seña): los
 *     turnos nacen confirmados, se manda el mail y se va a la pantalla del
 *     turno. Es el camino de siempre y el que corre de fábrica.
 *
 *   · Con cobro: los turnos nacen como pre-reserva ('pending_payment'),
 *     retienen el horario un rato y la clienta se va al checkout de Mercado
 *     Pago. Recién con el pago aprobado pasan a confirmados. La seña es una
 *     sola por visita —la suma de todos los tramos— y queda anotada en el
 *     primero, que es el que se cobra; al acreditarse se confirman todos.
 *
 * Que el cobro esté mal configurado o que Mercado Pago no conteste no rompe
 * ninguna reserva: en cualquiera de esos casos se termina por el primer camino.
 */
export async function createBooking(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const limit = await checkRateLimit(await clientKey("book"), 8, 600);
  if (!limit.allowed) {
    return fail(
      "Demasiados intentos seguidos. Esperá unos minutos y volvé a probar.",
    );
  }

  const legIds = readLegsOrSingle({
    legs: String(formData.get("legs") ?? ""),
    professionalId: String(formData.get("professionalId") ?? ""),
    serviceIds: String(formData.get("serviceIds") ?? formData.get("serviceId") ?? ""),
  });

  const date = String(formData.get("date") ?? "");
  const startMinute = Number(formData.get("startMinute"));

  if (legIds.length === 0 || !date || !Number.isFinite(startMinute)) {
    return fail("Faltan datos del turno. Volvé a elegir el horario.");
  }

  const { errors, value } = validateCustomer(readCustomer(formData));
  if (Object.keys(errors).length > 0) {
    return { ok: false, message: "Revisá los datos marcados.", errors };
  }

  const settings = await getSettings();

  /*
   * Las profesionales y los servicios, en dos consultas para todos los tramos
   * juntos. Se piden por separado y se cruzan acá abajo porque cada servicio
   * tiene que ser de la profesional de SU tramo: sin esa comprobación, un
   * formulario manipulado podría pedir un servicio de una en la agenda de otra.
   */
  const professionalRows = await db
    .select()
    .from(professionals)
    .where(
      and(
        inArray(professionals.id, legIds.map((leg) => leg.professionalId)),
        eq(professionals.active, true),
      ),
    );

  const serviceRows = await db
    .select()
    .from(services)
    .where(
      and(
        inArray(services.id, legIds.flatMap((leg) => leg.serviceIds)),
        eq(services.active, true),
      ),
    );

  /** Cada tramo ya resuelto: quién atiende, qué le toca y a qué hora empieza. */
  const legs: {
    professional: Professional;
    serviceId: number;
    serviceName: string;
    duration: number;
    deposit: number;
    startMinute: number;
  }[] = [];

  let cursor = startMinute;
  for (const leg of legIds) {
    const professional = professionalRows.find(
      (row) => row.id === leg.professionalId,
    );
    if (!professional) return fail("Esa profesional ya no está disponible.");

    const chosen = leg.serviceIds.map((id) =>
      serviceRows.find(
        (row) => row.id === id && row.professionalId === professional.id,
      ),
    );

    // Se piden todos: reservar con uno menos sería darle a la clienta un turno
    // más corto que el que pidió, y enterarse recién al llegar.
    if (chosen.some((row) => row === undefined)) {
      return fail("Alguno de los servicios ya no está disponible. Volvé a elegir.");
    }

    const rows = chosen as Service[];

    legs.push({
      professional,
      /*
       * `serviceId` guarda el primero porque la columna es una sola y el
       * nombre completo ya queda en `service_name`, que es lo que leen el
       * panel, el mail y la pantalla del turno.
       */
      serviceId: rows[0].id,
      serviceName: combinedServiceName(rows.map((row) => row.name)),
      duration: rows.reduce((total, row) => total + row.durationMinutes, 0),
      deposit: rows.reduce((total, row) => total + (row.depositAmount ?? 0), 0),
      startMinute: cursor,
    });

    cursor += legs[legs.length - 1].duration;
  }

  // Chequeo completo contra las reglas del negocio —horario laboral,
  // vacaciones, excepciones, antelación mínima y turnos ya tomados— y, con
  // varios tramos, que entren todos uno detrás del otro.
  const bookable = await isChainBookable({
    legs: legs.map((leg) => ({
      professional: leg.professional,
      duration: leg.duration,
    })),
    date,
    startMinute,
    settings,
  });

  if (!bookable) {
    return fail(
      "Ese horario se ocupó mientras completabas tus datos. Elegí otro, por favor.",
    );
  }

  /*
   * La seña es una sola por visita: la suma de la de cada servicio de cada
   * tramo. Se cobra una vez y confirma todo, porque para la clienta esto es
   * una sola salida y mandarla a pagar dos veces sería absurdo.
   */
  const totalDeposit = legs.reduce((total, leg) => total + leg.deposit, 0);
  const totalName = combinedServiceName(legs.map((leg) => leg.serviceName));

  /*
   * ¿Esta visita se cobra?
   *
   * `paymentPlanFor` mira las tres condiciones juntas —interruptor encendido,
   * token cargado en el servidor y seña cargada en lo elegido— y nunca lanza:
   * ante cualquier duda contesta que no se cobra. Por eso no hace falta
   * envolver nada en try/catch acá: con Mercado Pago apagado, mal configurado o
   * caído, la reserva sigue por el camino de siempre.
   */
  const plan = await paymentPlanFor({ depositAmount: totalDeposit }, settings);

  const now = Math.floor(Date.now() / 1000);

  /*
   * ¿Y por dónde se cobra?
   *
   * La clienta eligió en el formulario, pero lo que llega del navegador es una
   * intención y no una autorización: se vuelve a comprobar contra la
   * configuración de ahora. Un campo manipulado, o una transferencia que se
   * apagó en Ajustes mientras la pantalla estaba abierta, no puede meter un
   * turno por un camino que el negocio no tiene habilitado.
   *
   * `assignTransferAmount` puede devolver null si no quedan centavos libres
   * (ver `transfer.ts`). En ese caso no se inventa un importe ambiguo: se cae
   * al camino de Mercado Pago, o al de sin cobro si tampoco está.
   */
  const wantsTransfer = String(formData.get("paymentMethod") ?? "") === "transfer";

  const transferAmount =
    wantsTransfer &&
    (await transferAvailableFor({ depositAmount: totalDeposit }, settings))
      ? await assignTransferAmount(depositFor({ depositAmount: totalDeposit }), now)
      : null;

  const byTransfer = transferAmount !== null;

  const holdExpiresAt = byTransfer
    ? now + transferHoldMinutes(settings) * 60
    : plan.charge
      ? now + plan.holdMinutes * 60
      : null;

  const depositAmount = byTransfer
    ? depositFor({ depositAmount: totalDeposit })
    : plan.charge
      ? plan.amount
      : null;

  /** Retiene el horario todo lo que no se confirme en el acto. */
  const isPreBooking = byTransfer || plan.charge;

  /** La marca que dice que estos tramos se sacaron juntos. Uno solo no la lleva. */
  const bookingGroup = legs.length > 1 ? generateGroupId() : null;

  const created: {
    id: number;
    token: string;
    leg: (typeof legs)[number];
  }[] = [];
  const lost: (typeof legs)[number][] = [];

  for (const leg of legs) {
    // Las pre-reservas vencidas de ese día se dan de baja antes de intentar el
    // alta: el índice único cuenta a las 'pending_payment', así que una que quedó
    // a medias bloquearía el horario aunque su retención ya no valga.
    await releaseExpiredHolds(leg.professional.id, date, now);

    const { token, hash } = generateCancelToken();

    /*
     * La condición `NOT EXISTS` compara el rango pedido contra los turnos que
     * retienen el horario —confirmados y pre-reservas todavía vigentes—: hay
     * choque si el nuevo empieza antes de que termine el otro y termina después
     * de que el otro empieza. Si algo se solapa, el SELECT no devuelve filas y el
     * INSERT no inserta nada.
     */
    let appointmentId: number | null = null;
    try {
      const result = await client.execute({
        sql: `INSERT INTO appointments
                (professional_id, service_id, service_name, date, start_minute,
                 end_minute, status, first_name, last_name, dni, email, phone,
                 cancel_token_hash, hold_expires_at, booking_group, created_at)
              SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch()
              WHERE NOT EXISTS (
                SELECT 1 FROM appointments
                 WHERE professional_id = ? AND date = ?
                   AND (status = 'booked'
                        OR (status = 'pending_payment' AND hold_expires_at > ?))
                   AND start_minute < ? AND end_minute > ?
              )
              RETURNING id`,
        args: [
          leg.professional.id,
          leg.serviceId,
          leg.serviceName,
          date,
          leg.startMinute,
          leg.startMinute + leg.duration,
          isPreBooking ? "pending_payment" : "booked",
          value.firstName,
          value.lastName,
          value.dni,
          value.email,
          value.phone,
          hash,
          // La retención va en todos los tramos: mientras se paga, ninguno de
          // los horarios de la visita puede aparecer libre.
          holdExpiresAt,
          bookingGroup,
          leg.professional.id,
          date,
          now,
          leg.startMinute + leg.duration,
          leg.startMinute,
        ],
      });

      appointmentId = result.rows.length > 0 ? Number(result.rows[0].id) : null;
    } catch {
      // Salta si el índice único parcial rechazó la inserción.
      appointmentId = null;
    }

    if (appointmentId === null) {
      lost.push(leg);
      continue;
    }

    created.push({ id: appointmentId, token, leg });
  }

  if (created.length === 0) {
    return fail(
      "Ese horario acaba de ser reservado por otra persona. Elegí otro, por favor.",
    );
  }

  /*
   * El turno que lleva la seña: el primero que se pudo guardar.
   *
   * Los datos del cobro se anotan después del alta y no dentro, porque hasta
   * acá no se sabe cuál de los tramos sobrevivió a la carrera por el horario.
   * Es también el turno cuyo link se le da a la clienta, y desde el que se ve
   * la visita entera.
   */
  const head = created[0];
  const token = head.token;

  if (isPreBooking) {
    await db
      .update(appointments)
      .set({
        depositAmount,
        paymentMethod: byTransfer ? "transfer" : "mercadopago",
        transferAmount,
      })
      .where(eq(appointments.id, head.id));
  }

  /** Se perdió algún tramo en la carrera: la pantalla del turno lo avisa. */
  const partial = lost.length > 0;

  /*
   * Camino de la transferencia: no hay a dónde mandarla, así que se va a la
   * pantalla de su turno, que es la que muestra el alias y el importe exacto.
   *
   * No se manda ningún aviso todavía. El turno no está confirmado —falta que
   * entre la plata— y anunciar por mail un turno que puede no concretarse es
   * exactamente la confusión que hay que evitar. Los avisos salen al
   * acreditarse, desde `confirmTransfer`.
   */
  if (byTransfer) {
    revalidatePath("/");
    revalidatePath("/admin");

    redirect(`/turno/${token}${partial ? "?parcial=1" : ""}`);
  }

  /*
   * Camino con cobro: se pide el link de pago y se manda a la clienta al
   * checkout. Los turnos quedan retenidos hasta que el pago se apruebe.
   *
   * Si Mercado Pago no contesta o rechaza la preferencia, las pre-reservas se
   * confirman igual y siguen por el camino de abajo, sin cobro. Es a propósito:
   * una seña que no se cobró se arregla cobrando en el local, pero una reserva
   * que no se pudo hacer es una clienta perdida. Queda el motivo en los logs.
   */
  if (plan.charge) {
    const checkout = await createDepositCheckout(
      {
        id: head.id,
        email: value.email,
        serviceName: totalName,
        amount: plan.amount,
        token,
      },
      settings,
    );

    if (checkout.ok) {
      await db
        .update(appointments)
        .set({
          mpPreferenceId: checkout.data.preferenceId,
          mpCheckoutUrl: checkout.data.url,
        })
        .where(eq(appointments.id, head.id));

      revalidatePath("/");
      revalidatePath("/admin");

      redirect(checkout.data.url);
    }

    console.warn(
      "[pagos] no se pudo abrir el checkout; el turno se confirma sin cobrar:",
      checkout.reason,
    );

    await db
      .update(appointments)
      .set({
        status: "booked",
        depositAmount: null,
        holdExpiresAt: null,
      })
      .where(
        inArray(
          appointments.id,
          created.map((item) => item.id),
        ),
      );
  }

  /*
   * El mail a la clienta y el aviso a cada profesional. Ninguno de los dos
   * puede invalidar la reserva: ya está guardada y la clienta ve el link en la
   * pantalla siguiente. Lo que falle queda anotado en los logs del servidor,
   * que es lo único que explica después un mail que no llegó.
   *
   * A la clienta le llega UN mail por visita, con el link que muestra todos los
   * tramos. A cada profesional, el aviso del tramo que le toca a ella: lo que
   * necesita saber es su propia agenda.
   */
  await announceNewBooking({
    appointmentId: head.id,
    appointment: {
      professionalId: head.leg.professional.id,
      date,
      startMinute: head.leg.startMinute,
      endMinute: head.leg.startMinute + head.leg.duration,
      serviceName: head.leg.serviceName,
      firstName: value.firstName,
      lastName: value.lastName,
      dni: value.dni,
      email: value.email,
      phone: value.phone,
    },
    professionalName: head.leg.professional.name,
    token,
  });

  for (const item of created.slice(1)) {
    await notifyProfessionalNewBooking({
      professionalId: item.leg.professional.id,
      date,
      startMinute: item.leg.startMinute,
      endMinute: item.leg.startMinute + item.leg.duration,
      serviceName: item.leg.serviceName,
      firstName: value.firstName,
      lastName: value.lastName,
      dni: value.dni,
      email: value.email,
      phone: value.phone,
    });
  }

  revalidatePath("/");
  revalidatePath("/admin");

  redirect(`/turno/${token}?nuevo=1${partial ? "&parcial=1" : ""}`);
}

/**
 * Cancela un turno con el token del link.
 *
 * No borra la fila: cambia el estado. El horario se libera igual, porque el
 * índice y el cálculo de disponibilidad solo miran los turnos 'booked'. Así
 * queda registro de la cancelación para el panel.
 */
export async function cancelBooking(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const token = String(formData.get("token") ?? "");
  if (!looksLikeToken(token)) {
    return { ok: false, message: "El link de cancelación no es válido." };
  }

  const limit = await checkRateLimit(await clientKey("cancel"), 20, 600);
  if (!limit.allowed) {
    return { ok: false, message: "Demasiados intentos. Probá en unos minutos." };
  }

  const [owner] = await db
    .select()
    .from(appointments)
    .where(eq(appointments.cancelTokenHash, hashToken(token)))
    .limit(1);

  if (!owner) {
    return { ok: false, message: "No encontramos ese turno." };
  }

  /*
   * Qué tramo se cancela.
   *
   * Con una visita repartida entre profesionales, la clienta tiene un solo link
   * —el del primer tramo— y desde ahí ve todos. Por eso el formulario puede
   * pedir cancelar otro tramo por id.
   *
   * Ese id no da acceso a nada por sí solo: tiene que ser de la MISMA visita
   * que el token, así que con un link ajeno no se llega a ningún lado. Es la
   * misma regla de siempre —solo se toca lo propio— extendida al grupo.
   */
  const targetId = Number(formData.get("appointmentId") ?? "");

  const appointment =
    Number.isInteger(targetId) && targetId > 0 && targetId !== owner.id
      ? (
          await db
            .select()
            .from(appointments)
            .where(eq(appointments.id, targetId))
            .limit(1)
        )[0]
      : owner;

  if (
    !appointment ||
    (appointment.id !== owner.id &&
      (owner.bookingGroup === null ||
        appointment.bookingGroup !== owner.bookingGroup))
  ) {
    return { ok: false, message: "No encontramos ese turno." };
  }

  /*
   * Una pre-reserva sin pagar también se puede soltar desde acá: quien se
   * arrepintió en el checkout no tiene por qué esperar a que venza el plazo
   * para liberar el horario.
   */
  const wasConfirmed = appointment.status === "booked";
  const isPending = appointment.status === "pending_payment";

  if (!wasConfirmed && !isPending) {
    return {
      ok: false,
      message:
        appointment.status === "expired_payment"
          ? "Esta reserva venció sin pagarse. Sacá un turno nuevo cuando quieras."
          : "Este turno ya estaba cancelado.",
    };
  }

  const settings = await getSettings();
  const cutoffHours = settingInt(settings, "cancel_cutoff_hours");
  const remaining = minutesUntil(
    appointment.date,
    appointment.startMinute,
    settings.timezone,
  );

  if (remaining < 0) {
    return { ok: false, message: "Este turno ya pasó." };
  }

  if (cutoffHours > 0 && remaining < cutoffHours * 60) {
    return {
      ok: false,
      message: `Los turnos se pueden cancelar hasta ${cutoffHours} ${
        cutoffHours === 1 ? "hora" : "horas"
      } antes. Comunicate con nosotros para reprogramarlo.`,
    };
  }

  await db
    .update(appointments)
    .set({
      status: "cancelled_by_client",
      cancelledAt: Math.floor(Date.now() / 1000),
      // La retención deja de tener sentido: el horario queda libre ya mismo.
      holdExpiresAt: null,
    })
    .where(
      and(
        eq(appointments.id, appointment.id),
        inArray(appointments.status, ["booked", "pending_payment"]),
      ),
    );

  /*
   * Soltar una pre-reserva suelta la visita entera.
   *
   * Los tramos de una visita repartida retienen el horario con una sola seña,
   * la del primero. Quien se arrepiente en el checkout no está soltando un
   * tramo sino la visita: dejar el otro retenido hasta que venza el plazo sería
   * bloquear una agenda por algo que ya nadie va a pagar.
   *
   * Con los turnos CONFIRMADOS no pasa esto: ahí cada tramo se cancela solo, que
   * es lo que la clienta espera al elegir cancelar uno.
   */
  if (isPending && appointment.bookingGroup) {
    await db
      .update(appointments)
      .set({
        status: "cancelled_by_client",
        cancelledAt: Math.floor(Date.now() / 1000),
        holdExpiresAt: null,
      })
      .where(
        and(
          eq(appointments.bookingGroup, appointment.bookingGroup),
          ne(appointments.id, appointment.id),
          eq(appointments.status, "pending_payment"),
        ),
      )
      .catch(() => undefined);
  }

  // Los avisos son solo para los turnos que llegaron a confirmarse. De una
  // pre-reserva sin pagar nunca se anunció nada: mandar ahora la cancelación de
  // algo que la clienta no sabe que existía solo genera confusión.
  if (wasConfirmed) {
    await sendCancellationConfirmation({
      to: appointment.email,
      firstName: appointment.firstName,
      date: appointment.date,
      startMinute: appointment.startMinute,
    }).catch(() => undefined);

    await notifyProfessionalCancellation(appointment, "client");
  }

  revalidatePath("/");
  revalidatePath(`/turno/${token}`);
  revalidatePath("/admin");

  const when = `del ${formatDateLong(appointment.date)} a las ${formatMinute(appointment.startMinute)}`;

  return {
    ok: true,
    message: wasConfirmed
      ? `Cancelamos tu turno ${when}.`
      : `Soltamos la reserva ${when}. No se te cobró nada.`,
  };
}

/**
 * Búsqueda de turno por DNI + email, para quien perdió el link.
 *
 * Cada búsqueda exitosa genera un token nuevo y descarta el anterior. Dos
 * ventajas: se puede armar el link sin haber guardado nunca el token en claro,
 * y un link viejo que haya quedado dando vueltas deja de funcionar.
 *
 * El mensaje de error es siempre el mismo, exista o no el turno, para que la
 * pantalla no sirva para averiguar si una persona es clienta del local.
 */
export async function lookupBooking(
  _prev: LookupState,
  formData: FormData,
): Promise<LookupState> {
  const settings = await getSettings();

  if (!settingBool(settings, "allow_client_lookup")) {
    return {
      message: "La búsqueda por DNI no está habilitada. Usá el link que recibiste al reservar.",
      results: [],
    };
  }

  const limit = await checkRateLimit(await clientKey("lookup"), 6, 900);
  if (!limit.allowed) {
    return {
      message: "Demasiadas búsquedas seguidas. Esperá unos minutos.",
      results: [],
    };
  }

  const dni = normalizeDni(String(formData.get("dni") ?? ""));
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  const notFound: LookupState = {
    message:
      "No encontramos turnos activos con esos datos. Revisá que el DNI y el email sean los mismos que usaste al reservar.",
    results: [],
  };

  if (!dni || !email) return notFound;

  const today = nowInTz(settings.timezone).date;

  const rows = await db
    .select({
      id: appointments.id,
      date: appointments.date,
      startMinute: appointments.startMinute,
      serviceName: appointments.serviceName,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(
      and(
        eq(appointments.dni, dni),
        eq(appointments.email, email),
        eq(appointments.status, "booked"),
        gte(appointments.date, today),
      ),
    );

  if (rows.length === 0) return notFound;

  const results: LookupResult[] = [];
  for (const row of rows) {
    const { token, hash } = generateCancelToken();
    await db
      .update(appointments)
      .set({ cancelTokenHash: hash })
      .where(eq(appointments.id, row.id));

    results.push({
      token,
      date: row.date,
      startMinute: row.startMinute,
      professionalName: row.professionalName,
      serviceName: row.serviceName,
    });
  }

  results.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute,
  );

  return { message: null, results };
}
