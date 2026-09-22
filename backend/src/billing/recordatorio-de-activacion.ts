/**
 * Reglas del recordatorio al comprador que PAGÓ y no ha creado su cuenta.
 *
 * Existe porque el primer aviso (SMS + correo en el momento del pago) sí
 * llega —comprobado con MessageLog— y aun así hay compradores que no se
 * registran. Al comprador nadie le volvía a escribir: el único recordatorio
 * era un SMS al equipo a la hora.
 *
 * Funciones puras: el servicio decide CUÁNDO mirar, esto decide QUÉ toca.
 */

const MIN = 60_000;
const HORA = 60 * MIN;

/** Primer recordatorio: 30 min después del pago. */
export const PRIMERO_A = 30 * MIN;
/** Segundo y último: 24 h después del pago. */
export const SEGUNDO_A = 24 * HORA;
/**
 * Hasta cuándo se sigue intentando el segundo. Da margen a una caída o a un
 * despliegue, pero corta el pasado: sin tope, el primer despliegue le
 * escribiría a todo comprador histórico que nunca se registró.
 */
export const SEGUNDO_HASTA = 48 * HORA;
/**
 * Separación mínima entre los dos. Si el primero salió tarde (una caída larga),
 * el segundo no puede llegar una hora después: serían dos SMS casi seguidos.
 */
export const SEPARACION_MINIMA = 6 * HORA;

export type Recordatorio = 1 | 2;

/**
 * De 21:00 a 8:00 (hora de Colombia, UTC−5 sin horario de verano) no se
 * escribe: el recordatorio espera a la mañana. El servidor va en UTC, así que
 * sin esto el de las 24 h de una compra de madrugada llegaría de madrugada.
 * Los márgenes de arriba ya cubren la espera (el segundo tiene hasta 48 h).
 */
export function enHorarioDeSilencio(ahora: Date): boolean {
  const hora = (ahora.getUTCHours() + 24 - 5) % 24;
  return hora >= 21 || hora < 8;
}

export function queRecordatorioToca(
  fila: {
    createdAt: Date;
    buyerReminder1At: Date | null;
    buyerReminder2At: Date | null;
  },
  ahora: Date,
): Recordatorio | null {
  const edad = ahora.getTime() - fila.createdAt.getTime();
  if (edad < PRIMERO_A) return null;
  if (edad < SEGUNDO_A) return fila.buyerReminder1At ? null : 1;
  if (edad > SEGUNDO_HASTA || fila.buyerReminder2At) return null;
  if (
    fila.buyerReminder1At &&
    ahora.getTime() - fila.buyerReminder1At.getTime() < SEPARACION_MINIMA
  ) {
    return null;
  }
  return 2;
}

export function textoDelRecordatorio(opts: {
  cual: Recordatorio;
  nombre: string | null;
  marca: string | null;
  enlace: string;
  email: string;
}): string {
  const primerNombre = (opts.nombre ?? '').trim().split(/\s+/)[0] ?? '';
  const saludo = primerNombre ? `Hola ${primerNombre} 👋` : 'Hola 👋';
  // El nombre de la marca sale de la BD: un comprador de Sellea lee «Sellea».
  const enMarca = opts.marca?.trim() ? ` en ${opts.marca.trim()}` : '';
  const cabeza =
    opts.cual === 1
      ? `${saludo} Tu pago${enMarca} ya está confirmado, pero aún falta crear tu cuenta.`
      : `${saludo} Seguimos guardando tu pago${enMarca}, pero tu cuenta todavía no está creada.`;
  return (
    `${cabeza}\n\n` +
    `Solo toma 30 segundos:\n${opts.enlace}\n\n` +
    `Usa el mismo correo del pago (${opts.email}).`
  );
}

/** Teléfono del comprador según la pasarela (cada una lo guarda en su sitio). */
export function telefonoDelPago(
  pasarela: 'HOTMART' | 'STRIPE',
  rawPayload: unknown,
): { nombre: string | null; telefono: string | null } {
  const raw = (rawPayload ?? {}) as any;
  if (pasarela === 'HOTMART') {
    const b = raw?.data?.buyer ?? {};
    return {
      nombre: b?.name ?? null,
      telefono: b?.checkout_phone ?? b?.phone ?? null,
    };
  }
  const obj = raw?.data?.object ?? {};
  const cd = obj?.customer_details ?? {};
  return {
    nombre: cd?.name ?? obj?.customer_name ?? null,
    telefono: cd?.phone ?? obj?.customer_phone ?? null,
  };
}
