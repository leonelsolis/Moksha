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
 * no hay acceso a SQLite. Alcanza con validar la firma del token. Cada página
 * igual vuelve a pedir la sesión con `requireSession`, que sí puede verificar
 * permisos contra la base.
 */
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

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
