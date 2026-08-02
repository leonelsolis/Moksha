/**
 * Validación de los datos del cliente.
 *
 * Corre en el servidor (es la que manda) y también en el navegador para dar
 * feedback inmediato. Por eso no importa nada de `server-only`.
 *
 * Criterio general: ser estricto con el formato pero tolerante con la forma de
 * escribir. Un DNI se acepta con puntos, un teléfono con guiones y paréntesis;
 * se normaliza antes de guardar en lugar de rechazar al cliente.
 */

export type FieldErrors = Record<string, string>;

/**
 * Tope de la explicación de un servicio.
 *
 * Es una definición corta al costado del flujo de reserva, no una descripción
 * de catálogo: pasado ese largo deja de leerse y empieza a empujar el resto de
 * la página. El mismo número limita el campo del panel y lo que se guarda.
 */
export const SERVICE_DESCRIPTION_MAX = 400;

export type CustomerInput = {
  firstName: string;
  lastName: string;
  dni: string;
  email: string;
  phone: string;
};

export const CUSTOMER_FIELDS = [
  "firstName",
  "lastName",
  "dni",
  "email",
  "phone",
] as const;

export function normalizeDni(value: string) {
  return value.replace(/[.\s-]/g, "");
}

export function normalizePhone(value: string) {
  return value.replace(/[()\s.-]/g, "");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Espera una dirección ya normalizada. */
export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 200;
}

function validateName(value: string, label: string) {
  const name = normalizeName(value);
  if (!name) return `Ingresá tu ${label}.`;
  if (name.length < 2) return `El ${label} es demasiado corto.`;
  if (name.length > 60) return `El ${label} es demasiado largo.`;
  if (!/^[\p{L}\p{M}'’ -]+$/u.test(name)) {
    return `El ${label} solo puede tener letras.`;
  }
  return null;
}

export function validateCustomer(input: CustomerInput): {
  errors: FieldErrors;
  value: CustomerInput;
} {
  const errors: FieldErrors = {};

  const firstNameError = validateName(input.firstName, "nombre");
  if (firstNameError) errors.firstName = firstNameError;

  const lastNameError = validateName(input.lastName, "apellido");
  if (lastNameError) errors.lastName = lastNameError;

  const dni = normalizeDni(input.dni);
  if (!dni) {
    errors.dni = "Ingresá tu DNI.";
  } else if (!/^\d{7,9}$/.test(dni)) {
    errors.dni = "El DNI debe tener entre 7 y 9 números, sin puntos.";
  }

  const email = normalizeEmail(input.email);
  if (!email) {
    errors.email = "Ingresá tu email.";
  } else if (!isValidEmail(email)) {
    errors.email = "Revisá el email, no parece válido.";
  }

  const phone = normalizePhone(input.phone);
  if (!phone) {
    errors.phone = "Ingresá tu teléfono.";
  } else if (!/^\+?\d{8,15}$/.test(phone)) {
    errors.phone = "El teléfono debe tener entre 8 y 15 números.";
  }

  return {
    errors,
    value: {
      firstName: normalizeName(input.firstName),
      lastName: normalizeName(input.lastName),
      dni,
      email,
      phone,
    },
  };
}

export function readCustomer(formData: FormData): CustomerInput {
  const read = (key: string) => String(formData.get(key) ?? "");
  return {
    firstName: read("firstName"),
    lastName: read("lastName"),
    dni: read("dni"),
    email: read("email"),
    phone: read("phone"),
  };
}
