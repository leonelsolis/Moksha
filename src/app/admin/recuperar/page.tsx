import Link from "next/link";

import { ForgotPasswordForm } from "@/components/admin/ForgotPasswordForm";
import { RESET_TTL_MINUTES } from "@/lib/password-reset";
import { getSettings } from "@/lib/settings";

/**
 * Paso 1: pedir el link para cambiar la contraseña.
 *
 * Se entra desde el login. Vive bajo /admin aunque no haya sesión —el proxy la
 * deja pasar a propósito— para no repartir el panel en dos lugares.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Recuperar la contraseña",
  robots: { index: false },
};

export default async function ForgotPasswordPage() {
  const settings = await getSettings();

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-6">
        <p className="eyebrow">{settings.business_name}</p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
          Recuperar la contraseña
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Escribí el email de tu cuenta y te mandamos un link para elegir una
          contraseña nueva. Vence en {RESET_TTL_MINUTES} minutos y sirve una
          sola vez.
        </p>
      </div>

      <div className="panel p-5">
        <ForgotPasswordForm />
      </div>

      <Link
        href="/admin/login"
        className="mt-5 text-center text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
      >
        Volver a entrar al panel
      </Link>
    </main>
  );
}
