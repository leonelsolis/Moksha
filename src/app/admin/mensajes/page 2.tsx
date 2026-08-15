import Link from "next/link";

import { markAllSent } from "@/app/actions/whatsapp";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { ActionForm, SubmitButton } from "@/components/admin/ActionForm";
import {
  MessageCard,
  type MessageCardData,
} from "@/components/admin/MessageCard";
import { RestoreMessage } from "@/components/admin/RestoreMessage";
import { requireUser } from "@/lib/auth";
import { daysBetween, formatDateLong, formatMinute, nowInTz } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { pendingMessages, recentlySent, whatsappConfig } from "@/lib/whatsapp";

/**
 * La cola de WhatsApp.
 *
 * Dos listas: lo que hay que mandar hoy y lo último que se despachó, por si
 * algo se marcó como enviado sin haberse enviado.
 *
 * Los mensajes no salen solos. Mandar un WhatsApp desde el servidor exige la
 * API oficial de Meta —número dedicado, empresa verificada, plantillas
 * aprobadas y costo por mensaje—, así que lo que hace el sistema es todo lo
 * demás: decidir a quién escribirle, cuándo, y redactar el texto. El envío es
 * un clic por fila. Ver src/lib/whatsapp.ts.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Mensajes" };

export default async function MessagesPage() {
  const user = await requireUser();

  const settings = await getSettings();
  const config = whatsappConfig(settings);

  if (!config.enabled) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mensajes</h1>
        </div>

        <Alert tone="info">
          Los mensajes de WhatsApp están desactivados. Se prenden en{" "}
          <Link href="/admin/ajustes" className="underline underline-offset-4">
            Ajustes
          </Link>
          .
        </Alert>
      </div>
    );
  }

  const [pending, sent] = await Promise.all([
    pendingMessages(user),
    recentlySent(user),
  ]);

  const today = nowInTz(settings.timezone).date;

  const cards: MessageCardData[] = pending.map((message) => {
    /*
     * La línea gris de cada fila. Dice cosas distintas según el tipo porque el
     * dato que importa es distinto: en una confirmación, para cuándo es el
     * turno; en un recordatorio, cuánto hace que fue el último.
     */
    const when = `${formatDateLong(message.date)} a las ${formatMinute(message.startMinute)}`;

    const detail =
      message.kind === "confirmation"
        ? `${message.serviceName || "Turno"} · ${when} · ${message.professionalName}`
        : `Último turno: ${message.serviceName || "servicio"}, hace ${daysBetween(
            message.date,
            today,
          )} días · ${message.professionalName}`;

    return { ...message, detail };
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mensajes</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          A quién hay que escribirle hoy por WhatsApp, con el mensaje ya
          redactado.
        </p>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">
              Para mandar hoy
              {cards.length > 0 ? (
                <span className="ml-2 text-ink-muted">({cards.length})</span>
              ) : null}
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Cada botón abre WhatsApp con el chat y el texto listos: solo hay
              que apretar enviar. El mensaje se puede retocar antes.
            </p>
          </div>

          {cards.length > 1 ? (
            /* Para después de haber mandado varios seguidos: marca la tanda
               entera en vez de fila por fila. */
            <ActionForm action={markAllSent} feedback="none">
              {cards.map((card) => (
                <input key={card.id} type="hidden" name="id" value={card.id} />
              ))}
              <SubmitButton
                className="btn btn-ghost btn-sm"
                pendingLabel="Marcando…"
              >
                Marcar todos como enviados
              </SubmitButton>
            </ActionForm>
          ) : null}
        </div>

        {cards.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-soft">
            No hay nada para mandar. Los recordatorios para volver a reservar
            aparecen solos a los {config.rebookDays} días de cada turno.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {cards.map((card) => (
              <MessageCard key={card.id} message={card} />
            ))}
          </ul>
        )}
      </section>

      {sent.length > 0 ? (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-medium">Últimos enviados</h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              Se marcan al abrir WhatsApp, no al enviarse de verdad: el
              navegador no puede saber si llegaste a apretar enviar. Si alguno
              al final no salió, devolvelo a la lista.
            </p>
          </div>

          <ul className="divide-y divide-line">
            {sent.map((message) => (
              <li
                key={message.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5"
              >
                <span className="min-w-0 text-sm">
                  <Icon
                    name="check"
                    className="mr-1.5 inline size-3.5 text-ink-muted"
                  />
                  {[message.firstName, message.lastName]
                    .filter(Boolean)
                    .join(" ")}
                  <span className="ml-2 text-xs text-ink-muted">
                    {message.kind === "rebooking"
                      ? "volver a reservar"
                      : "confirmación"}
                  </span>
                </span>

                <RestoreMessage id={message.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">Los textos y los días</h2>
          <p className="mt-0.5 text-xs text-ink-soft">
            Hoy el recordatorio sale a los {config.rebookDays} días del turno.
            Se cambia junto con el texto de los mensajes.
          </p>
        </div>

        <Link href="/admin/ajustes" className="btn btn-secondary btn-sm">
          Editar en Ajustes
        </Link>
      </section>
    </div>
  );
}
