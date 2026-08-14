"use client";

import { useActionState, useState } from "react";

import { dismissMessage, markMessageSent } from "@/app/actions/whatsapp";
import { Icon } from "@/components/Icon";
import { emptyActionState } from "@/lib/action-state";

/**
 * Una fila de la cola de WhatsApp.
 *
 * El botón de enviar hace dos cosas en el mismo clic: abre WhatsApp con el
 * chat y el texto cargados, y marca la fila como enviada. Van juntas porque el
 * navegador no puede enterarse de si la persona apretó enviar del otro lado:
 * WhatsApp se abre en otra pestaña —o directamente en la aplicación del
 * celular— y no le contesta nada a esta página. Esperar la confirmación real
 * sería esperar para siempre, así que se asume enviado y la lista de abajo
 * ofrece deshacer.
 *
 * `window.open` se llama dentro del onClick y no después de que responda la
 * acción: el navegador solo permite abrir una pestaña como consecuencia
 * inmediata de un clic, y una que se abre medio segundo más tarde queda
 * bloqueada por el antipopups.
 *
 * El texto es editable antes de mandarlo. No es un adorno: el mensaje sale con
 * el nombre y la firma de la profesional, y siempre hay algo que ajustar para
 * una clienta en particular. Lo editado no se guarda —el original queda como
 * está para el próximo— y viaja solo dentro del link.
 */

export type MessageCardData = {
  id: number;
  kind: "confirmation" | "rebooking";
  firstName: string;
  lastName: string;
  phone: string;
  serviceName: string;
  date: string;
  startMinute: number;
  professionalName: string;
  number: string | null;
  text: string;
  /** Qué dice la línea gris de abajo: "turno del …", ya armada por la página. */
  detail: string;
};

export function MessageCard({ message }: { message: MessageCardData }) {
  const [text, setText] = useState(message.text);
  const [sendState, send, sending] = useActionState(
    markMessageSent,
    emptyActionState,
  );
  const [, dismiss, dismissing] = useActionState(
    dismissMessage,
    emptyActionState,
  );

  const who = [message.firstName, message.lastName].filter(Boolean).join(" ");

  const isReminder = message.kind === "rebooking";

  function openWhatsapp() {
    if (!message.number) return;
    window.open(
      `https://wa.me/${message.number}?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <li className="px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="text-sm font-medium">{who}</span>
          <span
            className={`badge ml-2 ${
              isReminder
                ? "border-accent-line bg-accent-soft text-accent"
                : "border-line-strong bg-surface-sunken text-ink-soft"
            }`}
          >
            {isReminder ? "Volver a reservar" : "Confirmación"}
          </span>
        </div>

        <span className="tabular text-xs text-ink-muted">{message.phone}</span>
      </div>

      <p className="mt-0.5 text-xs text-ink-soft">{message.detail}</p>

      {message.number === null ? (
        /*
         * El teléfono guardado no se pudo interpretar como un número al que
         * WhatsApp pueda escribirle. Se dice acá, con el número a la vista,
         * en lugar de esconder la fila: quien atiende puede corregirlo en el
         * turno, o escribirle igual desde su celular.
         */
        <p className="mt-2 rounded-md border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-soft">
          Ese teléfono no se entiende como número de WhatsApp, así que no se
          puede armar el link. Revisalo en el turno o escribile a mano.
        </p>
      ) : (
        <textarea
          className="input mt-2 text-sm"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={`Mensaje para ${who}`}
        />
      )}

      {sendState.message && !sendState.ok ? (
        <p className="mt-2 text-xs text-danger">{sendState.message}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={send}>
          <input type="hidden" name="id" value={message.id} />
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            onClick={openWhatsapp}
            disabled={sending || message.number === null}
          >
            <Icon name="chat" className="size-4" />
            {sending ? "Enviando…" : "Enviar por WhatsApp"}
          </button>
        </form>

        <form action={dismiss}>
          <input type="hidden" name="id" value={message.id} />
          <button
            type="submit"
            className="btn btn-ghost btn-sm"
            disabled={dismissing}
          >
            {dismissing ? "Descartando…" : "Descartar"}
          </button>
        </form>
      </div>
    </li>
  );
}
