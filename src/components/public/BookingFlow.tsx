"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { createBooking } from "@/app/actions/booking";
import { emptyBookingState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { MAX_LEGS, writeLegs } from "@/lib/booking-legs";
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
 * recorre en cards por categoría (ver `ServicePicker`). Se puede elegir más de
 * uno —pies y manos en el mismo turno— y a partir de ahí todo el flujo trabaja
 * con la suma: la duración que se busca en la agenda es la de todos juntos, y
 * la seña también. El botón "Continuar" es el que cierra el paso, porque acá
 * ya no alcanza con tocar una card para saber que terminó de elegir.
 *
 * ── Una visita, varias profesionales ──────────────────────────────────────
 *
 * Lo que se está armando no es un turno sino una VISITA, y una visita puede
 * repartirse: las manos con una profesional y las cejas con otra, uno detrás
 * del otro en la misma salida. Cada una de esas partes es un "tramo": una
 * profesional con sus servicios.
 *
 * Casi siempre hay un solo tramo, y entonces esto se ve y se comporta igual
 * que siempre. Al confirmar el suyo aparece la opción de sumar otra
 * profesional, y recién ahí los pasos de profesional y servicio se reabren
 * para el tramo nuevo. Lo que ya se eligió queda a la vista en el resumen de
 * la visita, con su botón para quitarlo.
 *
 * De ahí en adelante el flujo sigue siendo uno solo: un día, una hora de
 * inicio y un formulario. Los horarios que se ofrecen son los que dejan entrar
 * todos los tramos seguidos, y de la hora de inicio sale la de cada uno
 * sumando duraciones. Nadie está en dos sillas a la vez.
 *
 * Al costado van las fichas de los servicios elegidos (qué son, y su foto si
 * está activada). No pueden vivir dentro del paso porque el paso se colapsa
 * apenas se confirma: son elementos aparte que acompañan al resto del flujo.
 *
 * Debajo de esa ficha va el mapa del local, que llega armado desde el servidor
 * en `location`. Se recibe como prop en lugar de construirlo acá porque la
 * dirección vive en Ajustes y este componente es de cliente: así el mapa se
 * renderiza en el servidor y la configuración no viaja al navegador.
 */

/** Una profesional con lo que le toca hacer en esta visita. */
type Leg = {
  professional: PublicProfessionalView;
  /** Los servicios elegidos, en el orden en que se fueron tocando. */
  services: PublicService[];
  /** El paso del servicio ya se cerró para este tramo. */
  confirmed: boolean;
};

type Props = {
  professionals: PublicProfessionalView[];
  window: BookingWindowView;
  cancelCutoffHours: number;
  /** Ficha de ubicación ya armada (o `null` si no hay dirección cargada). */
  location?: React.ReactNode;
  /**
   * Qué medios de seña están disponibles, ya resueltos en el servidor.
   *
   * Llegan como dos booleanos y no como configuración: el navegador no tiene
   * por qué enterarse de si hay un token cargado ni a qué alias se transfiere.
   * Eso último se muestra recién después de reservar, en la pantalla del turno.
   */
  payment?: { mercadopago: boolean; transfer: boolean };
};

export function BookingFlow({
  professionals,
  window,
  cancelCutoffHours,
  location = null,
  payment = { mercadopago: false, transfer: false },
}: Props) {
  /** Los tramos de la visita, en el orden en que se atienden. */
  const [legs, setLegs] = useState<Leg[]>([]);
  /** Se está eligiendo profesional: la primera, o una más. */
  const [picking, setPicking] = useState(true);

  const [date, setDate] = useState<string | null>(null);
  const [startMinute, setStartMinute] = useState<number | null>(null);

  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Cambia para volver a pedir la disponibilidad sin tocar la elección: es lo
   * que se usa cuando el servidor rechaza el horario por ocupado.
   */
  const [reloadKey, setReloadKey] = useState(0);

  const [state, formAction] = useActionState(createBooking, emptyBookingState);

  /** El tramo que se está armando: el último, mientras no se confirme. */
  const draft = legs.length > 0 && !legs[legs.length - 1].confirmed
    ? legs[legs.length - 1]
    : null;

  /** La visita está definida: todos los tramos cerrados y ninguno a medio armar. */
  const ready = legs.length > 0 && draft === null && !picking;

  /*
   * Lo que sale de sumar todos los tramos.
   *
   * `legsParam` es también lo que viaja al servidor —en la consulta de
   * disponibilidad y en el formulario— y lo que identifica la elección para el
   * efecto de carga: comparar una cadena evita volver a pedir los horarios
   * cuando el arreglo es otro objeto con lo mismo adentro.
   */
  const legsParam = writeLegs(
    legs
      .filter((leg) => leg.confirmed)
      .map((leg) => ({
        professionalId: leg.professional.id,
        serviceIds: leg.services.map((service) => service.id),
      })),
  );

  const chosenServices = legs.flatMap((leg) => leg.services);

  const totalDuration = chosenServices.reduce(
    (total, service) => total + service.durationMinutes,
    0,
  );
  const totalDeposit = chosenServices.reduce(
    (total, service) => total + (service.depositAmount ?? 0),
    0,
  );

  /** Las que todavía no están en la visita: nadie se atiende dos veces con la misma. */
  const availableProfessionals = professionals.filter(
    (item) => !legs.some((leg) => leg.professional.id === item.id),
  );

  const canAddProfessional =
    legs.length < MAX_LEGS && availableProfessionals.length > 0;

  const detailsRef = useRef<HTMLDivElement>(null);

  /** Trae los horarios libres de toda la ventana para la visita armada. */
  useEffect(() => {
    if (!ready || legsParam === "") {
      setAvailability({});
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    const params = new URLSearchParams({
      legs: legsParam,
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
  }, [ready, legsParam, reloadKey, window.today, window.lastDate]);

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
    setReloadKey((current) => current + 1);
  }, [rejectedSlot, state]);

  /** Cambiar lo que se va a hacer invalida el día y la hora ya elegidos. */
  function resetSchedule() {
    setDate(null);
    setStartMinute(null);
  }

  function selectProfessional(next: PublicProfessionalView) {
    // Con un solo servicio no tiene sentido hacer elegir: se saltea el paso.
    const single = next.services.length === 1 ? [next.services[0]] : [];

    setLegs((current) => [
      ...current,
      { professional: next, services: single, confirmed: single.length === 1 },
    ]);
    setPicking(false);
    resetSchedule();
  }

  /** Agrega el servicio al tramo que se está armando, o lo saca si ya estaba. */
  function toggleService(next: PublicService) {
    setLegs((current) =>
      current.map((leg, index) =>
        index === current.length - 1
          ? {
              ...leg,
              confirmed: false,
              services: leg.services.some((service) => service.id === next.id)
                ? leg.services.filter((service) => service.id !== next.id)
                : [...leg.services, next],
            }
          : leg,
      ),
    );
    resetSchedule();
  }

  function confirmLeg() {
    setLegs((current) =>
      current.map((leg, index) =>
        index === current.length - 1 ? { ...leg, confirmed: true } : leg,
      ),
    );
  }

  /** Saca un tramo de la visita. Los demás quedan como estaban. */
  function removeLeg(professionalId: number) {
    setLegs((current) => {
      const next = current.filter(
        (leg) => leg.professional.id !== professionalId,
      );
      if (next.length === 0) setPicking(true);
      return next;
    });
    resetSchedule();
  }

  /** Vuelve al paso de la profesional para sumar otra a la visita. */
  function addProfessional() {
    setPicking(true);
    resetSchedule();
  }

  /** Empieza de cero: se cambia con quién y, por lo tanto, todo lo demás. */
  function resetVisit() {
    setLegs([]);
    setPicking(true);
    resetSchedule();
  }

  /** Reabre el paso del servicio para corregir el último tramo. */
  function editServices() {
    setLegs((current) =>
      current.map((leg, index) =>
        index === current.length - 1 ? { ...leg, confirmed: false } : leg,
      ),
    );
    resetSchedule();
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

  /*
   * Que el paso del servicio exista o no se decide con el catálogo entero y no
   * con la profesional elegida: si dependiera de ella, los pasos se
   * renumerarían al cambiar de una a otra y el flujo daría un salto.
   */
  const showServiceStep = professionals.some((item) => item.services.length > 1);

  const steps = buildSteps({ legs, picking, draft, date, startMinute });

  /*
   * La ficha se arma una sola vez y se coloca en dos lugares excluyentes por
   * CSS: al costado en pantallas anchas, dentro del flujo en las angostas.
   * El `key` la remonta al cambiar de servicio, que es lo que repite la
   * animación de entrada.
   */
  const info =
    chosenServices.length > 0 ? (
      <div className="space-y-3">
        {chosenServices.map((service) => (
          <ServiceInfo key={service.id} service={service} />
        ))}
      </div>
    ) : null;

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
          title={legs.length > 1 ? "Elegí con quiénes" : "Elegí con quién"}
          state={steps.professional}
          summary={legs.map((leg) => leg.professional.name).join(" + ")}
          onEdit={resetVisit}
        >
          <div className="space-y-3">
            {legs.length > 0 ? (
              <p className="text-sm text-ink-soft">
                Sumá a quién te va a atender después de{" "}
                {legs[legs.length - 1].professional.name}.
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {availableProfessionals.map((item) => (
                <ProfessionalCard
                  key={item.id}
                  data={item}
                  selected={false}
                  onSelect={() => selectProfessional(item)}
                />
              ))}
            </div>

            {/* Arrepentirse de sumar otra no puede costar volver a empezar. */}
            {legs.length > 0 ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPicking(false)}
              >
                Mejor no, seguir así
              </button>
            ) : null}
          </div>
        </Step>

        {/* ── Paso 2 · servicio (solo si hay algo que elegir) ──────────── */}
        {showServiceStep ? (
          <Step
            number={2}
            title="Elegí el servicio"
            state={steps.service}
            summary={
              chosenServices.length > 0
                ? `${legs
                    .map((leg) =>
                      leg.services.map((service) => service.name).join(" + "),
                    )
                    .filter(Boolean)
                    .join(" + ")} · ${totalDuration} min`
                : undefined
            }
            onEdit={editServices}
          >
            <div className="space-y-4">
              {/*
                El `key` reinicia la navegación del catálogo al cambiar de
                profesional: las categorías son del negocio, pero la rama en la
                que estaba parada la clienta era la de la anterior.
              */}
              {draft ? (
                <>
                  {legs.length > 1 ? (
                    <p className="text-sm text-ink-soft">
                      Qué te hacés con {draft.professional.name}.
                    </p>
                  ) : null}

                  <ServicePicker
                    key={draft.professional.id}
                    catalog={draft.professional.catalog}
                    selected={draft.services}
                    onToggle={toggleService}
                  />

                  {/* Con varios servicios elegidos el resumen del botón es lo
                      que confirma que se juntó lo que se quería juntar, antes
                      de cerrar el paso. */}
                  {draft.services.length > 0 ? (
                    <button
                      type="button"
                      onClick={confirmLeg}
                      className="btn btn-primary w-full"
                    >
                      Continuar
                      {draft.services.length > 1
                        ? ` con ${draft.services.length} servicios · ${draft.services.reduce(
                            (total, service) => total + service.durationMinutes,
                            0,
                          )} min`
                        : ""}
                    </button>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  Elegí primero con quién te querés atender.
                </p>
              )}
            </div>
          </Step>
        ) : null}

        {/* Resumen de la visita y la opción de sumar otra profesional. */}
        {ready ? (
          <Visit
            legs={legs}
            totalDuration={totalDuration}
            canAdd={canAddProfessional}
            onAdd={addProfessional}
            onRemove={removeLeg}
          />
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
              {legs.length > 1
                ? "No encontramos ningún día en el que las dos te puedan atender una después de la otra. Probá con una sola profesional, o escribinos y lo acomodamos."
                : "No quedan horarios libres en los próximos días. Escribinos y vemos cómo darte una mano."}
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
            duration={totalDuration}
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
            {ready && date && startMinute != null ? (
              <form action={formAction} className="space-y-4" noValidate>
                <input type="hidden" name="legs" value={legsParam} />
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="startMinute" value={startMinute} />

                <Summary legs={legs} date={date} startMinute={startMinute} />

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

                <DepositChoice deposit={totalDeposit} payment={payment} />

                <SubmitButton legs={legs.length} />

                <p className="text-xs text-ink-muted">
                  Al confirmar te damos un link para ver
                  {legs.length > 1 ? " o cancelar tus turnos." : " o cancelar tu turno."}
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

/**
 * La visita armada, entre el paso del servicio y el del día.
 *
 * Cumple dos funciones y por eso está acá y no adentro de un paso: recuerda
 * qué se juntó cuando los pasos ya se colapsaron, y es el único lugar desde
 * donde se suma otra profesional.
 *
 * Con un solo tramo se ve apenas la invitación a sumar a alguien más, que es
 * lo que hace descubrible la función sin meterse en el medio de nadie. Si el
 * local tiene una sola profesional —o ya están todas en la visita— no se
 * muestra nada.
 */
function Visit({
  legs,
  totalDuration,
  canAdd,
  onAdd,
  onRemove,
}: {
  legs: Leg[];
  totalDuration: number;
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (professionalId: number) => void;
}) {
  const shared = legs.length > 1;

  if (!shared && !canAdd) return null;

  return (
    <section className="panel p-4">
      {shared ? (
        <>
          <h2 className="text-sm font-medium">Tu visita</h2>
          <ol className="mt-2 space-y-2">
            {legs.map((leg, index) => (
              <li
                key={leg.professional.id}
                className="flex items-start gap-3 text-sm"
              >
                <span
                  className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-[11px] tabular text-ink-muted"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {leg.services.map((service) => service.name).join(" + ")}
                  </span>
                  <span className="block text-ink-soft">
                    con {leg.professional.name}
                    <span className="text-ink-muted">
                      {" · "}
                      {leg.services.reduce(
                        (total, service) => total + service.durationMinutes,
                        0,
                      )}{" "}
                      min
                    </span>
                  </span>
                </span>

                <button
                  type="button"
                  className="btn btn-ghost btn-sm shrink-0"
                  onClick={() => onRemove(leg.professional.id)}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ol>

          <p className="mt-3 border-t border-line pt-3 text-sm">
            <span className="text-ink-muted">Total · </span>
            <span className="font-medium tabular">{totalDuration} min</span>
            <span className="text-ink-soft"> seguidos, el mismo día</span>
          </p>
        </>
      ) : null}

      {canAdd ? (
        <div className={shared ? "mt-3" : ""}>
          {!shared ? (
            <p className="mb-2 text-sm text-ink-soft">
              ¿Te vas a hacer algo más con otra profesional? Sumala y te damos
              los turnos seguidos, uno detrás del otro.
            </p>
          ) : null}

          <button type="button" className="btn btn-secondary btn-sm" onClick={onAdd}>
            <Icon name="user" className="size-3.5" />
            Agregar otra profesional
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Cómo se paga la seña.
 *
 * Aparece solo si lo elegido se seña Y hay al menos un medio disponible. En un
 * servicio sin seña —que es el caso de la mayoría— no se renderiza nada y el
 * paso de datos se ve exactamente como se veía antes.
 *
 * Con varios servicios la seña es la suma de las de cada uno, y con varias
 * profesionales, la de todos los tramos: es una visita y se paga una vez. Es
 * la misma cuenta que hace el servidor al confirmar. Acá llega ya sumada.
 *
 * Con un solo medio disponible no se pregunta nada: se informa cuánto y por
 * dónde, y el medio viaja en un campo oculto. Una elección de una sola opción
 * no es una elección, es un clic de más.
 */
function DepositChoice({
  deposit,
  payment,
}: {
  deposit: number;
  payment: { mercadopago: boolean; transfer: boolean };
}) {
  if (deposit <= 0) return null;

  const available = [
    payment.mercadopago ? ("mercadopago" as const) : null,
    payment.transfer ? ("transfer" as const) : null,
  ].filter((method): method is "mercadopago" | "transfer" => method !== null);

  if (available.length === 0) return null;

  const amount = `$${deposit.toLocaleString("es-AR")}`;

  if (available.length === 1) {
    return (
      <div className="rounded-sm border border-line bg-surface-sunken p-3">
        <input type="hidden" name="paymentMethod" value={available[0]} />
        <p className="text-sm font-medium">
          Para reservar se abona una seña de {amount}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          {available[0] === "mercadopago"
            ? "Al confirmar te llevamos a Mercado Pago. El turno queda reservado apenas se acredita."
            : "Al confirmar te mostramos los datos para transferir. El turno queda reservado cuando verificamos la transferencia."}
        </p>
      </div>
    );
  }

  return (
    <fieldset className="rounded-sm border border-line bg-surface-sunken p-3">
      <legend className="px-1 text-sm font-medium">
        ¿Cómo querés abonar la seña de {amount}?
      </legend>

      <div className="mt-2 space-y-2">
        <PaymentOption
          value="mercadopago"
          label="Mercado Pago"
          hint="Tarjeta, débito o efectivo. El turno queda confirmado al instante."
          defaultChecked
        />
        <PaymentOption
          value="transfer"
          label="Transferencia bancaria"
          hint="Te damos el alias en la pantalla siguiente. Lo verificamos y te confirmamos el turno."
        />
      </div>
    </fieldset>
  );
}

function PaymentOption({
  value,
  label,
  hint,
  defaultChecked = false,
}: {
  value: string;
  label: string;
  hint: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer gap-2.5 rounded-sm border border-line bg-surface p-2.5 has-[:checked]:border-accent">
      <input
        type="radio"
        name="paymentMethod"
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-accent"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>
      </span>
    </label>
  );
}

function SubmitButton({ legs }: { legs: number }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
      {pending
        ? "Confirmando…"
        : legs > 1
          ? "Confirmar los turnos"
          : "Confirmar turno"}
    </button>
  );
}

function Summary({
  legs,
  date,
  startMinute,
}: {
  legs: Leg[];
  date: string;
  startMinute: number;
}) {
  const shared = legs.length > 1;

  /*
   * La hora de cada tramo sale de la de inicio sumando lo que dura lo
   * anterior: es la misma cuenta que hace el servidor al guardar. Se muestra
   * porque con dos profesionales lo que la clienta necesita saber es a qué
   * hora la atiende cada una, no cuánto dura el conjunto.
   */
  let cursor = startMinute;
  const rows = legs.map((leg) => {
    const duration = leg.services.reduce(
      (total, service) => total + service.durationMinutes,
      0,
    );
    const row = { leg, start: cursor, duration };
    cursor += duration;
    return row;
  });

  const totalDuration = cursor - startMinute;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-sm border border-line bg-surface-sunken p-3 text-sm">
      <dt className="text-ink-muted">Cuándo</dt>
      <dd className="font-medium">
        {capitalize(formatDateLong(date, true))}, {formatMinute(startMinute)} h
      </dd>

      {shared ? (
        <>
          <dt className="text-ink-muted">La visita</dt>
          <dd className="space-y-1.5">
            {rows.map(({ leg, start, duration }) => (
              <span key={leg.professional.id} className="block">
                <span className="font-medium tabular">
                  {formatMinute(start)} a {formatMinute(start + duration)}
                </span>
                <span className="text-ink-muted"> · </span>
                {leg.services.map((service) => service.name).join(" + ")}
                <span className="block text-ink-soft">
                  con {leg.professional.name}
                </span>
              </span>
            ))}

            <span className="mt-0.5 block font-medium tabular">
              Total · {totalDuration} min
            </span>
          </dd>
        </>
      ) : (
        <>
          <dt className="text-ink-muted">Con</dt>
          <dd>{legs[0].professional.name}</dd>

          <dt className="text-ink-muted">
            {legs[0].services.length === 1 ? "Servicio" : "Servicios"}
          </dt>
          <dd>
            {/* Uno por línea: dos servicios largos en una sola línea se cortan
                justo donde hay que leerlos. El total va aparte, que es el dato
                que dice cuánto va a durar el turno. */}
            {legs[0].services.map((service) => (
              <span key={service.id} className="block">
                {service.name}
                <span className="text-ink-muted"> · {service.durationMinutes} min</span>
              </span>
            ))}

            {legs[0].services.length > 1 ? (
              <span className="mt-0.5 block font-medium tabular">
                Total · {totalDuration} min
              </span>
            ) : null}
          </dd>
        </>
      )}
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
 *
 * Sumar otra profesional reabre los dos primeros pasos —hay que elegir quién y
 * qué otra vez— y por eso el día y la hora vuelven a quedar pendientes: los
 * horarios que sirven ya no son los mismos.
 */
function buildSteps(selection: {
  legs: Leg[];
  picking: boolean;
  draft: Leg | null;
  date: string | null;
  startMinute: number | null;
}): Record<"professional" | "service" | "date" | "time" | "details", StepState> {
  const { legs, picking, draft, date, startMinute } = selection;

  const order: ("professional" | "service" | "date" | "time" | "details")[] = [
    "professional",
    "service",
    "date",
    "time",
    "details",
  ];

  const complete: Record<string, boolean> = {
    professional: legs.length > 0 && !picking,
    service: legs.length > 0 && !picking && draft === null,
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
