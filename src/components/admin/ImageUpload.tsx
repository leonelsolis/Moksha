"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/Alert";
import { Icon } from "@/components/Icon";
import { emptyActionState, type ActionState } from "@/lib/action-state";

/**
 * Subida de una imagen desde el panel: la foto de una profesional o el logo.
 *
 * La imagen se achica en el navegador antes de enviarla. Una foto sacada con
 * el celular pesa varios megas y tiene 4000 píxeles de ancho; en la web se
 * muestra a unos 300, así que mandarla entera sería gastar los datos del
 * celular de la dueña y hacer lenta la página pública. Reducida y recomprimida
 * queda en unos 150 KB sin diferencia visible.
 *
 * De paso resuelve otra cosa: los envíos al servidor tienen un tope de tamaño
 * que una foto sin procesar superaría.
 *
 * Sobre cómo se dispara el envío: el archivo achicado se vuelve a poner en el
 * campo y se envía el formulario de la manera habitual, en vez de llamar a la
 * acción por código. Es lo que permite que React sepa que hay un envío en
 * curso y que el botón muestre "Subiendo…".
 */

const JPEG_QUALITY = 0.85;

type Accion = (prev: ActionState, formData: FormData) => Promise<ActionState>;

type Props = {
  /** Identifica el campo dentro de la página; puede haber varios a la vez. */
  id: string;
  label: string;
  hint: string;
  imageUrl: string | null;
  alt: string;
  upload: Accion;
  remove: Accion;
  /** Campos que la acción necesita para saber qué está actualizando. */
  hidden?: Record<string, string | number>;
  /** Lado máximo de la imagen guardada, en píxeles. */
  maxSide?: number;
  /**
   * Un logo suele tener fondo transparente, y JPEG no lo soporta: quedaría con
   * un rectángulo negro detrás. Con `keepAlpha` se guarda en PNG.
   */
  keepAlpha?: boolean;
  /** El recuadro de vista previa: cuadrado para las caras, ancho para el logo. */
  previewClassName?: string;
  imageClassName?: string;
  /** Cómo se llama la imagen en los botones: "Subir foto", "Subir logo". */
  noun?: string;
  /** Ícono del recuadro vacío. */
  emptyIcon?: "user" | "image";
};

async function shrinkImage(file: File, maxSide: number, keepAlpha: boolean) {
  // `imageOrientation` respeta el dato de rotación que guardan los celulares;
  // sin esto, las fotos verticales aparecen acostadas.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const escala = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const ancho = Math.round(bitmap.width * escala);
  const alto = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();

  const tipo = keepAlpha ? "image/png" : "image/jpeg";

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, tipo, JPEG_QUALITY),
  );

  if (!blob) return file;

  return new File([blob], keepAlpha ? "imagen.png" : "imagen.jpg", { type: tipo });
}

export function ImageUpload({
  id,
  label,
  hint,
  imageUrl,
  alt,
  upload,
  remove,
  hidden = {},
  maxSide = 800,
  keepAlpha = false,
  previewClassName = "size-20",
  imageClassName = "object-cover",
  noun = "imagen",
  emptyIcon = "user",
}: Props) {
  const [state, subir, subiendo] = useActionState(upload, emptyActionState);
  const [quitarState, quitar, quitando] = useActionState(remove, emptyActionState);

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

  // Cuando el servidor confirma, la imagen de verdad reemplaza a la previa.
  useEffect(() => {
    if (state.ok) setPrevia(null);
  }, [state.ok]);

  const campos = Object.entries(hidden);

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
      const reducida = await shrinkImage(file, maxSide, keepAlpha);

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

  const mostrada = previa ?? imageUrl;
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
      <span className="field-label">{label}</span>

      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 overflow-hidden rounded-sm border border-line bg-surface-sunken ${previewClassName} ${
            ocupado ? "opacity-50" : ""
          }`}
        >
          {mostrada ? (
            // Puede ser una URL del almacenamiento o un link externo cargado a
            // mano, así que no se usa next/image (exigiría declarar dominios).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mostrada}
              alt={alt}
              className={`size-full ${imageClassName}`}
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Icon name={emptyIcon} className="size-7 text-line-strong" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <form ref={formRef} action={subir}>
              {campos.map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              {/*
                No lleva `disabled`: un campo deshabilitado queda fuera del
                envío del formulario, así que la imagen nunca llegaría al
                servidor. Mientras hay una subida en curso, el que bloquea el
                acceso es la etiqueta de abajo.
              */}
              <input
                type="file"
                name="photo"
                accept="image/jpeg,image/png,image/webp"
                onChange={alElegir}
                className="sr-only"
                id={`imagen-${id}`}
              />

              <label
                htmlFor={`imagen-${id}`}
                className={`btn btn-secondary btn-sm ${
                  ocupado ? "pointer-events-none opacity-55" : ""
                }`}
              >
                {preparando
                  ? "Preparando…"
                  : subiendo
                    ? "Subiendo…"
                    : mostrada
                      ? `Cambiar ${noun}`
                      : `Subir ${noun}`}
              </label>
            </form>

            {imageUrl && !ocupado ? (
              <form action={quitar}>
                {campos.map(([name, value]) => (
                  <input key={name} type="hidden" name={name} value={value} />
                ))}
                <button type="submit" className="btn btn-ghost btn-sm">
                  Quitar
                </button>
              </form>
            ) : null}
          </div>

          <p className="mt-1.5 text-xs text-ink-muted">{hint}</p>
        </div>
      </div>

      {mensaje ? <Alert tone={mensaje.tono}>{mensaje.texto}</Alert> : null}
    </div>
  );
}
