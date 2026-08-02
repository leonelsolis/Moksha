"use server";

import { revalidatePath } from "next/cache";
import { del, put } from "@vercel/blob";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { professionals, services } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { requireAdmin, requireUser, withScope, type AdminUser } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";

/**
 * Imágenes del negocio: las fotos de las profesionales, las de los servicios y
 * el logo.
 *
 * Se guardan en Vercel Blob y no en la carpeta `public/`. La diferencia es
 * importante: `public/` es parte del código, así que agregar una imagen ahí
 * obliga a publicar el proyecto de nuevo. En Blob aparece al instante y las
 * dueñas pueden cambiarla solas desde el panel.
 *
 * El navegador achica la imagen antes de mandarla (ver ImageUpload.tsx), así
 * que lo que llega acá son unos cientos de kilobytes, no los varios megas que
 * saca un celular.
 */

/** Tope de seguridad: el navegador ya achica, esto frena cualquier abuso. */
const MAX_BYTES = 2 * 1024 * 1024;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

function error(message: string): ActionState {
  return { ok: false, message };
}

/** Solo se borra del almacenamiento lo que subimos nosotros. */
function esNuestro(url: string | null | undefined): url is string {
  return Boolean(url?.includes(".blob.vercel-storage.com"));
}

/**
 * ¿Está configurado el almacenamiento?
 *
 * Hay dos formas de conectarlo y conviven. Los almacenes creados hasta hace un
 * tiempo dan un `BLOB_READ_WRITE_TOKEN`; los nuevos no emiten ninguno: dan un
 * `BLOB_STORE_ID` y Vercel firma cada pedido con un token temporal que renueva
 * solo. Alcanza con cualquiera de las dos.
 */
function hayAlmacen() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function extensionDe(tipo: string) {
  return tipo === "image/png" ? "png" : tipo === "image/webp" ? "webp" : "jpg";
}

/** Valida el archivo recibido y lo sube. Devuelve la URL o un mensaje de error. */
async function subirImagen(
  file: FormDataEntryValue | null,
  prefijo: string,
): Promise<{ url: string } | { message: string }> {
  if (!(file instanceof File) || file.size === 0) {
    return { message: "Elegí una imagen para subir." };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return { message: "El archivo tiene que ser una imagen JPG, PNG o WEBP." };
  }

  if (file.size > MAX_BYTES) {
    return { message: "La imagen es demasiado grande. Probá con una más liviana." };
  }

  if (!hayAlmacen()) {
    return {
      message:
        "Falta configurar el almacenamiento de imágenes. Ver la sección de fotos en el README.",
    };
  }

  try {
    const blob = await put(`${prefijo}.${extensionDe(file.type)}`, file, {
      access: "public",
      contentType: file.type,
      // Blob agrega un sufijo aleatorio al nombre. Se deja activado a
      // propósito: si se reusara el mismo nombre, los navegadores y la caché
      // de Vercel seguirían mostrando la imagen vieja durante horas.
      addRandomSuffix: true,
    });

    return { url: blob.url };
  } catch (e) {
    // El mensaje que ve la usuaria es genérico a propósito, pero el detalle
    // queda en los logs del servidor: sin esto, un fallo de almacenamiento es
    // imposible de diagnosticar.
    console.error("[blob] falló la subida", prefijo, e);
    return { message: "No se pudo subir la imagen. Probá de nuevo en un momento." };
  }
}

/* ── Fotos de las profesionales ─────────────────────────────────────── */

/**
 * La profesional, si este usuario puede tocar su ficha.
 *
 * La administración llega a cualquiera; cada profesional, solo a la suya. El
 * alcance va en el WHERE, así un id ajeno no devuelve nada en lugar de tener
 * que comparar a mano de quién es la fila.
 */
async function profesionalDeUsuario(user: AdminUser, professionalId: number) {
  const [profesional] = await db
    .select()
    .from(professionals)
    .where(withScope(user, professionals.id, eq(professionals.id, professionalId)))
    .limit(1);

  return profesional ?? null;
}

export async function uploadProfessionalPhoto(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  if (!professionalId) return error("Profesional no encontrada.");

  const professional = await profesionalDeUsuario(user, professionalId);
  if (!professional) return error("Profesional no encontrada.");

  const resultado = await subirImagen(
    formData.get("photo"),
    `profesionales/${professionalId}`,
  );

  if ("message" in resultado) return error(resultado.message);

  const anterior = professional.photoUrl;

  await db
    .update(professionals)
    .set({ photoUrl: resultado.url })
    .where(eq(professionals.id, professionalId));

  // Recién ahora se borra la anterior: si algo falla antes, la profesional
  // se queda con la foto vieja en lugar de quedarse sin ninguna.
  if (esNuestro(anterior)) await del(anterior).catch(() => undefined);

  revalidatePath("/");
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/perfil");

  return { ok: true, message: "Foto actualizada." };
}

export async function removeProfessionalPhoto(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const professionalId = Number(formData.get("professionalId"));
  if (!professionalId) return error("Profesional no encontrada.");

  const professional = await profesionalDeUsuario(user, professionalId);
  if (!professional) return error("Profesional no encontrada.");

  await db
    .update(professionals)
    .set({ photoUrl: null })
    .where(eq(professionals.id, professionalId));

  // Si la foto era un link externo, se quita de la ficha pero no se toca el
  // original.
  if (esNuestro(professional.photoUrl)) {
    await del(professional.photoUrl).catch(() => undefined);
  }

  revalidatePath("/");
  revalidatePath("/admin/profesionales");
  revalidatePath("/admin/perfil");

  return { ok: true, message: "Foto quitada. Se muestran las iniciales." };
}

/* ── Fotos de los servicios ─────────────────────────────────────────── */

/**
 * El servicio, si este usuario puede tocarlo.
 *
 * A diferencia de las fotos de las profesionales, estas no son cosa exclusiva
 * de la administración: cada profesional carga las de sus propios servicios. El
 * alcance va en el WHERE, así un id ajeno no devuelve nada en lugar de tener
 * que comparar a mano de quién es la fila.
 */
async function servicioDeUsuario(user: AdminUser, serviceId: number) {
  const [servicio] = await db
    .select()
    .from(services)
    .where(withScope(user, services.professionalId, eq(services.id, serviceId)))
    .limit(1);

  return servicio ?? null;
}

export async function uploadServicePhoto(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const serviceId = Number(formData.get("serviceId"));
  if (!serviceId) return error("Servicio no encontrado.");

  const servicio = await servicioDeUsuario(user, serviceId);
  if (!servicio) return error("Servicio no encontrado.");

  const resultado = await subirImagen(
    formData.get("photo"),
    `servicios/${serviceId}`,
  );

  if ("message" in resultado) return error(resultado.message);

  const anterior = servicio.photoUrl;

  await db
    .update(services)
    .set({
      photoUrl: resultado.url,
      // La primera foto enciende sola el recuadro: subirla es justamente pedir
      // que se vea. Si ya había una, se respeta el estado del check.
      showPhoto: servicio.photoUrl ? servicio.showPhoto : true,
    })
    .where(eq(services.id, serviceId));

  if (esNuestro(anterior)) await del(anterior).catch(() => undefined);

  revalidatePath("/");
  revalidatePath("/admin/servicios");

  return { ok: true, message: "Foto actualizada." };
}

export async function removeServicePhoto(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();

  const serviceId = Number(formData.get("serviceId"));
  if (!serviceId) return error("Servicio no encontrado.");

  const servicio = await servicioDeUsuario(user, serviceId);
  if (!servicio) return error("Servicio no encontrado.");

  // El check se apaga junto con la foto: si no, volver a subir una la
  // publicaría de entrada sin que nadie lo pidiera.
  await db
    .update(services)
    .set({ photoUrl: null, showPhoto: false })
    .where(eq(services.id, serviceId));

  if (esNuestro(servicio.photoUrl)) {
    await del(servicio.photoUrl).catch(() => undefined);
  }

  revalidatePath("/");
  revalidatePath("/admin/servicios");

  return { ok: true, message: "Foto quitada. Queda solo la explicación." };
}

/* ── Logo del negocio ───────────────────────────────────────────────── */

export async function uploadLogo(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const resultado = await subirImagen(formData.get("photo"), "logo");
  if ("message" in resultado) return error(resultado.message);

  const { business_logo_url: anterior } = await getSettings();

  await updateSettings({ business_logo_url: resultado.url });

  if (esNuestro(anterior)) await del(anterior).catch(() => undefined);

  // El logo está en el encabezado de todas las páginas públicas.
  revalidatePath("/", "layout");
  revalidatePath("/admin/ajustes");

  return { ok: true, message: "Logo actualizado." };
}

export async function removeLogo(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  await requireAdmin();

  const { business_logo_url: anterior } = await getSettings();

  await updateSettings({ business_logo_url: "" });

  if (esNuestro(anterior)) await del(anterior).catch(() => undefined);

  revalidatePath("/", "layout");
  revalidatePath("/admin/ajustes");

  return { ok: true, message: "Logo quitado. Se muestra el nombre en texto." };
}
