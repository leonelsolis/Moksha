/**
 * Importes en pantalla, en emails y en el panel.
 *
 * Vive suelto y no dentro de `payments.ts` porque los emails también escriben
 * plata, y `payments` los llama a ellos: si el formato viviera ahí, importarlo
 * desde `email.ts` cerraría el círculo pagos → avisos → emails → pagos.
 */

/** Texto del importe, para pantalla y emails. */
export function formatMoney(amount: number) {
  return `$${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}
