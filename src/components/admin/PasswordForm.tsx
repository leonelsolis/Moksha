"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { changePassword } from "@/app/actions/auth";
import { emptyPasswordState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";

export function PasswordForm() {
  const [state, formAction] = useActionState(changePassword, emptyPasswordState);

  return (
    <form action={formAction} className="space-y-3" noValidate>
      {state.message ? (
        <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          name="currentPassword"
          label="Contraseña actual"
          type="password"
          autoComplete="current-password"
        />
        <Field
          name="newPassword"
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          hint="Mínimo 8 caracteres"
        />
        <Field
          name="repeatPassword"
          label="Repetir la nueva"
          type="password"
          autoComplete="new-password"
        />
      </div>

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="btn btn-secondary" disabled={pending}>
      {pending ? "Cambiando…" : "Cambiar contraseña"}
    </button>
  );
}
