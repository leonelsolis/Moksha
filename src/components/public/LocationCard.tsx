import { Icon } from "@/components/Icon";

/**
 * Dónde queda el local, con el mapa de Google.
 *
 * Acompaña al turno confirmado: recién reservado es cuando la clienta quiere
 * saber cómo llegar, y el mismo link le sirve después para abrir el GPS el día
 * que viene.
 *
 * El mapa es el embed público de Google: se arma solo con la dirección escrita
 * en Ajustes y no necesita ninguna clave de API, así el sistema se puede
 * instalar en otro negocio sin dar de alta nada en Google Cloud. Como
 * contrapartida no se puede personalizar (ni marcador propio ni estilos); si
 * alguna vez hace falta eso, hay que pasar a la Maps Embed API con clave.
 *
 * Si en Ajustes no hay dirección cargada, el componente no devuelve nada y la
 * página queda exactamente como estaba.
 */

export function LocationCard({
  address,
  businessName,
}: {
  address: string;
  businessName: string;
}) {
  const query = encodeURIComponent(address);

  // `output=embed` es el mapa sin clave; el link de "Cómo llegar" usa la URL
  // universal de Google Maps, que en el celular abre la app si está instalada.
  const embedUrl = `https://www.google.com/maps?q=${query}&output=embed`;
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${query}`;

  return (
    <aside className="panel overflow-hidden">
      <div className="aspect-[4/3] w-full border-b border-line bg-surface-sunken">
        <iframe
          src={embedUrl}
          title={`Mapa con la ubicación de ${businessName}`}
          className="size-full border-0"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>

      <div className="p-4">
        <p className="eyebrow">Dónde es</p>

        <p className="mt-1.5 flex items-start gap-1.5 text-sm">
          <Icon name="pin" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
          <span>{address}</span>
        </p>

        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost btn-sm mt-3"
        >
          Cómo llegar
        </a>
      </div>
    </aside>
  );
}
