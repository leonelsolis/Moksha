import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { matchIncomingTransfers } from "@/lib/transfer";

/**
 * Busca transferencias entrantes y acredita las que coinciden.
 *
 * ── Por qué esto es un cron y no un webhook ─────────────────────────────
 *
 * Un cobro de Mercado Pago avisa solo: la preferencia lleva nuestra
 * `notification_url` y cuando el pago se aprueba llega un POST a
 * `/api/pagos/mercadopago`. Una transferencia que alguien manda a la cuenta no
 * dispara nada hacia nosotros: es plata que entra a una cuenta, no un cobro de
 * nuestra aplicación. La única forma de enterarse es ir a preguntar cada
 * tanto, y eso es un cron.
 *
 * Cada cinco o diez minutos alcanza de sobra. Del otro lado hay alguien
 * esperando que le confirmen un turno, no un pago en tiempo real; y la
 * alternativa —que lo confirme una persona cuando revisa el panel— tarda
 * muchísimo más.
 *
 * ── Configurarlo ────────────────────────────────────────────────────────
 *
 * En Vercel se declara en `vercel.json` (ya está) y hace falta CRON_SECRET en
 * las variables de entorno; Vercel lo manda solo en el header. En cualquier
 * otro lado, un cron del sistema que haga:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/pagos/transferencias
 *
 * Si `transfer_auto_verify` está apagado en Ajustes, esto no hace nada: sale
 * en la primera línea sin salir a la red. Se puede dejar programado igual.
 *
 * ── Los códigos de respuesta ────────────────────────────────────────────
 *
 * Siempre 200 salvo que falte la autorización. `matchIncomingTransfers` no
 * lanza nunca y ya deja en los logs lo que no pudo hacer; devolver un error
 * haría que el cron figure como fallado por algo que se va a reintentar solo
 * en la corrida siguiente.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const result = await matchIncomingTransfers();

  if (result.confirmed > 0) {
    console.info(
      `[transferencia] ${result.confirmed} turno(s) confirmados sobre ${result.checked} movimiento(s) revisados`,
    );
  }

  return NextResponse.json({ ok: true, ...result }, { status: 200 });
}

/**
 * Sin CRON_SECRET cargado no se atiende a nadie.
 *
 * Al revés que el webhook de Mercado Pago —que se puede dejar sin secreto
 * porque el estado del pago se le pregunta a la API igual—, acá no hay nada
 * que verificar contra un tercero: quien llegue a este endpoint dispara una
 * ronda de acreditaciones. Así que el secreto no es opcional, y si falta la
 * variable el endpoint queda cerrado en vez de abierto.
 */
function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.warn(
      "[transferencia] falta CRON_SECRET: la verificación automática está cerrada",
    );
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
