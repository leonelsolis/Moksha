"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { createBooking } from "@/app/actions/booking";
import { emptyBookingState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { formatDateLong, formatMinute } from "@/lib/dates";
import {
  hasServiceInfo,
  type AvailabilityMap,
  type BookingWindowView,
  type PublicProfessionalView,
  type PublicService,
} from "@/lib/public-types";
import { Calendar } from "./Calendar";
import { ProfessionalCard } from "./ProfessionalCard";
import { ServiceInfo } from "./ServiceInfo";
import { ServicePicker } from "./ServicePicker";
import { SlotPicker } from "./SlotPicker";

/**
 * Flujo de reserva.
 *
 * Los pasos se muestran apilados y en orden: el que está activo se ve
 * completo, los anteriores se colapsan a una línea con lo elegido y un botón
 * "Cambiar", y los siguientes quedan atenuados. Es el patrón de checkout: en
 * el celular no hay que recordar en qué paso se está ni perder de vista lo
 * que ya se eligió.
 *
 * La disponibilidad de toda la ventana de reserva se pide de una sola vez al
 * elegir el servicio, así moverse entre días y meses es instantáneo.
 *
 * El paso del servicio no es una lista sino el catálogo del negocio, que se
 * recorre en cards por categoría (ver `ServicePicker`). Acá adentro sigue
 * siendo un paso más: se elige uno y el flujo avanza igual que antes.
 *
 * Al costado va la ficha del servicio elegido (qué es, y su foto si está
 * activada). No puede vivir dentro del paso porque el paso se colapsa apenas se
 * elige: la ficha es un elemento aparte que acompaña al resto del flujo.
 *
 * Debajo de esa ficha va el mapa del local, que llega armado desde el servidor
 * en `location`. Se recibe como prop en lugar de construirlo acá porque la
 * dirección vive en Ajustes y este componente es de cliente: así el mapa se
 * renderiza en el servidor y la configuración no viaja al navegador.
 */

type Props = {
  professionals: PublicProfessionalView[];
  window: BookingWindowView;
  cancelCutoffHours: number;
  /** Ficha de ubicación ya armada (o `null` si no hay dirección cargada). */
  location?: React.ReactNode;
};

export function BookingFlow({
  professionals,
  window,
  cancelCutoffHours,
  location = null,
}: Props) {
  const [professional, setProfessional] = useState<PublicProfessionalView | null>(
    null,
  );
  const [service, setService] = useState<PublicService | null>(null);
  const [serviceConfirmed, setServiceConfirmed] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [startMinute, setStartMinute] = useState<number | null>(null);

  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [state, formAction] = useActionState(createBooking, emptyBookingState);

  const detailsRef = useRef<HTMLDivElement>(null);

  /** Trae los horarios libres de toda la ventana para la selección actual. */
  useEffect(() => {
    if (!professional || !service) {
      setAvailability({});
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    const params = new URLSearchParams({
      professionalId: String(professional.id),
      serviceId: String(service.id),
      from: window.today,
      to: window.lastDate,
    });

    fetch(`/api/disponibilidad?${params}`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("respuesta no válida");
        return response.json();
      })
      .then((data: { days: AvailabilityMap }) => setAvailability(data.days ?? {}))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(
          "No pudimos cargar los horarios. Revisá tu conexión y volvé a intentar.",
        );
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [professional, service, window.today, window.lastDate]);

  /**
   * Si el servidor rechaza la reserva porque el horario se ocupó mientras se
   * completaban los datos, se descarta la hora elegida y se recarga la
   * disponibilidad para que el cliente elija sobre datos frescos.
   */
  const rejectedSlot =
    !state.ok && state.message !== null && Object.keys(state.errors).length === 0;

  useEffect(() => {
    if (!rejectedSlot) return;
    setStartMinute(null);
    setAvailability({});
    // Vuelve a montar el efecto de carga cambiando la referencia del servicio.
    setService((current) => (current ? { ...current } : current));
  }, [rejectedSlot, state]);

  function selectProfessional(next: PublicProfessionalView) {
    setProfessional(next);
    // Con un solo servicio no tiene sentido hacer elegir: se saltea el paso.
    setService(next.services.length === 1 ? next.services[0] : null);
    setServiceConfirmed(next.services.length === 1);
    setDate(null);
    setStartMinute(null);
  }

  function selectService(next: PublicService) {
    setService(next);
    setServiceConfirmed(false);
    setDate(null);
    setStartMinute(null);
  }

  function confirmService() {
    setServiceConfirmed(true);
  }

  function selectDate(next: string) {
    setDate(next);
    setStartMinute(null);
  }

  function selectSlot(next: number) {
    setStartMinute(next);
    // En el celular el formulario queda debajo del pliegue: se acerca solo.
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const availableDates = new Set(Object.keys(availability));
  const slotsForDate = date ? (availability[date] ?? []) : [];
  const showServiceStep = (professional?.services.length ?? 0) > 1;

  const steps = buildSteps({
    professional,
    service,
    serviceConfirmed,
    date,
    startMinute,
    showServiceStep,
  });

  /*
   * La ficha se arma una sola vez y se coloca en dos lugares excluyentes por
   * CSS: al costado en pantallas anchas, dentro del flujo en las angostas.
   * El `key` la remonta al cambiar de servicio, que es lo que repite la
   * animación de entrada.
   */
  const info = service ? <ServiceInfo key={service.id} service={service} /> : null;

  // La columna del costado solo se reserva si hay algo que pueda ir ahí: el
  // mapa, o alguna explicación de servicio cargada. Sin nada de eso, la página
  // queda exactamente como antes.
  const withAside =
    location !== null ||
    professionals.some((item) => item.services.some(hasServiceInfo));

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className={`min-w-0 flex-1 space-y-3 ${withAside ? "xl:max-w-3xl" : ""}`}>
        {/* ── Paso 1 · profesional ─────────────────────────────────────── */}
        <Step
          number={1}
          title="Elegí con quién"
          state={steps.professional}
          summary={professional?.name}
          onEdit={() => {
            setProfessional(null);
            setService(null);
            setDate(null);
            setStartMinute(null);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {professionals.map((item) => (
              <ProfessionalCard
                key={item.id}
                data={item}
                selected={professional?.id === item.id}
                onSelect={() => selectProfessional(item)}
              />
            ))}
          </div>
        </Step>

        {/* ── Paso 2 · servicio (solo si hay más de uno) ───────────────── */}
        {showServiceStep ? (
          <Step
            number={2}
            title="Elegí el servicio"
            state={steps.service}
            summary={service ? `${service.name} · ${service.durationMinutes} min` : undefined}
            onEdit={() => {
              setService(null);
              setServiceConfirmed(false);
              setDate(null);
              setStartMinute(null);
            }}
          >
            <div className="space-y-4">
              {/*
                El `key` reinicia la navegación del catálogo al cambiar de
                profesional: las categorías son del negocio, pero la rama en la
                que estaba parada la clienta era la de la anterior.
              */}
              {professional ? (
                <ServicePicker
                  key={professional.id}
                  catalog={professional.catalog}
                  selected={service}
                  onSelect={selectService}
                />
              ) : null}

              {service && !serviceConfirmed ? (
                <button
                  type="button"
                  onClick={confirmService}
                  className="btn btn-primary w-full"
                >
                  Continuar
                </button>
              ) : null}
            </div>
          </Step>
        ) : null}

        {/* Ficha del servicio en pantallas angostas: justo debajo de donde se
            eligió, para que no haya que desplazarse a buscarla. */}
        {info ? <div className="xl:hidden">{info}</div> : null}

        {/* ── Paso 3 · fecha ───────────────────────────────────────────── */}
        <Step
          number={showServiceStep ? 3 : 2}
          title="Elegí el día"
          state={steps.date}
          summary={date ? capitalize(formatDateLong(date)) : undefined}
          onEdit={() => {
            setDate(null);
            setStartMinute(null);
          }}
        >
          {loadError ? (
            <Alert tone="error">{loadError}</Alert>
          ) : loading && availableDates.size === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              Buscando horarios disponibles…
            </p>
          ) : availableDates.size === 0 ? (
            <Alert tone="info" title="No hay turnos disponibles">
              No quedan horarios libres en los próximos días. Escribinos y vemos
              cómo darte una mano.
            </Alert>
          ) : (
            <Calendar
              today={window.today}
              lastDate={window.lastDate}
              availableDates={availableDates}
              selected={date}
              loading={loading}
              onSelect={selectDate}
            />
          )}
        </Step>

        {/* ── Paso 4 · horario ─────────────────────────────────────────── */}
        <Step
          number={showServiceStep ? 4 : 3}
          title="Elegí la hora"
          state={steps.time}
          summary={startMinute != null ? `${formatMinute(startMinute)} h` : undefined}
          onEdit={() => setStartMinute(null)}
        >
          <SlotPicker
            slots={slotsForDate}
            duration={service?.durationMinutes ?? 0}
            selected={startMinute}
            onSelect={selectSlot}
          />
        </Step>

        {/* ── Paso 5 · datos y confirmación ────────────────────────────── */}
        <div ref={detailsRef} className="scroll-mt-4">
          <Step
            number={showServiceStep ? 5 : 4}
            title="Confirmá tus datos"
            state={steps.details}
          >
            {professional && service && date && startMinute != null ? (
              <form action={formAction} className="space-y-4" noValidate>
                <input type="hidden" name="professionalId" value={professional.id} />
                <input type="hidden" name="serviceId" value={service.id} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="startMinute" value={startMinute} />

                <Summary
                  professional={professional}
                  service={service}
                  date={date}
                  startMinute={startMinute}
                />

                {state.message ? (
                  <Alert tone="error">{state.message}</Alert>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    name="firstName"
                    label="Nombre"
                    error={state.errors.firstName}
                    autoComplete="given-name"
                    maxLength={60}
                  />
                  <Field
                    name="lastName"
                    label="Apellido"
                    error={state.errors.lastName}
                    autoComplete="family-name"
                    maxLength={60}
                  />
                  <Field
                    name="dni"
                    label="DNI"
                    error={state.errors.dni}
                    inputMode="numeric"
                    placeholder="30123456"
                    hint="Sin puntos ni espacios"
                    maxLength={11}
                  />
                  {/*
                    Teléfono. Para dejar de pedirlo: borrar este campo y quitar la
                    validación de `phone` en src/lib/validation.ts. La columna
                    puede quedarse vacía sin romper nada.
                  */}
                  <Field
                    name="phone"
                    label="Teléfono"
                    error={state.errors.phone}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="1145678900"
                    hint="Por si necesitamos avisarte algo"
                    maxLength={20}
                  />
                  <Field
                    name="email"
                    label="Email"
                    error={state.errors.email}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="nombre@email.com"
                    className="sm:col-span-2"
                    maxLength={200}
                  />
                </div>

                <SubmitButton />

                <p className="text-xs text-ink-muted">
                  Al confirmar te damos un link para ver o cancelar tu turno.
                  {cancelCutoffHours > 0
                    ? ` Podés cancelarlo hasta ${cancelCutoffHours} ${
                        cancelCutoffHours === 1 ? "hora" : "horas"
                      } antes.`
                    : " Podés cancelarlo cuando quieras."}
                </p>
              </form>
            ) : (
              <p className="text-sm text-ink-muted">
                Completá los pasos anteriores para cargar tus datos.
              </p>
            )}
          </Step>
        </div>
      </div>

      {/*
        Columna del costado: acompaña al flujo mientras se elige día y hora.

        En el celular no desaparece si hay mapa, se apila al final de todo:
        primero se saca el turno, después se ve cómo llegar. Es `flex` y no
        `space-y` a propósito, porque la ficha de servicio de acá adentro se
        oculta por CSS y el hueco entre elementos no debe contarla.
      */}
      {withAside ? (
        <aside
          className={`flex-col gap-3 xl:sticky xl:top-6 xl:flex xl:w-72 xl:shrink-0 ${
            location ? "flex" : "hidden"
          }`}
        >
          {/* En pantallas angostas la ficha ya se muestra arriba, dentro del
              flujo; acá aparece recién en la columna del costado. */}
          <div className="hidden xl:block">{info}</div>
          {location}
        </aside>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
      {pending ? "Confirmando…" : "Confirmar turno"}
    </button>
  );
}

function Summary({
  professional,
  service,
  date,
  startMinute,
}: {
  professional: PublicProfessionalView;
  service: PublicService;
  date: string;
  startMinute: number;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm border border-line bg-surface-sunken p-3 text-sm">
      <dt className="text-ink-muted">Cuándo</dt>
      <dd className="font-medium">
        {capitalize(formatDateLong(date, true))}, {formatMinute(startMinute)} h
      </dd>

      <dt className="text-ink-muted">Con</dt>
      <dd>{professional.name}</dd>

      <dt className="text-ink-muted">Servicio</dt>
      <dd>
        {service.name}
        <span className="text-ink-muted"> · {service.durationMinutes} min</span>
      </dd>
    </dl>
  );
}

/** ── Paso del flujo ──────────────────────────────────────────────────── */

type StepState = "active" | "done" | "pending";

function Step({
  number,
  title,
  state,
  summary,
  onEdit,
  children,
}: {
  number: number;
  title: string;
  state: StepState;
  summary?: string;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  const isDone = state === "done";
  const isPending = state === "pending";

  return (
    <section
      className={`panel overflow-hidden ${isPending ? "opacity-55" : ""}`}
      aria-current={state === "active" ? "step" : undefined}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular ${
            isDone
              ? "border-accent bg-accent text-white"
              : isPending
                ? "border-line-strong text-ink-muted"
                : "border-accent text-accent"
          }`}
          aria-hidden="true"
        >
          {isDone ? <Icon name="check" className="size-3.5" /> : number}
        </span>

        {/* Apilado en el celular, en una línea desde tablet: si no, el título
            y el resumen se pelean por el ancho y ambos quedan cortados. */}
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <h2 className="text-sm font-medium">{title}</h2>
          {isDone && summary ? (
            <span className="truncate text-sm text-ink-soft">{summary}</span>
          ) : null}
        </div>

        {isDone && onEdit ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
            Cambiar
          </button>
        ) : null}
      </div>

      {state === "active" ? (
        <div className="border-t border-line p-4">{children}</div>
      ) : null}
    </section>
  );
}

/**
 * Estado de cada paso. El activo es el primero sin completar, así el flujo
 * avanza solo a medida que se elige, sin botones de "siguiente".
 */
function buildSteps(selection: {
  professional: PublicProfessionalView | null;
  service: PublicService | null;
  serviceConfirmed: boolean;
  date: string | null;
  startMinute: number | null;
  showServiceStep: boolean;
}): Record<"professional" | "service" | "date" | "time" | "details", StepState> {
  const { professional, service, serviceConfirmed, date, startMinute } = selection;

  const order: ("professional" | "service" | "date" | "time" | "details")[] = [
    "professional",
    "service",
    "date",
    "time",
    "details",
  ];

  const complete: Record<string, boolean> = {
    professional: professional !== null,
    service: service !== null && serviceConfirmed,
    date: date !== null,
    time: startMinute !== null,
    details: false,
  };

  const activeIndex = order.findIndex((key) => !complete[key]);

  return Object.fromEntries(
    order.map((key, index) => [
      key,
      complete[key] ? "done" : index === activeIndex ? "active" : "pending",
    ]),
  ) as Record<"professional" | "service" | "date" | "time" | "details", StepState>;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
