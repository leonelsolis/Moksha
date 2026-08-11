"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

import { createManualAppointment } from "@/app/actions/admin";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { emptyManualBookingState } from "@/lib/action-state";
import { APPOINTMENT_NOTES_MAX, MANUAL_NAME_MAX } from "@/lib/validation";

/**
 * Alta de un turno que se pidió por WhatsApp, por teléfono o en el mostrador.
 *
 * Arranca cerrada, como un botón: la agenda es lo que se viene a mirar y el
 * formulario aparece solo cuando hace falta cargar algo.
 *
 * Es más corto que el de la web a propósito. Lo único obligatorio son el nombre
 * y el momento del turno; el resto se completa si se sabe. Quien lo usa está
 * con el teléfono en la mano y una clienta esperando del otro lado, así que
 * cada campo que no sea imprescindible es una traba.
 *
 * Todos los campos son controlados, y no es un detalle de estilo: React vacía
 * los campos no controlados apenas termina una acción, con éxito o sin él. El
 * rechazo más probable acá es que el horario ya esté ocupado —justo el que se
 * arregla cambiando una hora y volviendo a enviar—, y perder los otros siete
 * campos en el camino haría el formulario inservible.
 *
 * Después de guardar no se cierra: se limpian los campos y queda lista para el
 * siguiente. Cargar dos o tres turnos seguidos es lo normal cuando se pasan los
 * mensajes del día a la agenda.
 */

type StaffOption = { id: number; name: string };

type ServiceOption = {
  id: number;
  professionalId: number;
  name: string;
  durationMinutes: number;
  /** Ruta de la categoría, ya armada. Vacía si el servicio no tiene ninguna. */
  category: string;
};

/** Duración de un turno sin servicio elegido. La misma que asume el servidor. */
const DEFAULT_DURATION = 60;

/** Lo que se escribe a mano, todo junto. */
type Draft = {
  fullName: string;
  phone: string;
  dni: string;
  date: string;
  time: string;
  serviceName: string;
  notes: string;
};

const emptyDraft = (date: string): Draft => ({
  fullName: "",
  phone: "",
  dni: "",
  date,
  time: "",
  serviceName: "",
  notes: "",
});

export function ManualBookingForm({
  staff,
  services,
  today,
}: {
  /** Profesionales a las que este usuario les puede cargar un turno. */
  staff: StaffOption[];
  services: ServiceOption[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(
    createManualAppointment,
    emptyManualBookingState,
  );

  const [draft, setDraft] = useState(() => emptyDraft(today));
  const [professionalId, setProfessionalId] = useState(staff[0]?.id ?? 0);
  const [serviceId, setServiceId] = useState("");
  const [duration, setDuration] = useState(DEFAULT_DURATION);

  const set =
    <K extends keyof Draft>(key: K) =>
    (value: Draft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!state.ok) return;
    /*
     * Se limpia lo que cambia de una clienta a otra. La profesional elegida se
     * queda como estaba: quien carga tres turnos seguidos suele estar
     * cargándolos para la misma.
     */
    setDraft(emptyDraft(today));
    setServiceId("");
    setDuration(DEFAULT_DURATION);
  }, [state, today]);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" className="size-4" />
        Cargar turno manual
      </button>
    );
  }

  const own = services.filter((s) => s.professionalId === professionalId);

  const pickService = (value: string) => {
    setServiceId(value);
    // Elegir un servicio propone su duración; el campo queda editable porque un
    // turno arreglado por WhatsApp puede llevar más o menos que el estándar.
    const service = own.find((s) => String(s.id) === value);
    if (service) setDuration(service.durationMinutes);
  };

  const errors = state.errors;

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Cargar turno manual</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Para los turnos que se piden por WhatsApp o por teléfono. Quedan en
            la agenda igual que los de la web y ocupan el horario.
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setOpen(false)}
        >
          <Icon name="close" className="size-3.5" />
          Cerrar
        </button>
      </div>

      <form action={formAction} className="space-y-3 p-4">
        {state.message ? (
          <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
        ) : null}

        {/* Una profesional carga los suyos y nada más: el id no se elige. */}
        {staff.length > 1 ? (
          <div className="sm:max-w-xs">
            <label className="field-label" htmlFor="manual-professional">
              Profesional
            </label>
            <select
              id="manual-professional"
              name="professionalId"
              className="input"
              value={professionalId}
              onChange={(e) => {
                setProfessionalId(Number(e.target.value));
                // Los servicios son de cada una: el que estaba elegido no
                // tiene por qué existir en la agenda de la otra.
                setServiceId("");
                setDuration(DEFAULT_DURATION);
              }}
            >
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="professionalId" value={professionalId} />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            name="fullName"
            label="Nombre y apellido"
            className="sm:col-span-2"
            error={errors.fullName}
            hint="Si solo sabés el nombre, alcanza."
            maxLength={MANUAL_NAME_MAX}
            autoComplete="off"
            placeholder="Como te lo dijo"
            value={draft.fullName}
            onChange={set("fullName")}
          />

          <Field
            name="phone"
            label="Teléfono"
            required={false}
            error={errors.phone}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            maxLength={20}
            value={draft.phone}
            onChange={set("phone")}
          />

          <Field
            name="dni"
            label="DNI"
            required={false}
            error={errors.dni}
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            value={draft.dni}
            onChange={set("dni")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="field-label" htmlFor="manual-date">
              Fecha
            </label>
            <input
              id="manual-date"
              name="date"
              type="date"
              required
              className="input"
              value={draft.date}
              onChange={(e) => set("date")(e.target.value)}
              aria-invalid={errors.date ? "true" : undefined}
            />
            <FieldError message={errors.date} />
          </div>

          <div>
            <label className="field-label" htmlFor="manual-time">
              Hora
            </label>
            <input
              id="manual-time"
              name="time"
              type="time"
              required
              step={300}
              className="input"
              value={draft.time}
              onChange={(e) => set("time")(e.target.value)}
              aria-invalid={errors.time ? "true" : undefined}
            />
            <FieldError message={errors.time} />
          </div>

          <div>
            <label className="field-label" htmlFor="manual-service">
              Servicio
              <span className="ml-1 font-normal text-ink-muted">(opcional)</span>
            </label>
            <select
              id="manual-service"
              name="serviceId"
              className="input"
              value={serviceId}
              onChange={(e) => pickService(e.target.value)}
              aria-invalid={errors.serviceId ? "true" : undefined}
            >
              <option value="">Otro / a convenir</option>
              {/* La categoría va adelante para que los de la misma línea
                  queden juntos al leer la lista, que es como se los busca. */}
              {own.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.category ? `${service.category} › ` : ""}
                  {service.name} · {service.durationMinutes} min
                </option>
              ))}
            </select>
            <FieldError message={errors.serviceId} />
          </div>

          <div>
            <label className="field-label" htmlFor="manual-duration">
              Duración (minutos)
            </label>
            <input
              id="manual-duration"
              name="durationMinutes"
              type="number"
              min={5}
              max={480}
              step={5}
              required
              className="input"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              aria-invalid={errors.durationMinutes ? "true" : undefined}
            />
            <FieldError message={errors.durationMinutes} />
          </div>
        </div>

        {/* Sin servicio de la lista: qué se viene a hacer, en dos palabras. */}
        {serviceId === "" ? (
          <div>
            <label className="field-label" htmlFor="manual-service-name">
              Motivo
              <span className="ml-1 font-normal text-ink-muted">(opcional)</span>
            </label>
            <input
              id="manual-service-name"
              name="serviceName"
              className="input"
              maxLength={80}
              placeholder="Retoque, arreglo, consulta…"
              value={draft.serviceName}
              onChange={(e) => set("serviceName")(e.target.value)}
            />
          </div>
        ) : null}

        <div>
          <label className="field-label" htmlFor="manual-notes">
            Notas
            <span className="ml-1 font-normal text-ink-muted">(opcional)</span>
          </label>
          <textarea
            id="manual-notes"
            name="notes"
            rows={2}
            className="input"
            maxLength={APPOINTMENT_NOTES_MAX}
            placeholder="Lo que haya que recordar de este turno."
            value={draft.notes}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton />
          <p className="text-xs text-ink-muted">
            Un turno cargado a mano no se limita al horario de atención, pero sí
            se comprueba que no se pise con otro.
          </p>
        </div>
      </form>
    </section>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p className="field-error">
      <Icon name="alert" className="mt-px size-3.5 shrink-0" />
      {message}
    </p>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? "Guardando…" : "Guardar turno"}
    </button>
  );
}
