"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { emptyActionState, type ActionState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";

/**
 * Formulario del panel conectado a un server action.
 *
 * Envuelve el `useActionState` y el mensaje de resultado, que si no habría que
 * repetir en cada uno de los formularios del panel. Al completarse con éxito
 * limpia los campos, para poder cargar varias cosas seguidas (por ejemplo tres
 * franjas horarias) sin borrar a mano lo anterior.
 */

type Props = {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  /** Vaciar los campos tras un envío exitoso. */
  resetOnSuccess?: boolean;
  /** Dónde aparece el mensaje de resultado. */
  feedback?: "top" | "bottom" | "none";
};

export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  feedback = "top",
}: Props) {
  const [state, formAction] = useActionState(action, emptyActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  const message =
    state.message && feedback !== "none" ? (
      <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
    ) : null;

  return (
    <form ref={formRef} action={formAction} className={className}>
      {feedback === "top" ? message : null}
      {children}
      {feedback === "bottom" ? message : null}
    </form>
  );
}

/**
 * `name` y `value` son para los formularios con más de un botón, donde lo que
 * distingue una acción de otra es cuál se apretó (guardar el horario, marcar
 * que no atiende, borrarlo). El navegador manda el par solo del botón usado.
 */
export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingLabel = "Guardando…",
  name,
  value,
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  pendingLabel?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      name={name}
      value={value}
      title={title}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
