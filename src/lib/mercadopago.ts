import "server-only";

import { getSettings, settingBool, type Settings } from "./settings";

/**
 * Cobro online con Mercado Pago.
 *
 * La integración es OPCIONAL y está apagada de fábrica. Igual que los emails,
 * está detrás de dos llaves que tienen que estar puestas las dos:
 *   · MERCADOPAGO_ACCESS_TOKEN en el servidor (el token no puede vivir en la
 *     base: es la credencial que permite cobrar en nombre del negocio).
 *   · El interruptor "Cobrar online" en Ajustes (`mp_enabled`).
 *
 * Si falta cualquiera de las dos, la web funciona completa y sin cobro online:
 * se reserva el turno como siempre. Por eso este archivo no lee el token al
 * importarse ni construye ningún cliente global — todo se resuelve adentro de
 * cada función. Un módulo que tira al cargarse rompería el arranque del
 * servidor entero, no solo la parte de pagos.
 *
 * Ninguna función de acá lanza excepciones por configuración faltante o por
 * error de red: todas devuelven `{ ok: false, reason }`, para que quien llame
 * decida si sigue sin cobrar o le muestra el motivo a alguien.
 *
 * Se usa la API REST con fetch, sin instalar el SDK, por la misma razón que en
 * los emails: son un par de POST y así no se agrega una dependencia que hay
 * que mantener.
 *
 * Para ponerlo en marcha:
 *   1. Entrar a https://www.mercadopago.com.ar/developers/panel y crear una
 *      aplicación.
 *   2. Copiar el Access Token (arrancar con el de prueba).
 *   3. Cargarlo como MERCADOPAGO_ACCESS_TOKEN en el servidor (en Vercel:
 *      Settings → Environment Variables) y volver a desplegar.
 *   4. Encender "Cobrar online" en Ajustes.
 */

const MP_API = "https://api.mercadopago.com";

/** Corta la espera: un checkout no puede quedar colgado de la API de MP. */
const TIMEOUT_MS = 10_000;

export type MpResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

/**
 * El token, ya normalizado. `null` si no está cargado o quedó vacío (una
 * variable puesta con el valor en blanco es tan "no configurada" como una que
 * no existe, y es un error de tipeo bastante común).
 */
export function mercadoPagoToken(): string | null {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  return token ? token : null;
}

/**
 * Estado de la configuración, para mostrarlo en Ajustes. El cliente no tiene
 * cómo saber si el token quedó cargado en el servidor: esto se lo dice.
 */
export function mercadoPagoConfig(settings: Settings) {
  const token = mercadoPagoToken();
  const enabled = settingBool(settings, "mp_enabled");

  return {
    hasToken: token !== null,
    enabled,
    /** Las credenciales de prueba de MP vienen con este prefijo. */
    isTestToken: token?.startsWith("TEST-") ?? false,
    /** Solo con las dos cosas se cobra online. */
    ready: token !== null && enabled,
  };
}

/**
 * ¿Hay que cobrar este turno?
 *
 * Es la única pregunta que necesita hacer el flujo de reserva. Devuelve false
 * ante cualquier duda —sin token, apagado, o si la consulta a la base falla—
 * porque el lado seguro es reservar sin cobrar: un turno sin pago se arregla
 * cobrando en el local, pero una web caída no se arregla sola.
 */
export async function isMercadoPagoReady(): Promise<boolean> {
  try {
    const settings = await getSettings();
    return mercadoPagoConfig(settings).ready;
  } catch (e) {
    console.error("[mercadopago] no se pudo leer la configuración", e);
    return false;
  }
}

/**
 * Llamada cruda a la API. Centraliza lo mismo para todos los endpoints: token,
 * timeout, y traducir cualquier fallo a un `MpResult` en vez de tirar.
 *
 * `requireEnabled` distingue los dos usos: el cobro real exige el interruptor
 * encendido, y la prueba de conexión desde el panel no, porque justamente
 * sirve para verificar el token ANTES de encenderlo.
 */
async function call<T>(
  path: string,
  init: RequestInit & { requireEnabled?: boolean } = {},
): Promise<MpResult<T>> {
  const { requireEnabled = true, ...request } = init;

  const token = mercadoPagoToken();
  if (!token) {
    return {
      ok: false,
      reason: "Falta cargar MERCADOPAGO_ACCESS_TOKEN en el servidor.",
    };
  }

  if (requireEnabled && !(await isMercadoPagoReady())) {
    return { ok: false, reason: "El cobro online está desactivado." };
  }

  try {
    const response = await fetch(`${MP_API}${path}`, {
      ...request,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...request.headers,
      },
      // Un pago nunca se sirve desde caché.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body = await response.text();

    if (!response.ok) {
      // El cuerpo trae el motivo real ("invalid access token", "invalid
      // items"…). Sin esto, un cobro que no sale no deja ninguna pista.
      console.error("[mercadopago] rechazó la llamada", path, response.status, body);
      return { ok: false, reason: mpReason(response.status, body) };
    }

    return { ok: true, data: (body ? JSON.parse(body) : {}) as T };
  } catch (e) {
    // Incluye el timeout (TimeoutError) y la caída de red.
    console.error("[mercadopago] falló la conexión", path, e);
    return { ok: false, reason: "No se pudo conectar con Mercado Pago." };
  }
}

/** Traduce la respuesta de MP a algo accionable desde el panel. */
function mpReason(status: number, detail: string) {
  const message = (() => {
    try {
      const parsed = JSON.parse(detail) as { message?: string; error?: string };
      return parsed.message ?? parsed.error ?? "";
    } catch {
      return "";
    }
  })();

  if (status === 401 || status === 403) {
    return "Mercado Pago rechazó el token. Revisá MERCADOPAGO_ACCESS_TOKEN.";
  }
  if (status === 404) {
    return "Mercado Pago no encontró ese recurso.";
  }
  if (status === 400 || status === 422) {
    return `Mercado Pago rechazó los datos: ${message || "revisá el importe y el servicio."}`;
  }
  if (status === 429) {
    return "Mercado Pago está limitando las llamadas. Probá de nuevo en un rato.";
  }
  return `Mercado Pago respondió ${status}. ${message}`.trim();
}

/* ── Preferencias de pago ────────────────────────────────────────────── */

export type PreferenceInput = {
  /** Lo que ve el cliente en el checkout. Ej: "Seña — Kapping". */
  title: string;
  /** En pesos. MP rechaza 0 y los negativos. */
  unitPrice: number;
  /** Con qué identificamos el turno cuando vuelve el aviso de pago. */
  externalReference: string;
  payerEmail?: string;
  backUrls?: { success?: string; failure?: string; pending?: string };
  /** A dónde avisa MP cuando cambia el estado del pago. */
  notificationUrl?: string;
  /**
   * Evita cobrar dos veces si el cliente hace doble clic o se reintenta la
   * llamada: con la misma clave, MP devuelve la preferencia ya creada.
   */
  idempotencyKey?: string;
};

export type Preference = {
  id: string;
  /** El link al que se manda al cliente para pagar. */
  initPoint: string;
  sandboxInitPoint: string;
};

/**
 * Crea la preferencia (el "carrito" de MP) y devuelve el link de pago.
 *
 * Con el cobro apagado devuelve `{ ok: false }` sin salir a la red, así que
 * llamarla igual es inofensivo: el flujo de reserva puede pedirla siempre y
 * seguir sin cobrar cuando no viene.
 */
export async function createPreference(
  input: PreferenceInput,
): Promise<MpResult<Preference>> {
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) {
    return { ok: false, reason: "El importe a cobrar tiene que ser mayor a 0." };
  }

  const result = await call<{
    id: string;
    init_point: string;
    sandbox_init_point: string;
  }>("/checkout/preferences", {
    method: "POST",
    headers: input.idempotencyKey
      ? { "X-Idempotency-Key": input.idempotencyKey }
      : undefined,
    body: JSON.stringify({
      items: [
        {
          title: input.title,
          quantity: 1,
          currency_id: "ARS",
          // MP quiere el precio como número, con dos decimales como mucho.
          unit_price: Math.round(input.unitPrice * 100) / 100,
        },
      ],
      external_reference: input.externalReference,
      ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
      ...(input.backUrls ? { back_urls: input.backUrls } : {}),
      ...(input.notificationUrl
        ? { notification_url: input.notificationUrl }
        : {}),
    }),
  });

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      id: result.data.id,
      initPoint: result.data.init_point,
      sandboxInitPoint: result.data.sandbox_init_point,
    },
  };
}

/* ── Pagos ───────────────────────────────────────────────────────────── */

export type Payment = {
  id: number;
  /** 'approved' | 'pending' | 'rejected' | … tal cual lo manda MP. */
  status: string;
  statusDetail: string;
  externalReference: string | null;
  amount: number | null;
};

/**
 * Consulta un pago por id. Es lo que hay que llamar cuando llega el aviso de
 * MP: el webhook trae solo el id, y el estado se confirma preguntándoselo a la
 * API — nunca creyéndole al cuerpo de la notificación, que llega sin
 * autenticar.
 */
export async function getPayment(id: string | number): Promise<MpResult<Payment>> {
  const result = await call<{
    id: number;
    status: string;
    status_detail: string;
    external_reference: string | null;
    transaction_amount: number | null;
  }>(`/v1/payments/${id}`);

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      id: result.data.id,
      status: result.data.status,
      statusDetail: result.data.status_detail,
      externalReference: result.data.external_reference,
      amount: result.data.transaction_amount,
    },
  };
}

/* ── Prueba de conexión ──────────────────────────────────────────────── */

/**
 * Verifica que el token sirva, sin cobrarle nada a nadie: pide la cuenta a la
 * que pertenece. Anda con el interruptor apagado a propósito, para poder
 * comprobar la configuración antes de encenderlo.
 */
export async function checkMercadoPagoToken(): Promise<
  MpResult<{ email: string; nickname: string; siteId: string }>
> {
  const result = await call<{
    email?: string;
    nickname?: string;
    site_id?: string;
  }>("/users/me", { requireEnabled: false });

  if (!result.ok) return result;

  return {
    ok: true,
    data: {
      email: result.data.email ?? "",
      nickname: result.data.nickname ?? "",
      siteId: result.data.site_id ?? "",
    },
  };
}
