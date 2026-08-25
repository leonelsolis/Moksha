import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { LocationCard } from "@/components/public/LocationCard";
import { ManageAppointment } from "@/components/public/ManageAppointment";
import { PendingPayment } from "@/components/public/PendingPayment";
import { PendingTransfer } from "@/components/public/PendingTransfer";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { db } from "@/db";
import { appointments, professionals } from "@/db/schema";
import {
  formatDateLong,
  formatMinute,
  formatTimestamp,
  formatTimestampLong,
  minutesUntil,
} from "@/lib/dates";
import { groupLegs } from "@/lib/booking-group";
import { formatMoneyExact } from "@/lib/money";
import { formatMoney, holdIsAlive, isPaidButLost } from "@/lib/payments";
import { getSettings, settingInt } from "@/lib/settings";
import { transferConfig } from "@/lib/transfer";
import { hashToken, looksLikeToken } from "@/lib/tokens";

/**
 * Turno del cliente: confirmación al reservar y pantalla de cancelación.
 *
 * Es una sola página para las dos cosas. Al confirmar se llega con ?nuevo=1 y
 * se muestra el mensaje de éxito; después, el mismo link sirve para consultar
 * o cancelar.
 *
 * El acceso es únicamente por token. Nunca se acepta un id de turno en la URL:
 * con ids correlativos, cambiar un número mostraría los datos de otra persona.
 *
 * Al costado va el mapa con la dirección del local, mientras el turno siga en
 * pie. Si en Ajustes no hay dirección cargada, no hay columna al costado y la
 * página se ve igual que antes.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Tu turno", robots: { index: false } };

type Props = {
  params: Promise<{ token: string }>;
  /**
   * `pago` lo agrega Mercado Pago al volver del checkout. `parcial` lo agrega
   * la reserva cuando uno de los tramos de la visita se perdió en la carrera
   * por el horario.
   */
  searchParams: Promise<{ nuevo?: string; pago?: string; parcial?: string }>;
};

export default async function AppointmentPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { nuevo, pago, parcial } = await searchParams;

  if (!looksLikeToken(token)) notFound();

  const [row] = await db
    .select({
      appointment: appointments,
      professionalName: professionals.name,
      professionalSpecialty: professionals.specialty,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(eq(appointments.cancelTokenHash, hashToken(token)))
    .limit(1);

  if (!row) notFound();

  const { appointment } = row;
  const settings = await getSettings();

  /*
   * Los tramos de la visita, cuando se repartió entre profesionales.
   *
   * La clienta tiene un solo link y espera ver todo lo que sacó, así que la
   * pantalla muestra la visita entera aunque cada tramo sea un turno aparte.
   * Vacío —lo normal— significa un único turno y todo lo de abajo se comporta
   * como siempre.
   */
  const legs = await groupLegs(appointment.bookingGroup);
  const shared = legs.length > 1;

  const isBooked = appointment.status === "booked";
  /** Pre-reserva viva: falta pagar la seña y el horario sigue retenido. */
  const isPending = holdIsAlive(appointment);
  /**
   * Entró la seña pero el turno no quedó: la retención se venció antes de que
   * se acreditara el pago y el horario ya lo había tomado otra persona. Hay que
   * devolver la plata a mano, así que se dice claramente en pantalla en vez de
   * mostrarlo como una reserva vencida cualquiera.
   */
  const isPaidWithoutSlot = isPaidButLost(appointment);

  /** Se venció el plazo de pago, con o sin la fila ya marcada. */
  const isExpired =
    !isPaidWithoutSlot &&
    (appointment.status === "expired_payment" ||
      (appointment.status === "pending_payment" && !isPending));

  const cutoffHours = settingInt(settings, "cancel_cutoff_hours");
  const remainingMinutes = minutesUntil(
    appointment.date,
    appointment.startMinute,
    settings.timezone,
  );

  const hasPassed = remainingMinutes < 0;
  const withinCutoff = cutoffHours > 0 && remainingMinutes < cutoffHours * 60;

  const canCancel = isBooked && !hasPassed && !withinCutoff;

  let blockedReason: string | null = null;
  if (isBooked && hasPassed) {
    blockedReason = "Este turno ya pasó.";
  } else if (isBooked && withinCutoff) {
    blockedReason = `Los turnos se pueden cancelar hasta ${cutoffHours} ${
      cutoffHours === 1 ? "hora" : "horas"
    } antes. Comunicate con nosotros para reprogramarlo.`;
  }

  const isNew = nuevo === "1" && isBooked;

  /**
   * Un tramo de la visita se perdió: alguien tomó ese horario entre que la
   * clienta lo eligió y confirmó. Lo que sí se pudo guardar quedó guardado, y
   * eso es lo que hay que decir sin vueltas.
   */
  const isPartial = parcial === "1" && shared;

  /*
   * Qué tramos siguen en pie y se pueden cancelar.
   *
   * Con un solo turno esto es el de siempre. Con una visita repartida, cada
   * tramo se cancela por su cuenta: cancelar las manos no cancela los pies.
   */
  const activeLegs = legs.filter((leg) => leg.appointment.status === "booked");
  const linkLegId = activeLegs[0]?.appointment.id ?? null;

  /*
   * Los datos de la cuenta se leen siempre, no solo cuando hacen falta: son
   * cuatro campos de una tabla que ya está cargada, y así la condición de
   * abajo queda en una línea legible.
   */
  const transfer = transferConfig(settings);
  const isAwaitingTransfer =
    isPending && appointment.paymentMethod === "transfer";

  /**
   * Seña efectivamente cobrada. Solo con plata adentro tiene sentido avisar que
   * no se devuelve: en un turno sin cobro online la advertencia sería sobre
   * algo que nunca se pagó.
   */
  const depositPaid =
    isBooked && appointment.paidAt !== null && (appointment.depositAmount ?? 0) > 0;

  // El mapa solo tiene sentido si hay a dónde ir: con el turno en pie y con una
  // dirección cargada en Ajustes.
  const address = settings.contact_address.trim();
  const showMap = (isBooked || activeLegs.length > 0) && address !== "";

  // La pre-reserva no está cancelada: el horario sigue guardado. Se muestra con
  // los datos a la vista, igual que un turno confirmado.
  // En una visita repartida, que el tramo del link esté cancelado no significa
  // que la visita lo esté: puede seguir en pie el otro. El cartel sale recién
  // cuando no queda ninguno.
  const isCancelled =
    !isBooked &&
    !isPending &&
    !isExpired &&
    !isPaidWithoutSlot &&
    activeLegs.length === 0;

  return (
    <>
      <SiteHeader settings={settings} />

      <main
        className={`mx-auto w-full flex-1 px-4 py-6 sm:py-10 ${
          showMap ? "max-w-4xl" : "max-w-xl"
        }`}
      >
        {/* En el celular el mapa queda al final, después de todo lo del turno:
            primero lo que la clienta vino a ver, después cómo llegar. */}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1">
            {isNew ? (
              <div className="mb-6 flex items-start gap-3 rounded-md border border-accent-line bg-accent-soft p-4">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                  <Icon name="check" className="size-3.5" />
                </span>
                <div>
                  <h1 className="text-lg font-semibold text-accent">
                    Listo, tu turno quedó confirmado
                  </h1>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    Te esperamos. Si no vas a poder venir, avisanos desde esta
                    misma página.
                  </p>
                </div>
              </div>
            ) : (
              <h1 className="mb-5 text-xl font-semibold tracking-tight sm:text-2xl">
                {isPending ? "Tu reserva" : "Tu turno"}
              </h1>
            )}

            {isPartial ? (
              <div className="mb-5">
                <Alert tone="warning" title="Uno de los turnos no se pudo guardar">
                  Alguien tomó ese horario justo mientras confirmabas. Lo que ves
                  acá abajo sí quedó reservado; por lo que falta, sacá otro turno
                  o escribinos y lo acomodamos.
                </Alert>
              </div>
            ) : null}

            {isPending ? (
              <div className="mb-5">
                <Alert tone="warning" title="Falta pagar la seña">
                  Te guardamos el horario, pero el turno queda confirmado recién
                  cuando se acredite el pago.
                </Alert>
              </div>
            ) : null}

            {isPaidWithoutSlot ? (
              <div className="mb-5">
                <Alert tone="warning" title="Recibimos tu pago, pero el horario ya no estaba">
                  La seña entró después de que se venciera la reserva, y para
                  entonces otra persona había tomado ese horario. Escribinos y te
                  devolvemos la seña o te lo pasamos a otro día: lo que prefieras.
                </Alert>
              </div>
            ) : null}

            {isExpired ? (
              <div className="mb-5">
                <Alert tone="info" title="Esta reserva venció">
                  No llegamos a recibir el pago de la seña, así que el horario
                  volvió a quedar disponible. No se te cobró nada.
                </Alert>
              </div>
            ) : null}

            {isCancelled ? (
              <div className="mb-5">
                <Alert tone="info" title="Este turno está cancelado">
                  {appointment.status === "cancelled_by_admin"
                    ? "Lo cancelamos desde el local. Si necesitás reprogramarlo, escribinos."
                    : "Vos cancelaste este turno. Cuando quieras podés sacar uno nuevo."}
                </Alert>
              </div>
            ) : null}

            <section
              className={`panel p-4 sm:p-5 ${
                isBooked || isPending || activeLegs.length > 0 ? "" : "opacity-70"
              }`}
            >
              <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
                <dt className="flex items-center gap-1.5 text-ink-muted">
                  <Icon name="calendar" className="size-4" />
                  Día
                </dt>
                <dd className="font-medium">
                  {capitalize(formatDateLong(appointment.date, true))}
                </dd>

                {shared ? (
                  /*
                    Una visita repartida se lee como una secuencia: primero
                    esto con una, después aquello con la otra. Por eso los
                    tramos van en una sola fila de la ficha y en orden, en vez
                    de repetir "Hora / Atiende / Servicio" dos veces.
                  */
                  <>
                    <dt className="flex items-center gap-1.5 text-ink-muted">
                      <Icon name="clock" className="size-4" />
                      La visita
                    </dt>
                    <dd className="space-y-2">
                      {legs.map(({ appointment: leg, professionalName }) => (
                        <div key={leg.id}>
                          <span className="font-medium tabular">
                            {formatMinute(leg.startMinute)} a{" "}
                            {formatMinute(leg.endMinute)}
                          </span>
                          <span className="text-ink-muted"> · </span>
                          <span>{leg.serviceName || "Turno"}</span>
                          <span className="block text-ink-soft">
                            con {professionalName}
                            {leg.status === "booked" ||
                            leg.status === "pending_payment" ? null : (
                              <span className="text-ink-muted">
                                {" "}
                                · {legStatusLabel(leg.status)}
                              </span>
                            )}
                          </span>
                        </div>
                      ))}
                    </dd>
                  </>
                ) : (
                  <>
                    <dt className="flex items-center gap-1.5 text-ink-muted">
                      <Icon name="clock" className="size-4" />
                      Hora
                    </dt>
                    <dd className="font-medium tabular">
                      {formatMinute(appointment.startMinute)} a{" "}
                      {formatMinute(appointment.endMinute)}
                    </dd>

                    <dt className="flex items-center gap-1.5 text-ink-muted">
                      <Icon name="user" className="size-4" />
                      Atiende
                    </dt>
                    <dd>
                      {row.professionalName}
                      {row.professionalSpecialty ? (
                        <span className="text-ink-muted">
                          {" "}
                          · {row.professionalSpecialty}
                        </span>
                      ) : null}
                    </dd>

                    {appointment.serviceName ? (
                      <>
                        <dt className="text-ink-muted">Servicio</dt>
                        <dd>{appointment.serviceName}</dd>
                      </>
                    ) : null}
                  </>
                )}

                <dt className="text-ink-muted">A nombre de</dt>
                <dd>
                  {appointment.firstName} {appointment.lastName}
                </dd>

                {(isPending || depositPaid) && appointment.depositAmount ? (
                  <>
                    <dt className="text-ink-muted">
                      {depositPaid ? "Seña pagada" : "Seña"}
                    </dt>
                    <dd className="font-medium tabular">
                      {formatMoney(appointment.depositAmount)}
                    </dd>
                  </>
                ) : null}
              </dl>

              {/* Va acá, pegado al importe, y no en el cartel verde de recién
                  reservado: el aviso tiene que seguir estando cada vez que se
                  abra el link, que es cuando se piensa en cancelar. */}
              {depositPaid ? (
                <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
                  En caso de cancelación no se reembolsa la seña.
                </p>
              ) : null}
            </section>

            {isPending ? (
              <div className="mt-5 space-y-4">
                {/*
                  Los dos caminos de una pre-reserva. La diferencia no es
                  cosmética: en Mercado Pago el botón lleva al checkout y la
                  confirmación llega sola; en una transferencia lo único que se
                  puede hacer desde acá es mostrar a dónde transferir y cuánto
                  exacto.
                */}
                {isAwaitingTransfer ? (
                  <PendingTransfer
                    token={token}
                    amount={formatMoneyExact(appointment.transferAmount ?? 0)}
                    alias={transfer.alias}
                    cbu={transfer.cbu}
                    holder={transfer.holder}
                    bank={transfer.bank}
                    holdUntil={formatTimestampLong(
                      appointment.holdExpiresAt ?? 0,
                      settings.timezone,
                    )}
                    declared={appointment.transferDeclaredAt !== null}
                  />
                ) : (
                  <PendingPayment
                    token={token}
                    amount={formatMoney(appointment.depositAmount ?? 0)}
                    holdUntil={formatTimestamp(
                      appointment.holdExpiresAt ?? 0,
                      settings.timezone,
                    )}
                    awaitingApproval={pago === "ok" || pago === "pendiente"}
                  />
                )}

                <ManageAppointment
                  token={token}
                  canCancel
                  blockedReason={null}
                />
              </div>
            ) : shared && activeLegs.length > 0 ? (
              /*
                Un botón por tramo: la clienta puede querer soltar el de una
                profesional y quedarse con el de la otra. El link a la visita se
                muestra una sola vez, en el primero que siga en pie.
              */
              <div className="mt-5 space-y-4">
                {activeLegs.map(({ appointment: leg, professionalName }) => {
                  const left = minutesUntil(
                    leg.date,
                    leg.startMinute,
                    settings.timezone,
                  );
                  const legPassed = left < 0;
                  const legWithinCutoff =
                    cutoffHours > 0 && left < cutoffHours * 60;

                  return (
                    <ManageAppointment
                      key={leg.id}
                      token={token}
                      appointmentId={leg.id}
                      showLink={leg.id === linkLegId}
                      canCancel={!legPassed && !legWithinCutoff}
                      blockedReason={
                        legPassed
                          ? "Este turno ya pasó."
                          : legWithinCutoff
                            ? `Los turnos se pueden cancelar hasta ${cutoffHours} ${
                                cutoffHours === 1 ? "hora" : "horas"
                              } antes. Comunicate con nosotros para reprogramarlo.`
                            : null
                      }
                      depositPaid={depositPaid && leg.id === appointment.id}
                      cancelLabel={`Cancelar el turno con ${professionalName}`}
                    />
                  );
                })}
              </div>
            ) : isBooked ? (
              <div className="mt-5">
                <ManageAppointment
                  token={token}
                  canCancel={canCancel}
                  blockedReason={blockedReason}
                  depositPaid={depositPaid}
                />
              </div>
            ) : (
              <div className="mt-5">
                <Link href="/" className="btn btn-primary">
                  Sacar un turno nuevo
                </Link>
              </div>
            )}
          </div>

          {showMap ? (
            <div className="lg:sticky lg:top-6 lg:w-72 lg:shrink-0">
              <LocationCard
                address={address}
                businessName={settings.business_name}
              />
            </div>
          ) : null}
        </div>
      </main>

      <SiteFooter settings={settings} />
    </>
  );
}

/** Cómo se lee el estado de un tramo que ya no está en pie. */
function legStatusLabel(status: string) {
  if (status === "expired_payment") return "reserva vencida";
  if (status === "cancelled_by_admin") return "cancelado por el local";
  return "cancelado";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
