import Link from "next/link";

export const metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16">
      <p className="eyebrow">Error 404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        No encontramos esta página
      </h1>
      <p className="mt-2 text-sm text-ink-soft">
        Puede que el link esté incompleto o que el turno que buscabas ya no
        exista.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/" className="btn btn-primary">
          Sacar un turno
        </Link>
        <Link href="/cancelar" className="btn btn-secondary">
          Buscar mi turn
        </Link>
      </div>
    </main>
  );
}
