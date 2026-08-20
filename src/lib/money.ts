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

/**
 * Importe con los centavos siempre a la vista.
 *
 * Es el formato de las transferencias, y los centavos no son decoración: son
 * lo que identifica de quién es el dinero que entró. Un "$5.000" donde debía
 * decir "$5.000,37" convierte un pago identificable en uno anónimo, así que
 * acá los dos decimales no son opcionales.
 */
export function formatMoneyExact(amount: number) {
  return `$${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
