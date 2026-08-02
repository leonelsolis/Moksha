/**
 * Tipos que cruzan del servidor al navegador.
 *
 * Se declaran aparte de las tablas a propósito: acá solo viaja lo que la web
 * pública necesita mostrar. Los datos de los clientes de otros turnos nunca
 * entran en estas estructuras.
 */

export type PublicService = {
  id: number;
  name: string;
  durationMinutes: number;
  price: number | null;
  /** Qué es el servicio. Vacío = no se muestra ninguna explicación. */
  description: string;
  /**
   * Foto de ejemplo, ya filtrada por el interruptor del panel: si está
   * apagado llega en `null` y la URL ni siquiera viaja al navegador.
   */
  photoUrl: string | null;
};

/** ¿Hay algo que mostrar en la ficha del servicio? */
export function hasServiceInfo(service: PublicService) {
  return service.description.length > 0 || service.photoUrl !== null;
}

export type PublicProfessionalView = {
  id: number;
  name: string;
  specialty: string;
  photoUrl: string | null;
  bio: string;
  services: PublicService[];
  onVacation: boolean;
  /** Última fecha de vacaciones, para el mensaje "Vuelve el …". */
  vacationUntil: string | null;
};

export type BookingWindowView = {
  /** Primer día reservable, en la zona horaria del negocio. */
  today: string;
  /** Último día reservable. */
  lastDate: string;
};

/** Respuesta de /api/disponibilidad: fecha → minutos de inicio libres. */
export type AvailabilityMap = Record<string, number[]>;
