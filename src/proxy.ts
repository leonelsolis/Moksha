import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Puerta de entrada al panel.
 *
 * Corta el paso antes de que se ejecute ninguna página, así una ruta nueva
 * bajo /admin queda protegida por defecto aunque quien la escriba se olvide de
 * pedir la sesión.
 *
 * No consulta la base de datos: este archivo corre en el runtime Edge, donde
 * no hay acceso a SQLite. Alcanza con validar la firma del token.
 *
 * Lo de acá es la primera capa y la más barata, no la que manda: el rol viene
 * del token, que se emitió al iniciar sesión y puede haber quedado viejo. Cada
 * página y cada acción vuelven a pedir el usuario con `requireUser` o
 * `requireAdmin`, que leen los permisos de la base.
 */

/** Secciones que solo abre una cuenta de administración. */
const ADMIN_ONLY = ["/admin/profesionales", "/admin/ajustes", "/admin/usuarios"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySession(token);

  // Quien ya inició sesión no necesita volver a ver el login.
  if (pathname === "/admin/login") {
    if (session) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL("/admin/login", request.url);
    // Para volver a donde quería entrar después de iniciar sesión.
    if (pathname !== "/admin") loginUrl.searchParams.set("volver", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAdminOnly = ADMIN_ONLY.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );

  if (isAdminOnly && session.role !== "admin") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
