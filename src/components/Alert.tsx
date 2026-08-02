import { Icon, type IconName } from "./Icon";

/**
 * Mensaje destacado. El icono acompaña al color para que el tono del mensaje
 * (error, aviso, confirmación) también se entienda sin distinguir colores.
 */

type Tone = "error" | "warning" | "success" | "info";

const TONES: Record<Tone, { className: string; icon: IconName }> = {
  error: {
    className: "border-danger-line bg-danger-soft text-danger",
    icon: "alert",
  },
  warning: {
    className: "border-warning-line bg-warning-soft text-warning",
    icon: "alert",
  },
  success: {
    className: "border-accent-line bg-accent-soft text-accent",
    icon: "check",
  },
  info: {
    className: "border-line bg-surface-sunken text-ink-soft",
    icon: "info",
  },
};

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
}) {
  const { className, icon } = TONES[tone];

  return (
    <div
      className={`flex items-start gap-2.5 rounded-sm border p-3 text-sm ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={title ? "mt-0.5" : ""}>{children}</div> : null}
      </div>
    </div>
  );
}
