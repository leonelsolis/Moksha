"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import {
  cancelAppointmentAsAdmin,
  deleteAppointment,
  rescheduleAppointment,
} from "@/app/actions/admin";
import { emptyActionState } from "@/lib/action-state";
import { Icon } from "@/components/Icon";

/**
 * Mover, cancelar o eliminar un turno desde el panel.
 *
 * Las tres abren el mismo lugar debajo del turno, con textos distintos porque
 * hacen cosas distintas: mover cambia el día y la hora y deja todo lo demás
 * como estaba; cancelar libera el horario y deja registro; eliminar borra la
 * fila y los datos del cliente, sin vuelta atrás.
 */

type Mode = "move" | "cancel" | "delete";

export function AppointmentActions({
  id,
  canCancel,
  date,
  time,
}: {
  id: number;
  /** Solo los turnos que todavía ocupan el horario se pueden cancelar o mover. */
  canCancel: boolean;
  /** Dónde está hoy el turno, para arrancar el formulario con eso puesto. */
  date: string;
  time: string;
}) {
  const [mode, setMode] = useState<Mode | null>(null);

  const [cancelState, cancelAction] = useActionState(
    cancelAppointmentAsAdmin,
    emptyActionState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteAppointment,
    emptyActionState,
  );
  const [moveState, moveAction] = useActionState(
    rescheduleAppointment,
    emptyActionState,
  );

  const errorMessage =
    (!cancelState.ok && cancelState.message) ||
    (!deleteState.ok && deleteState.message) ||
    null;

  if (mode === "move") {
    return (
      <form
        action={moveAction}
        className="w-full rounded-sm border border-line-strong bg-surface-sunken p-2.5 sm:w-auto"
      >
        <input type="hidden" name="id" value={id} />

        <p className="text-xs text-ink-soft">
          Cambia solo el día y la hora. La seña, los datos y las notas quedan
          como están.
        </p>

        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="field-label">Día</span>
            <input
              type="date"
              name="date"
              defaultValue={date}
              required
              className="input tabular"
            />
          </label>

          <label className="block">
            <span className="field-label">Hora</span>
            <input
              type="time"
              name="time"
              defaultValue={time}
              required
              className="input tabular"
            />
          </label>

          <MoveButton />

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setMode(null)}
          >
            Volver
          </button>
        </div>

        {/* El choque de horarios se avisa acá, pegado al formulario, porque lo
            que hay que hacer es elegir otra hora sin perder lo escrito. */}
        {!moveState.ok && moveState.message ? (
          <p className="mt-2 text-xs text-danger">{moveState.message}</p>
        ) : null}
      </form>
    );
  }

  if (mode) {
    const isDelete = mode === "delete";

    return (
      <div className="rounded-sm border border-danger-line bg-danger-soft p-2.5">
        <p className="text-xs text-ink-soft">
          {isDelete
            ? "Se borra el turno y los datos del cliente. No se puede deshacer."
            : "El horario queda libre y otra persona lo puede tomar."}
        </p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <form action={isDelete ? deleteAction : cancelAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton label={isDelete ? "Sí, eliminar" : "Sí, cancelar"} />
          </form>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setMode(null)}
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canCancel ? (
        <>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setMode("move")}
          >
            Mover
          </button>

          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setMode("cancel")}
          >
            Cancelar
          </button>
        </>
      ) : null}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setMode("delete")}
        title="Eliminar definitivamente"
      >
        <Icon name="trash" className="size-3.5" />
        <span className="sr-only">Eliminar turno</span>
      </button>

      {errorMessage ? (
        <span className="text-xs text-danger">{errorMessage}</span>
      ) : null}
    </div>
  );
}

function MoveButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
      {pending ? "Moviendo…" : "Mover turno"}
    </button>
  );
}

function ConfirmButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className="btn btn-sm border-danger bg-danger text-white hover:bg-danger/90"
      disabled={pending}
    >
      {pending ? "Un momento…" : label}
    </button>
  );
}
