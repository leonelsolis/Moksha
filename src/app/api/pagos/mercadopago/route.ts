import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { settlePayment } from "@/lib/payments";

/**
 * Aviso de pago de Mercado Pago.
 *
 * Es el camino que vale para confirmar un turno pagado: llega aunque la clienta
 * cierre el navegador apenas paga, y Mercado Pago lo reintenta durante horas si
 * no contestamos bien.
 *
 * Del cuerpo se usa UNA sola cosa: el id del pago. El estado nunca se le cree a
 * la notificación —llega sin autenticar, y cualquiera puede hacer este POST—
 * sino que se le pregunta a la API con nuestro token. Un id inventado devuelve
 * 404 al consultarlo, porque con un access token solo se ven los pagos de la
 * propia cuenta.
 *
 * Sobre los códigos de respuesta, que acá son la interfaz:
 *   · 200 → "recibido, no lo mandes más". Es lo que va cuando el pago se
 *     procesó, y también cuando el aviso no nos sirve para nada (otro tipo de
 *     evento, un id que no es nuestro): reintentarlo daría siempre igual.
 *   · 500 → "no pude, reintentá". Solo para fallas pasajeras: la API de Mercado
 *     Pago caída o la base sin responder. Devolver 500 por un aviso que nunca
 *     vamos a poder procesar deja a Mercado Pago reintentando en loop.
 *
 * Para configurarlo en producción: panel de Mercado Pago → tu aplicación →
 * Webhooks → URL `https://tu-dominio/api/pagos/mercadopago`, evento "Pagos".
 * La preferencia ya viaja con esta misma URL en `notification_url`, así que
 * anda sin configurar nada; darlo de alta en el panel es lo que además habilita
 * la firma y los reintentos del panel.
 */

export const dynamic = "force-dynamic";

/** Lo que Mercado Pago manda en el cuerpo del aviso. */
type Notification = {
  type?: string;
  topic?: string;
  action?: string;
  data?: { id?: string | number };
};

export async function POST(request: NextRequest) {
  const raw = await request.text().catch(() => "");

  const body = ((): Notification => {
    try {
      return raw ? (JSON.parse(raw) as Notification) : {};
    } catch {
      return {};
    }
  })();

  const params = request.nextUrl.searchParams;

  // El tipo viene en el cuerpo (webhooks) o en la query (IPN, el formato viejo
  // que algunas cuentas todavía usan).
  const kind = body.type ?? body.topic ?? params.get("type") ?? params.get("topic");

  if (kind && kind !== "payment") {
    // 'merchant_order' y compañía: no aportan nada que no traiga el pago.
    return NextResponse.json({ ignored: kind }, { status: 200 });
  }

  const paymentId = String(
    body.data?.id ?? params.get("data.id") ?? params.get("id") ?? "",
  ).trim();

  if (!paymentId) {
    return NextResponse.json({ error: "Sin id de pago." }, { status: 200 });
  }

  if (!signatureIsValid(request, paymentId)) {
    // Con la firma configurada, un aviso que no la trae bien no se procesa. Y
    // no se pide reintento: reintentar no lo va a hacer válido.
    console.warn("[pagos] aviso con firma inválida, descartado:", paymentId);
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  const result = await settlePayment(paymentId).catch((e) => {
    console.error("[pagos] falló al acreditar", paymentId, e);
    return { outcome: "unusable" as const, reason: "error inesperado" };
  });

  if (result.outcome === "unusable") {
    /*
     * No se pudo leer el pago. Puede ser que Mercado Pago no contestara (vale
     * la pena reintentar) o que el aviso no sea nuestro (no vale). Se pide
     * reintento: un aviso ajeno se va a seguir descartando igual de barato, y
     * perder uno propio por no reintentar significa un turno pagado que nunca
     * se confirma.
     */
    console.warn("[pagos] aviso no procesado:", paymentId, result.reason);
    return NextResponse.json({ error: result.reason }, { status: 500 });
  }

  console.info(`[pagos] pago ${paymentId} → ${result.outcome}`);

  return NextResponse.json({ ok: true, outcome: result.outcome }, { status: 200 });
}

/**
 * Mercado Pago también avisa por GET en el formato viejo (IPN). Se atiende con
 * lo mismo: el POST ya lee el id de la query cuando no viene en el cuerpo.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * Verifica la firma del aviso, si hay secreto configurado.
 *
 * El secreto sale del panel de Mercado Pago al dar de alta el webhook. Sin él
 * la verificación se saltea: la integración tiene que andar sin configuración
 * extra, y la seguridad de fondo no depende de esto sino de que el estado del
 * pago se consulta a la API con nuestro token.
 *
 * El texto que se firma lo define Mercado Pago:
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 */
function signatureIsValid(request: NextRequest, paymentId: string) {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) return true;

  const signature = request.headers.get("x-signature");
  if (!signature) return false;

  const parts = new Map(
    signature.split(",").map((piece) => {
      const [key, ...rest] = piece.split("=");
      return [key.trim(), rest.join("=").trim()];
    }),
  );

  const ts = parts.get("ts");
  const hash = parts.get("v1");
  if (!ts || !hash) return false;

  const requestId = request.headers.get("x-request-id") ?? "";
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
