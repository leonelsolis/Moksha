import { Icon } from "./Icon";

/**
 * Campo de formulario con etiqueta, error y las conexiones de accesibilidad
 * ya resueltas (aria-invalid + aria-describedby), para no repetirlas —ni
 * olvidarlas— en cada pantalla.
 */

type Props = {
  name: string;
  label: string;
  error?: string;
  hint?: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  inputMode?: "text" | "numeric" | "tel" | "email";
  maxLength?: number;
  className?: string;
};

export function Field({
  name,
  label,
  error,
  hint,
  type = "text",
  defaultValue,
  placeholder,
  required = true,
  autoComplete,
  inputMode,
  maxLength,
  className,
}: Props) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className={className}>
      <label className="field-label" htmlFor={name}>
        {label}
        {!required ? (
          <span className="ml-1 font-normal text-ink-muted">(opcional)</span>
        ) : null}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        className="input"
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
      />

      {error ? (
        <p className="field-error" id={errorId}>
          <Icon name="alert" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-ink-muted" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
