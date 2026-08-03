"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { resetPassword } from "@/app/actions/auth";
import { emptyActionState } from "@/lib/action-state";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";

/**
 * Paso 2: elegir la contraseña nueva.
 *
 * El token viaja en un campo oculto y no en la URL de la acción, que es lo
 * mismo que espera el server action. Igual no se confía en que llegue entero:
 * el servidor lo vuelve a validar antes de tocar nada.
 *
 * Cuando sale bien, el formulario desaparece y queda el link al login. No es
 * cosmético: el token ya está gastado, así que un segundo envío solo podría
 * devolver "este link ya se usó" sobre una contraseña que en realidad se
 * cambió bien. Tampoco se abre la sesión sola —eso lo decide el backend—, así
 * que lo que sigue es entrar como siempre.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPassword, emptyActionState);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{state.message}</Alert>

        <Link href="/admin/login" className="btn btn-primary w-full">
          Entrar al panel
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />

      {state.message ? <Alert tone="error">{state.message}</Alert> : null}

      <Field
        name="newPassword"
        label="Contraseña nueva"
        type="password"
        autoComplete="new-password"
        maxLength={200}
        hint="Mínimo 8 caracteres"
      />
      <Field
        name="repeatPassword"
        label="Confirmar contraseña"
        type="password"
        autoComplete="new-password"
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
      {pending ? "Guardando…" : "Cambiar la contraseña"}
    </button>
  );
}
