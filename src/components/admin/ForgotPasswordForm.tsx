"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { requestPasswordReset } from "@/app/actions/auth";
import { emptyActionState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";

/**
 * Pedido del link de recuperación.
 *
 * El formulario queda a la vista después de un pedido exitoso, en lugar de
 * desaparecer: la respuesta del servidor es siempre la misma exista o no la
 * cuenta, así que quien escribió mal la dirección no se entera por el mensaje
 * y necesita poder corregirla ahí mismo.
 *
 * No lleva `noValidate`, al revés que el login: acá el navegador validando el
 * `type="email"` ayuda: el error de tipeo se ve al toque, en vez de después de
 * ir a esperar un mail que nunca iba a llegar.
 */
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(
    requestPasswordReset,
    emptyActionState,
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.message ? (
        <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
      ) : null}

      <Field
        name="email"
        label="Tu email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="vos@ejemplo.com"
        maxLength={200}
        hint="La dirección que tenés cargada en el panel."
      />

      <SubmitButton sent={state.ok} />
    </form>
  );
}

function SubmitButton({ sent }: { sent: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "Enviando…" : sent ? "Enviar de nuevo" : "Enviarme el link"}
    </button>
  );
}
