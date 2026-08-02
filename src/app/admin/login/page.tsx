import Link from "next/link";

import { LoginForm } from "@/components/admin/LoginForm";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Entrar al panel", robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ volver?: string }>;
}) {
  const { volver } = await searchParams;
  const settings = await getSettings();

  const returnTo = volver?.startsWith("/admin") ? volver : "/admin";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-6">
        <p className="eyebrow">{settings.business_name}</p>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
          Panel de administración
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          Entrá para ver los turnos y gestionar los horarios.
        </p>
      </div>

      <div className="panel p-5">
        <LoginForm returnTo={returnTo} />
      </div>

      <Link
        href="/"
        className="mt-5 text-center text-sm text-ink-soft underline-offset-4 hover:text-ink hover:underline"
      >
        Volver al sitio
      </Link>
    </main>
  );
}
