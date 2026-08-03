"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { cancelAppointmentAsAdmin, deleteAppointment } from "@/app/actions/admin";
import { emptyActionState } from "@/lib/action-state";
import { Icon } from "@/components/Icon";

/**
 * Cancelar o eliminar un turno desde el panel.
 *
 * Las dos acciones piden confirmación en el mismo lugar, con textos distintos
 * porque hacen cosas distintas: cancelar libera el horario y deja registro;
 * eliminar borra la fila y los datos del cliente, sin vuelta atrás.
 */

type Mode = "cancel" | "delete";

export function AppointmentActions({
  id,
  canCancel,
}: {
  id: number;
  /** Solo los turnos que todavía ocupan el horario se pueden cancelar. */
  canCancel: boolean;
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

  const errorMessage =
    (!cancelState.ok && cancelState.message) ||
    (!deleteState.ok && deleteState.message) ||
    null;

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
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => setMode("cancel")}
        >
          Cancelar
        </button>
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
