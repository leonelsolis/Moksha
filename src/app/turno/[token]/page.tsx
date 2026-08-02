import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ManageAppointment } from "@/components/public/ManageAppointment";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { db } from "@/db";
import { appointments, professionals } from "@/db/schema";
import { formatDateLong, formatMinute, minutesUntil } from "@/lib/dates";
import { getSettings, settingInt } from "@/lib/settings";
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
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Tu turno", robots: { index: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ nuevo?: string }>;
};

export default async function AppointmentPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { nuevo } = await searchParams;

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

  const isBooked = appointment.status === "booked";
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

  return (
    <>
      <SiteHeader settings={settings} />

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6 sm:py-10">
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
                Te esperamos. Si no vas a poder venir, avisanos desde esta misma
                página.
              </p>
            </div>
          </div>
        ) : (
          <h1 className="mb-5 text-xl font-semibold tracking-tight sm:text-2xl">
            Tu turno
          </h1>
        )}

        {!isBooked ? (
          <div className="mb-5">
            <Alert tone="info" title="Este turno está cancelado">
              {appointment.status === "cancelled_by_admin"
                ? "Lo cancelamos desde el local. Si necesitás reprogramarlo, escribinos."
                : "Vos cancelaste este turno. Cuando quieras podés sacar uno nuevo."}
            </Alert>
          </div>
        ) : null}

        <section className={`panel p-4 sm:p-5 ${!isBooked ? "opacity-70" : ""}`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
            <dt className="flex items-center gap-1.5 text-ink-muted">
              <Icon name="calendar" className="size-4" />
              Día
            </dt>
            <dd className="font-medium">
              {capitalize(formatDateLong(appointment.date, true))}
            </dd>

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
                <span className="text-ink-muted"> · {row.professionalSpecialty}</span>
              ) : null}
            </dd>

            {appointment.serviceName ? (
              <>
                <dt className="text-ink-muted">Servicio</dt>
                <dd>{appointment.serviceName}</dd>
              </>
            ) : null}

            <dt className="text-ink-muted">A nombre de</dt>
            <dd>
              {appointment.firstName} {appointment.lastName}
            </dd>
          </dl>
        </section>

        {isBooked ? (
          <div className="mt-5">
            <ManageAppointment
              token={token}
              canCancel={canCancel}
              blockedReason={blockedReason}
            />
          </div>
        ) : (
          <div className="mt-5">
            <Link href="/" className="btn btn-primary">
              Sacar un turno nuevo
            </Link>
          </div>
        )}
      </main>

      <SiteFooter settings={settings} />
    </>
  );
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
