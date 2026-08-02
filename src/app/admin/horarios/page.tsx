import Link from "next/link";
import { asc, eq, gte, and } from "drizzle-orm";

import {
  addOverride,
  addWorkingHour,
  copyWorkingDay,
  deleteOverride,
  deleteWorkingHour,
} from "@/app/actions/admin";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import { db } from "@/db";
import { professionals, scheduleOverrides, workingHours } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import {
  WEEKDAY_NAMES,
  WEEKDAY_ORDER,
  formatDateLong,
  formatMinute,
  nowInTz,
} from "@/lib/dates";
import { getSettings } from "@/lib/settings";

/**
 * Horarios de atención de cada profesional.
 *
 * Dos niveles, a propósito:
 *   · El horario semanal es lo que se repite todas las semanas. Se carga una
 *     vez y no se toca más.
 *   · Las excepciones son para fechas puntuales (un feriado, un día que se
 *     abre distinto) y pisan al horario semanal solo ese día.
 *
 * Sin esa separación, un feriado obligaría a borrar el horario del día y a
 * volver a cargarlo después.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Horarios" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ prof?: string }>;
}) {
  await requireOwner();

  const params = await searchParams;
  const settings = await getSettings();
  const today = nowInTz(settings.timezone).date;

  const staff = await db
    .select()
    .from(professionals)
    .orderBy(asc(professionals.sortOrder), asc(professionals.name));

  if (staff.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Horarios</h1>
        <Alert tone="info" title="Todavía no hay profesionales">
          Primero cargá al menos una profesional en{" "}
          <Link href="/admin/profesionales" className="underline underline-offset-4">
            Profesionales
          </Link>
          , después definí sus horarios acá.
        </Alert>
      </div>
    );
  }

  const selectedId = Number(params.prof) || staff[0].id;
  const selected = staff.find((p) => p.id === selectedId) ?? staff[0];

  const [hours, overrides] = await Promise.all([
    db
      .select()
      .from(workingHours)
      .where(eq(workingHours.professionalId, selected.id))
      .orderBy(asc(workingHours.startMinute)),
    db
      .select()
      .from(scheduleOverrides)
      .where(
        and(
          eq(scheduleOverrides.professionalId, selected.id),
          gte(scheduleOverrides.date, today),
        ),
      )
      .orderBy(asc(scheduleOverrides.date)),
  ]);

  const byWeekday = new Map<number, typeof hours>();
  for (const row of hours) {
    const list = byWeekday.get(row.weekday) ?? [];
    list.push(row);
    byWeekday.set(row.weekday, list);
  }

  const daysWithHours = WEEKDAY_ORDER.filter(
    (day) => (byWeekday.get(day)?.length ?? 0) > 0,
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Horarios</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          Definí en qué días y a qué horas atiende cada profesional.
        </p>
      </div>

      {/* Selector de profesional */}
      <div className="flex flex-wrap gap-1.5">
        {staff.map((person) => (
          <Link
            key={person.id}
            href={`/admin/horarios?prof=${person.id}`}
            aria-current={person.id === selected.id ? "page" : undefined}
            className={`rounded-sm border px-3 py-1.5 text-sm transition-colors ${
              person.id === selected.id
                ? "border-accent bg-accent text-white"
                : "border-line-strong bg-surface text-ink-soft hover:bg-surface-sunken"
            }`}
          >
            {person.name}
            {!person.active ? " (inactiva)" : ""}
          </Link>
        ))}
      </div>

      {/* ── Horario semanal ──────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Horario de todas las semanas</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Podés cargar más de una franja por día, por ejemplo mañana y tarde.
          </p>
        </div>

        <ul className="divide-y divide-line">
          {WEEKDAY_ORDER.map((weekday) => {
            const dayHours = byWeekday.get(weekday) ?? [];

            return (
              <li key={weekday} className="px-4 py-3">
                {/* Apilado hasta pantallas grandes: en una sola fila, el
                    formulario para agregar se come el espacio de las franjas
                    ya cargadas y se terminan encimando. */}
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
                  <span className="w-24 shrink-0 text-sm font-medium capitalize lg:pt-1.5">
                    {WEEKDAY_NAMES[weekday]}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {dayHours.length === 0 ? (
                      <span className="text-sm text-ink-muted lg:pt-1.5">
                        No atiende
                      </span>
                    ) : (
                      dayHours.map((row) => (
                        <span
                          key={row.id}
                          className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border border-line-strong bg-surface-sunken py-1 pl-2.5 pr-1 text-sm tabular"
                        >
                          {formatMinute(row.startMinute)}–{formatMinute(row.endMinute)}

                          <ActionForm action={deleteWorkingHour} feedback="none">
                            <input type="hidden" name="id" value={row.id} />
                            <SubmitButton
                              className="btn btn-ghost p-1"
                              pendingLabel=""
                            >
                              <Icon
                                name="close"
                                className="size-3.5"
                                title={`Quitar franja de ${formatMinute(row.startMinute)} a ${formatMinute(row.endMinute)}`}
                              />
                            </SubmitButton>
                          </ActionForm>
                        </span>
                      ))
                    )}
                  </div>

                  <ActionForm
                    action={addWorkingHour}
                    className="flex shrink-0 flex-wrap items-center gap-1.5"
                    resetOnSuccess
                    feedback="none"
                  >
                    <input type="hidden" name="professionalId" value={selected.id} />
                    <input type="hidden" name="weekday" value={weekday} />

                    <input
                      type="time"
                      name="start"
                      required
                      step={300}
                      className="input w-28 py-1 text-sm"
                      aria-label={`Hora de inicio, ${WEEKDAY_NAMES[weekday]}`}
                    />
                    <span className="text-ink-muted">a</span>
                    <input
                      type="time"
                      name="end"
                      required
                      step={300}
                      className="input w-28 py-1 text-sm"
                      aria-label={`Hora de fin, ${WEEKDAY_NAMES[weekday]}`}
                    />

                    <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="…">
                      <Icon name="plus" className="size-3.5" />
                      <span className="sr-only">
                        Agregar franja el {WEEKDAY_NAMES[weekday]}
                      </span>
                    </SubmitButton>
                  </ActionForm>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Copiar horario ───────────────────────────────────────────── */}
      {daysWithHours.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Copiar un día a otros</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Reemplaza por completo el horario de los días elegidos.
            </p>
          </div>

          <ActionForm action={copyWorkingDay} className="p-4">
            <input type="hidden" name="professionalId" value={selected.id} />

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="field-label" htmlFor="fromWeekday">
                  Copiar el horario de
                </label>
                <select
                  id="fromWeekday"
                  name="fromWeekday"
                  className="input capitalize"
                  defaultValue={String(daysWithHours[0])}
                >
                  {daysWithHours.map((day) => (
                    <option key={day} value={day} className="capitalize">
                      {WEEKDAY_NAMES[day]}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="min-w-0">
                <legend className="field-label">a estos días</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {WEEKDAY_ORDER.map((day) => (
                    <label
                      key={day}
                      className="flex items-center gap-1.5 text-sm capitalize"
                    >
                      <input
                        type="checkbox"
                        name="targets"
                        value={day}
                        className="size-4 accent-[var(--color-accent)]"
                      />
                      {WEEKDAY_NAMES[day]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <SubmitButton className="btn btn-secondary" pendingLabel="Copiando…">
                Copiar
              </SubmitButton>
            </div>
          </ActionForm>
        </section>
      ) : null}

      {/* ── Excepciones por fecha ────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">Excepciones para un día puntual</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Para feriados o días con horario distinto. Solo afectan a esa fecha.
          </p>
        </div>

        <ActionForm
          action={addOverride}
          className="border-b border-line p-4"
          resetOnSuccess
        >
          <input type="hidden" name="professionalId" value={selected.id} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="field-label" htmlFor="override-date">
                Fecha
              </label>
              <input
                id="override-date"
                name="date"
                type="date"
                required
                min={today}
                className="input"
              />
            </div>

            <div>
              <label className="field-label" htmlFor="override-kind">
                Qué pasa ese día
              </label>
              <select id="override-kind" name="kind" className="input" defaultValue="closed">
                <option value="closed">No atiende</option>
                <option value="custom">Atiende en otro horario</option>
              </select>
            </div>

            <div>
              <label className="field-label" htmlFor="override-start">
                Desde
              </label>
              <input
                id="override-start"
                name="start"
                type="time"
                step={300}
                className="input"
              />
            </div>

            <div>
              <label className="field-label" htmlFor="override-end">
                Hasta
              </label>
              <input
                id="override-end"
                name="end"
                type="time"
                step={300}
                className="input"
              />
            </div>

            <div className="flex items-end">
              <SubmitButton className="btn btn-secondary w-full">Agregar</SubmitButton>
            </div>
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            Las horas solo hacen falta si elegís &ldquo;Atiende en otro
            horario&rdquo;.
          </p>
        </ActionForm>

        {overrides.length === 0 ? (
          <p className="px-4 py-5 text-center text-sm text-ink-muted">
            No hay excepciones cargadas de acá en adelante.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {overrides.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium first-letter:uppercase">
                    {formatDateLong(row.date, true)}
                  </span>

                  <span className="ml-2 text-sm text-ink-soft">
                    {row.kind === "closed"
                      ? "No atiende"
                      : `Atiende de ${formatMinute(row.startMinute ?? 0)} a ${formatMinute(row.endMinute ?? 0)}`}
                  </span>

                  {row.note ? (
                    <span className="ml-2 text-xs text-ink-muted">{row.note}</span>
                  ) : null}
                </div>

                <ActionForm action={deleteOverride} feedback="none">
                  <input type="hidden" name="id" value={row.id} />
                  <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="…">
                    <Icon name="trash" className="size-3.5" />
                    <span className="sr-only">Eliminar excepción</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
