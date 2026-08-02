"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  removeProfessionalPhoto,
  uploadProfessionalPhoto,
} from "@/app/actions/photos";
import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { emptyActionState } from "@/lib/action-state";

/**
 * Subida de la foto de una profesional.
 *
 * La imagen se achica en el navegador antes de enviarla. Una foto sacada con
 * el celular pesa varios megas y tiene 4000 píxeles de ancho; en la web se
 * muestra a unos 300, así que mandarla entera sería gastar los datos del
 * celular de la dueña y hacer lenta la página pública. Reducida a 800px y
 * recomprimida queda en unos 150 KB sin diferencia visible.
 *
 * De paso resuelve otra cosa: los envíos al servidor tienen un tope de tamaño
 * que una foto sin procesar superaría.
 *
 * Sobre cómo se dispara el envío: el archivo achicado se vuelve a poner en el
 * campo y se envía el formulario de la manera habitual, en vez de llamar a la
 * acción por código. Es lo que permite que React sepa que hay un envío en
 * curso y que el botón muestre "Subiendo…".
 */

const MAX_SIDE = 800;
const JPEG_QUALITY = 0.85;

type Props = {
  professionalId: number;
  photoUrl: string | null;
  name: string;
};

async function shrinkImage(file: File): Promise<File> {
  // `imageOrientation` respeta el dato de rotación que guardan los celulares;
  // sin esto, las fotos verticales aparecen acostadas.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const escala = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );

  if (!blob) return file;

  return new File([blob], "foto.jpg", { type: "image/jpeg" });
}

export function PhotoUpload({ professionalId, photoUrl, name }: Props) {
  const [state, subir, subiendo] = useActionState(
    uploadProfessionalPhoto,
    emptyActionState,
  );
  const [quitarState, quitar, quitando] = useActionState(
    removeProfessionalPhoto,
    emptyActionState,
  );

  const formRef = useRef<HTMLFormElement>(null);
  const [preparando, setPreparando] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // La vista previa vive en memoria del navegador; hay que liberarla.
  useEffect(() => {
    return () => {
      if (previa) URL.revokeObjectURL(previa);
    };
  }, [previa]);

  // Cuando el servidor confirma, la foto de verdad reemplaza a la previa.
  useEffect(() => {
    if (state.ok) setPrevia(null);
  }, [state.ok]);

  async function alElegir(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setErrorLocal(null);

    if (!file.type.startsWith("image/")) {
      setErrorLocal("Ese archivo no es una imagen.");
      input.value = "";
      return;
    }

    setPreparando(true);

    try {
      const reducida = await shrinkImage(file);

      // Se reemplaza el archivo elegido por la versión achicada, así el
      // formulario envía esa y no la original.
      const contenedor = new DataTransfer();
      contenedor.items.add(reducida);
      input.files = contenedor.files;

      // El envío va inmediatamente después de cargar el archivo, antes de
      // tocar ningún estado: un re-render en el medio puede rehacer el campo
      // y perder lo que se acaba de asignar.
      formRef.current?.requestSubmit();

      setPrevia(URL.createObjectURL(reducida));
    } catch {
      setErrorLocal("No pudimos procesar esa imagen. Probá con otra.");
      input.value = "";
    } finally {
      setPreparando(false);
    }
  }

  const mostrada = previa ?? photoUrl;
  const ocupado = preparando || subiendo || quitando;

  const mensaje = errorLocal
    ? { tono: "error" as const, texto: errorLocal }
    : state.message
      ? {
          tono: state.ok ? ("success" as const) : ("error" as const),
          texto: state.message,
        }
      : quitarState.message
        ? {
            tono: quitarState.ok ? ("success" as const) : ("error" as const),
            texto: quitarState.message,
          }
        : null;

  return (
    <div className="space-y-2.5">
      <span className="field-label">Foto</span>

      <div className="flex items-start gap-3">
        <div
          className={`size-20 shrink-0 overflow-hidden rounded-sm border border-line bg-surface-sunken ${
            ocupado ? "opacity-50" : ""
          }`}
        >
          {mostrada ? (
            // Puede ser una URL del almacenamiento o un link externo cargado a
            // mano, así que no se usa next/image (exigiría declarar dominios).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mostrada}
              alt={`Foto de ${name}`}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Icon name="user" className="size-7 text-line-strong" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <form ref={formRef} action={subir}>
              <input type="hidden" name="professionalId" value={professionalId} />
              {/*
                No lleva `disabled`: un campo deshabilitado queda fuera del
                envío del formulario, así que la foto nunca llegaría al
                servidor. Mientras hay una subida en curso, el que bloquea el
                acceso es la etiqueta de abajo.
              */}
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                onChange={alElegir}
                className="sr-only"
                id={`foto-${professionalId}`}
              />

              <label
                htmlFor={`foto-${professionalId}`}
                className={`btn btn-secondary btn-sm ${
                  ocupado ? "pointer-events-none opacity-55" : ""
                }`}
              >
                {preparando
                  ? "Preparando…"
                  : subiendo
                    ? "Subiendo…"
                    : mostrada
                      ? "Cambiar foto"
                      : "Subir foto"}
              </label>
            </form>

            {photoUrl && !ocupado ? (
              <form action={quitar}>
                <input type="hidden" name="professionalId" value={professionalId} />
                <button type="submit" className="btn btn-ghost btn-sm">
                  Quitar
                </button>
              </form>
            ) : null}
          </div>

          <p className="mt-1.5 text-xs text-ink-muted">
            Se achica sola, no importa el tamaño. Sale mejor si es cuadrada.
          </p>
        </div>
      </div>

      {mensaje ? <Alert tone={mensaje.tono}>{mensaje.texto}</Alert> : null}
    </div>
  );
}
