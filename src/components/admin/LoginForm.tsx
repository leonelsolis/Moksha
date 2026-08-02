"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { login } from "@/app/actions/auth";
import { emptyLoginState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const [state, formAction] = useActionState(login, emptyLoginState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="volver" value={returnTo} />

      {state.message ? <Alert tone="error">{state.message}</Alert> : null}

      <Field
        name="username"
        label="Usuario"
        autoComplete="username"
        maxLength={60}
      />
      <Field
        name="password"
        label="Contraseña"
        type="password"
        autoComplete="current-password"
        maxLength={200}
      />

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}
