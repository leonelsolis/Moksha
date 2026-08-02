import Link from "next/link";

import { Alert } from "@/components/Alert";
import { LookupForm } from "@/components/public/LookupForm";
import { SiteFooter, SiteHeader } from "@/components/public/SiteChrome";
import { getSettings, settingBool, settingInt } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Mi turno", robots: { index: false } };

export default async function LookupPage() {
  const settings = await getSettings();
  const lookupEnabled = settingBool(settings, "allow_client_lookup");
  const cutoffHours = settingInt(settings, "cancel_cutoff_hours");

  return (
    <>
      <SiteHeader settings={settings} />

      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-6 sm:py-10">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Ver o cancelar mi turno
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Si tenés a mano el link que te dimos al reservar, entrá directamente
          ahí. Si lo perdiste, buscá tu turno con estos datos.
        </p>

        <div className="mt-6">
          {lookupEnabled ? (
            <LookupForm />
          ) : (
            <Alert tone="info" title="Buscá tu turno con el link">
              Para ver o cancelar tu turno usá el link que te dimos al reservar.
              Si no lo tenés, comunicate con nosotros.
            </Alert>
          )}
        </div>

        {cutoffHours > 0 ? (
          <p className="mt-6 border-t border-line pt-5 text-sm text-ink-soft">
            Los turnos se pueden cancelar hasta {cutoffHours}{" "}
            {cutoffHours === 1 ? "hora" : "horas"} antes del horario reservado.
          </p>
        ) : null}

        <p className="mt-6 text-sm text-ink-soft">
          ¿Querés sacar un turno nuevo?{" "}
          <Link href="/" className="font-medium text-accent underline underline-offset-4">
            Reservá acá
          </Link>
        </p>
      </main>

      <SiteFooter settings={settings} />
    </>
  );
}
