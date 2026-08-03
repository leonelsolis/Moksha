import { and, asc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";

import { Alert } from "@/components/Alert";
import { AppointmentActions } from "@/components/admin/AppointmentActions";
import { Icon } from "@/components/Icon";
import { db } from "@/db";
import { appointments, professionals } from "@/db/schema";
import { requireUser, scopeOf } from "@/lib/auth";
import {
  addDays,
  formatDateLong,
  formatMinute,
  isValidDateString,
  nowInTz,
} from "@/lib/dates";
import { holdIsAlive } from "@/lib/payments";
import { getSettings } from "@/lib/settings";

/**
 * Agenda de turnos.
 *
 * Los filtros viajan por la URL en lugar de guardarse en estado del navegador:
 * así una búsqueda concreta ("los turnos de Ana del viernes") se puede guardar
 * en favoritos o mandar por mensaje, y recargar la página no la pierde.
 *
 * El filtro por profesional es el único que no sale de la URL cuando quien
 * mira es una profesional: ahí lo fija el servidor con su propio id, así
 * escribir `?prof=` a mano no muestra la agenda de la otra.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Turnos" };

type Props = {
  searchParams: Promise<{
    desde?: string;
    hasta?: string;
    prof?: string;
    estado?: string;
  }>;
};

/** Qué decir de un turno que ya no ocupa su horario. */
function statusLabel(status: string) {
  if (status === "cancelled_by_admin") return "Cancelado por el local";
  if (status === "cancelled_by_client") return "Cancelado por el cliente";
  return "Seña no pagada";
}

export default async function AdminAppointmentsPage({ searchParams }: Props) {
  const account = await requireUser();
  const scope = scopeOf(account);

  const params = await searchParams;
  const settings = await getSettings();
  const today = nowInTz(settings.timezone).date;

  const from = isValidDateString(params.desde ?? "") ? params.desde! : today;
  const to = isValidDateString(params.hasta ?? "")
    ? params.hasta!
    : addDays(from, 30);

  // Para la administración el filtro es opcional (0 = todas). Para una
  // profesional no es un filtro sino su alcance, y no se puede quitar.
  const professionalFilter = scope ?? (Number(params.prof) || 0);
  const statusFilter = params.estado === "todos" ? "todos" : "booked";

  const staff = await db
    .select()
    .from(professionals)
    .orderBy(asc(professionals.sortOrder), asc(professionals.name));

  const conditions: (SQL | undefined)[] = [
    gte(appointments.date, from),
    lte(appointments.date, to),
  ];

  if (professionalFilter) {
    conditions.push(eq(appointments.professionalId, professionalFilter));
  }
  // "Solo activos" incluye las pre-reservas que están esperando el pago de la
  // seña: ocupan un horario de la agenda, así que tienen que verse.
  if (statusFilter === "booked") {
    conditions.push(
      inArray(appointments.status, ["booked", "pending_payment"]),
    );
  }

  const rows = await db
    .select({
      appointment: appointments,
      professionalName: professionals.name,
    })
    .from(appointments)
    .innerJoin(professionals, eq(appointments.professionalId, professionals.id))
    .where(and(...conditions))
    .orderBy(asc(appointments.date), asc(appointments.startMinute));

  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDate.get(row.appointment.date) ?? [];
    list.push(row);
    byDate.set(row.appointment.date, list);
  }

  const bookedCount = rows.filter((r) => r.appointment.status === "booked").length;

  const ownName =
    scope !== null ? staff.find((p) => p.id === scope)?.name : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {ownName ? `Turnos de ${ownName}` : "Turnos"}
          </h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {bookedCount === 0
              ? "No hay turnos reservados en este período."
              : `${bookedCount} ${bookedCount === 1 ? "turno reservado" : "turnos reservados"} en el período.`}
          </p>
        </div>
      </div>

      {scope !== null && !ownName ? (
        <Alert tone="warning" title="Tu cuenta no está vinculada a ninguna profesional">
          Por eso no aparece ningún turno. Pedile a la administración que vincule
          tu cuenta desde Usuarios.
        </Alert>
      ) : null}

      {/* Filtros: form GET, sin JavaScript de por medio. */}
      <form method="get" className="panel p-3 sm:p-4">
        <div
          className={`grid gap-3 sm:grid-cols-2 ${
            scope === null ? "lg:grid-cols-5" : "lg:grid-cols-4"
          }`}
        >
          <div>
            <label className="field-label" htmlFor="desde">
              Desde
            </label>
            <input
              id="desde"
              name="desde"
              type="date"
              defaultValue={from}
              className="input"
            />
          </div>

          <div>
            <label className="field-label" htmlFor="hasta">
              Hasta
            </label>
            <input
              id="hasta"
              name="hasta"
              type="date"
              defaultValue={to}
              className="input"
            />
          </div>

          {/* Una profesional no elige de quién ve los turnos: son los suyos. */}
          {scope === null ? (
            <div>
              <label className="field-label" htmlFor="prof">
                Profesional
              </label>
              <select
                id="prof"
                name="prof"
                defaultValue={String(professionalFilter || "")}
                className="input"
              >
                <option value="">Todas</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div>
            <label className="field-label" htmlFor="estado">
              Estado
            </label>
            <select
              id="estado"
              name="estado"
              defaultValue={statusFilter}
              className="input"
            >
              <option value="booked">Solo activos</option>
              <option value="todos">Incluir cancelados</option>
            </select>
          </div>

          <div className="flex items-end">
            <button type="submit" className="btn btn-secondary w-full">
              Aplicar filtros
            </button>
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-sm text-ink-soft">
            No hay turnos que coincidan con estos filtros.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...byDate.entries()].map(([date, items]) => (
            <section key={date}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-medium first-letter:uppercase">
                {formatDateLong(date, true)}
                {date === today ? (
                  <span className="badge border-accent-line bg-accent-soft text-accent">
                    Hoy
                  </span>
                ) : null}
              </h2>

              <ul className="space-y-2">
                {items.map(({ appointment, professionalName }) => {
                  const isBooked = appointment.status === "booked";
                  // La pre-reserva todavía retiene el horario: se muestra como
                  // un turno más, con el aviso de que falta la seña.
                  const isPending = holdIsAlive(appointment);
                  const isActive = isBooked || isPending;

                  return (
                    <li
                      key={appointment.id}
                      className={`panel p-3 sm:p-4 ${isActive ? "" : "bg-surface-sunken"}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span
                              className={`text-sm font-semibold tabular ${
                                isActive ? "" : "text-ink-muted line-through"
                              }`}
                            >
                              {formatMinute(appointment.startMinute)}–
                              {formatMinute(appointment.endMinute)}
                            </span>

                            <span className="text-sm text-ink-soft">
                              {professionalName}
                            </span>

                            {appointment.serviceName ? (
                              <span className="text-sm text-ink-muted">
                                {appointment.serviceName}
                              </span>
                            ) : null}

                            {isPending ? (
                              <span className="badge border-warning-line bg-warning-soft text-warning">
                                <Icon name="clock" className="size-3" />
                                Falta pagar la seña
                              </span>
                            ) : !isBooked ? (
                              <span className="badge border-line-strong bg-surface text-ink-muted">
                                <Icon name="slash" className="size-3" />
                                {statusLabel(appointment.status)}
                              </span>
                            ) : null}
                          </div>

                          <p
                            className={`mt-1.5 font-medium ${isActive ? "" : "text-ink-muted"}`}
                          >
                            {appointment.firstName} {appointment.lastName}
                          </p>

                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-ink-soft">
                            <span className="tabular">DNI {appointment.dni}</span>

                            <a
                              href={`mailto:${appointment.email}`}
                              className="underline-offset-4 hover:text-ink hover:underline"
                            >
                              {appointment.email}
                            </a>

                            {appointment.phone ? (
                              <a
                                href={`tel:${appointment.phone}`}
                                className="tabular underline-offset-4 hover:text-ink hover:underline"
                              >
                                {appointment.phone}
                              </a>
                            ) : null}
                          </div>
                        </div>

                        <AppointmentActions
                          id={appointment.id}
                          canCancel={isActive}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
