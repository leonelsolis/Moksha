/**
 * Iconos SVG dibujados a mano, sin dependencias.
 *
 * Son trazos de 1.5px sobre grilla de 24, en el estilo sobrio del resto del
 * sistema. Cumplen además una función de accesibilidad: acompañan al color en
 * los estados (disponible, ocupado, cancelado) para que se distingan también
 * en escala de grises o con daltonismo.
 */

type IconProps = {
  name: IconName;
  className?: string;
  /** Solo si el icono aporta significado que no está en el texto de al lado. */
  title?: string;
};

export type IconName = keyof typeof PATHS;

const PATHS = {
  check: <polyline points="4 12.5 9 17.5 20 6.5" />,
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  chevronLeft: <polyline points="15 5 8 12 15 19" />,
  chevronRight: <polyline points="9 5 16 12 9 19" />,
  chevronDown: <polyline points="5 9 12 16 19 9" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="2.75" x2="8" y2="6" />
      <line x1="16" y1="2.75" x2="16" y2="6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <polyline points="12 6.75 12 12 15.75 14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.75" />
      <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
    </>
  ),
  image: (
    <>
      <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2" />
      <circle cx="8.75" cy="9.75" r="1.5" />
      <path d="M4.25 16.5 9 12l3 2.75 3-2.25 4.75 4" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <line x1="12" y1="16.25" x2="12" y2="16.35" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.75" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <line x1="12" y1="7.65" x2="12" y2="7.75" />
    </>
  ),
  /** Marca los horarios ya tomados: se lee sin depender del color. */
  slash: <line x1="5" y1="19" x2="19" y2="5" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="1.5" />
      <path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 15.5h.5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a3.5 3.5 0 0 0 5 0l3.5-3.5a3.54 3.54 0 0 0-5-5L11.75 7.25" />
      <path d="M14 10a3.5 3.5 0 0 0-5 0L5.5 13.5a3.54 3.54 0 0 0 5 5l1.75-1.75" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.75" />
      <line x1="15.75" y1="15.75" x2="20.5" y2="20.5" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  trash: (
    <>
      <path d="M4.75 6.75h14.5" />
      <path d="M9.5 6.75V4.5h5v2.25" />
      <path d="M6.5 6.75l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.1" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h3.2L18.9 8.3a2.26 2.26 0 0 0-3.2-3.2L4.5 16.3z" />
      <line x1="14.75" y1="6.25" x2="17.75" y2="9.25" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.75H6.75A1.75 1.75 0 0 0 5 6.5v11a1.75 1.75 0 0 0 1.75 1.75h7.75" />
      <polyline points="16.5 8.5 20 12 16.5 15.5" />
      <line x1="20" y1="12" x2="10.5" y2="12" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.4a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.11a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.11a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.11a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.11a1.65 1.65 0 0 0-1.49 1z" />
    </>
  ),
  list: (
    <>
      <line x1="8.5" y1="7" x2="20" y2="7" />
      <line x1="8.5" y1="12" x2="20" y2="12" />
      <line x1="8.5" y1="17" x2="20" y2="17" />
      <line x1="4.25" y1="7" x2="4.35" y2="7" />
      <line x1="4.25" y1="12" x2="4.35" y2="12" />
      <line x1="4.25" y1="17" x2="4.35" y2="17" />
    </>
  ),
  users: (
    <>
      <circle cx="9.25" cy="8.25" r="3.5" />
      <path d="M2.75 19.5a6.5 6.5 0 0 1 13 0" />
      <path d="M16.5 5.1a3.5 3.5 0 0 1 0 6.3" />
      <path d="M18 14.4a6.5 6.5 0 0 1 3.25 5.1" />
    </>
  ),
  /** Candado: los datos de acceso propios (contraseña, email de contacto). */
  lock: (
    <>
      <rect x="4.25" y="10.5" width="15.5" height="9.75" rx="1.5" />
      <path d="M7.75 10.5V7.75a4.25 4.25 0 0 1 8.5 0v2.75" />
    </>
  ),
  /** Llave: las cuentas que pueden entrar al panel. */
  key: (
    <>
      <circle cx="8" cy="15.75" r="4.25" />
      <line x1="11.1" y1="12.65" x2="19.75" y2="4" />
      <line x1="17" y1="6.75" x2="19.25" y2="9" />
    </>
  ),
  /** Etiqueta: la ficha que explica cada servicio. */
  tag: (
    <>
      <path d="M11.6 3.75H5.25a1.5 1.5 0 0 0-1.5 1.5v6.35a2 2 0 0 0 .59 1.42l7 7a1.5 1.5 0 0 0 2.12 0l6.16-6.16a1.5 1.5 0 0 0 0-2.12l-7-7a2 2 0 0 0-1.42-.59z" />
      <line x1="8" y1="8" x2="8.1" y2="8" />
    </>
  ),
  /** Chinche: la dirección del local en el mapa. */
  pin: (
    <>
      <path d="M12 21.25s7-5.75 7-11.25a7 7 0 1 0-14 0c0 5.5 7 11.25 7 11.25z" />
      <circle cx="12" cy="9.75" r="2.75" />
    </>
  ),
  /** Sombrilla: señala a una profesional de vacaciones. */
  vacation: (
    <>
      <path d="M3.5 11.5a8.5 8.5 0 0 1 17 0z" />
      <line x1="12" y1="11.5" x2="12" y2="20" />
      <path d="M12 20a2.25 2.25 0 0 0 4.5 0" />
    </>
  ),
} as const;

export function Icon({ name, className = "size-4", title }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
