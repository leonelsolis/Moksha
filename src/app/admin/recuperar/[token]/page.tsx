import Link from "next/link";

import { Alert } from "@/components/Alert";
import { ResetPasswordForm } from "@/components/admin/ResetPasswordForm";
import { resolvePasswordReset } from "@/lib/password-reset";
import { getSettings } from "@/lib/settings";

/**
 * Paso 2: la pantalla a la que llega el link del mail.
 *
 * El token se valida acá, antes de dibujar nada, para no mostrarle el
 * formulario a alguien que va a chocar contra "este link venció" recién
 * después de elegir la contraseña.
 *
 * Un token que no sirve no es un 404: la persona hizo todo bien y el link
 * simplemente se quedó viejo. Se le explica y se le ofrece pedir otro, que es
 * la única salida en los tres casos (inventado, vencido o ya usado).
 *
 * Se muestra a qué usuario pertenece el link. Como una misma dirección puede
 * tener más de una cuenta —la de administración y la de profesional—, sin eso
 * no habría forma de saber cuál de las dos se está cambiando.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Elegir una contraseña nueva",
  robots: { index: false },
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const [lookup, settings] = await Promise.all([
    resolvePasswordReset(token),
    getSettings(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-6">
        <p className="eyebrow">{settings.business_name}</p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
          {lookup.ok ? "Elegí una contraseña nueva" : "Este link ya no sirve"}
        </h1>

        {lookup.ok ? (
          <p className="mt-1 text-sm text-ink-soft">
            Es para la cuenta{" "}
            <strong className="font-medium text-ink">
              {lookup.user.username}
            </strong>
            . Después vas a entrar al panel con la contraseña que elijas ahora.
          </p>
        ) : null}
      </div>

      <div className="panel p-5">
        {lookup.ok ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="space-y-4">
            <Alert tone="warning">
              {lookup.reason === "expired"
                ? "El link venció o ya se usó para cambiar la contraseña. Los links duran poco a propósito."
                : "El link no es válido. Puede haberse cortado al copiarlo del mail."}
            </Alert>

            <Link href="/admin/recuperar" className="btn btn-primary w-full">
              Pedir un link nuevo
            </Link>
          </div>
        )}
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
