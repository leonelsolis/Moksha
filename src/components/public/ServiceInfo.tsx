"use client";

import { hasServiceInfo, type PublicService } from "@/lib/public-types";

/**
 * Ficha que explica de qué se trata el servicio elegido.
 *
 * Aparece al costado del flujo en pantallas grandes y debajo de la elección en
 * el celular, con una entrada corta que la señala sin empujar nada de lo que ya
 * estaba en pantalla. El componente se remonta al cambiar de servicio (el padre
 * lo identifica con `key`), así la animación se repite en cada elección.
 *
 * La foto es opcional y viene resuelta desde el servidor: si el interruptor del
 * panel está apagado llega en `null` y acá directamente no hay recuadro, pero la
 * definición se sigue mostrando igual.
 */

export function ServiceInfo({ service }: { service: PublicService }) {
  if (!hasServiceInfo(service)) return null;

  return (
    <aside className="panel animate-card-in overflow-hidden">
      {service.photoUrl ? (
        <div className="aspect-[4/3] w-full overflow-hidden border-b border-line bg-surface-sunken">
          {/*
            Foto cargada desde el panel; puede ser una URL externa, así que no
            se usa next/image para no exigir configurar dominios permitidos.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={service.photoUrl}
            alt={`${service.name}, foto de ejemplo`}
            className="animate-photo-in size-full object-cover"
            loading="lazy"
          />
        </div>
      ) : null}

      <div className="p-4">
        <p className="eyebrow">Qué es</p>

        <h3 className="mt-1.5 text-sm font-medium">{service.name}</h3>

        {service.description ? (
          // `whitespace-pre-line` respeta los saltos de línea que se hayan
          // escrito en el panel, sin habilitar ningún otro formato.
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-ink-soft">
            {service.description}
          </p>
        ) : null}

        <p className="mt-3 text-xs tabular text-ink-muted">
          {service.durationMinutes} min
          {service.price != null
            ? ` · $${service.price.toLocaleString("es-AR")}`
            : ""}
        </p>
      </div>
    </aside>
  );
}
