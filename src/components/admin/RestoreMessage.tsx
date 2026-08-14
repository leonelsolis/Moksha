"use client";

import { useActionState } from "react";

import { returnToQueue } from "@/app/actions/whatsapp";
import { emptyActionState } from "@/lib/action-state";

/**
 * Deshacer un envío: la fila vuelve a la lista de pendientes.
 *
 * Es un componente propio y no un `ActionForm` porque acá no va ningún mensaje
 * de resultado: la fila desaparece de "últimos enviados" y reaparece arriba,
 * que ya dice todo lo que hay que decir.
 */
export function RestoreMessage({ id }: { id: number }) {
  const [, restore, pending] = useActionState(returnToQueue, emptyActionState);

  return (
    <form action={restore}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="text-xs text-ink-soft underline underline-offset-4 hover:text-ink disabled:opacity-50"
        disabled={pending}
      >
        {pending ? "Devolviendo…" : "Volver a la lista"}
      </button>
    </form>
  );
}
