import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appointments } from "@/db/schema";
import { settlePayment } from "@/lib/payments";
import { hashToken, looksLikeToken } from "@/lib/tokens";

/**
 * La vuelta del checkout de Mercado Pago.
 *
 * Acá aterriza la clienta al terminar de pagar, y de acá sale redirigida a su
 * turno. Existe para que el turno quede confirmado en el acto en lugar de
 * depender de que el aviso automático llegue primero — y porque en desarrollo
 * es el único camino posible: a `localhost` Mercado Pago no puede entrar.
 *
 * Es una ruta y no la página del turno porque acredita un pago, o sea escribe.
 * Renderizar una página no debería tener efectos; una redirección sí puede.
 *
 * Mercado Pago agrega sus propios parámetros al volver (`payment_id`,
 * `collection_id`, `status`…). El nuestro es `resultado`, que dice por cuál de
 * las tres back_urls entró.
 *
 * Nada de lo que pase acá puede terminar en un error en pantalla: la persona ya
 * pagó. Si algo falla, se la manda igual a su turno, que es donde va a ver el
 * estado de verdad.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function GET(request: NextRequest, { params }: Props) {
  const { token } = await params;

  if (!looksLikeToken(token)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const search = request.nextUrl.searchParams;
  const goToAppointment = (resultado: string) =>
    NextResponse.redirect(
      new URL(`/turno/${token}?pago=${resultado}`, request.url),
    );

  // Mercado Pago manda el id del pago con dos nombres distintos según por dónde
  // vuelva. Vale cualquiera de los dos.
  const paymentId = (
    search.get("payment_id") ??
    search.get("collection_id") ??
    ""
  ).trim();

  // Vuelta sin pago: se apretó "volver al sitio" antes de pagar, o el pago
  // falló. No hay nada que acreditar; la pantalla del turno explica el resto.
  if (!paymentId || paymentId === "null") {
    return goToAppointment(search.get("resultado") ?? "error");
  }

  const result = await settlePayment(paymentId).catch((e) => {
    console.error("[pagos] falló la vuelta del checkout", paymentId, e);
    return { outcome: "unusable" as const, reason: "error inesperado" };
  });

  if (result.outcome === "unusable") {
    console.warn("[pagos] vuelta no acreditada:", paymentId, result.reason);
    // El aviso automático puede acreditarlo después: se muestra la pantalla de
    // "estamos confirmando" en lugar de un error.
    return goToAppointment("pendiente");
  }

  /*
   * El token está a mano solo acá, así que es el único momento en que el mail
   * de confirmación puede llevar el link para ver o cancelar el turno. Se manda
   * únicamente si fue ESTA llamada la que lo confirmó: si ya estaba confirmado,
   * el mail salió con el aviso automático y mandarlo de nuevo sería duplicarlo.
   */
  if (result.outcome === "confirmed") {
    await stampManageLink(result.appointmentId, token);
  }

  if (result.outcome === "slot_taken") return goToAppointment("sin-lugar");
  if (result.outcome === "in_process") return goToAppointment("pendiente");
  if (result.outcome === "not_approved") return goToAppointment("error");

  return goToAppointment("ok");
}

/**
 * Comprobación de que el token del link es el de ese turno.
 *
 * `settlePayment` identifica el turno por el `external_reference` del pago, no
 * por el token, así que una URL con el token de otra persona no puede desviar
 * nada. Esto es solo para no mandar un mail con el link equivocado.
 */
async function stampManageLink(appointmentId: number, token: string) {
  const [row] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);

  if (!row) return;

  const [match] = await db
    .select({ id: appointments.id })
    .from(appointments)
    .where(eq(appointments.cancelTokenHash, hashToken(token)))
    .limit(1);

  if (match?.id !== appointmentId) {
    console.warn(
      `[pagos] la vuelta del pago del turno ${appointmentId} llegó con el token de otro turno.`,
    );
  }
}
