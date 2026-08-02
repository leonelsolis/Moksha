import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

/**
 * Cierre de sesión forzado.
 *
 * Existe para un caso concreto: la cookie está firmada y sin vencer, pero el
 * usuario ya no puede entrar (lo desactivaron o le borraron la cuenta). El
 * middleware corre en el borde y solo mira la firma, así que daría por buena
 * esa cookie y devolvería a /admin, mientras que la página, que sí consulta la
 * base, volvería a mandar al login: un rebote infinito.
 *
 * Se resuelve acá y no en la página porque un Server Component no puede
 * modificar cookies; un route handler sí.
 */
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(
    new URL("/admin/login?sesion=cerrada", request.url),
  );

  response.cookies.delete(SESSION_COOKIE);

  return response;
}
