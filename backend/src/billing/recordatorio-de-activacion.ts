/**
 * Reglas del seguimiento al comprador que PAGÓ y no ha creado su cuenta.
 *
 * Existe porque el primer aviso (SMS + correo en el momento del pago) sí
 * llega —comprobado con MessageLog— y aun así hay compradores que no se
 * registran. Al comprador nadie le volvía a escribir, y al equipo solo le
 * llegaba un SMS a la hora.
 *
 * Pedido de Javier (2026-09-22):
 *  - al CLIENTE, un SMS a los 30 min, a las 24 h y a las 48 h;
 *  - al EQUIPO DE IMPLEMENTACIÓN, un aviso a los 30 min y a las 24 h con el
 *    nombre, el negocio, el teléfono y el enlace de activación, para
 *    contactarlo a mano y reenviárselo.
 *
 * Funciones puras: el servicio decide CUÁNDO mirar, esto decide QUÉ toca.
 */

const MIN = 60_000;
const HORA = 60 * MIN;

/** Primer recordatorio: 30 min después del pago. */
export const PRIMERO_A = 30 * MIN;
/** Segundo: 24 h después del pago. */
export const SEGUNDO_A = 24 * HORA;
/** Tercero y último: 48 h después del pago. */
export const TERCERO_A = 48 * HORA;
/**
 * Hasta cuándo se sigue intentando el tercero. Da margen a una caída o a un
 * despliegue, pero corta el pasado: sin tope, el primer despliegue le
 * escribiría a todo comprador histórico que nunca se registró.
 */
export const TERCERO_HASTA = 72 * HORA;
/**
 * Separación mínima entre dos recordatorios. Si uno salió tarde (una caída
 * larga), el siguiente no puede llegar una hora después: serían dos SMS casi
 * seguidos.
 */
export const SEPARACION_MINIMA = 6 * HORA;

export type Recordatorio = 1 | 2 | 3;

/** Los recordatorios que además avisan al equipo de implementación. */
export const AVISAN_AL_EQUIPO: ReadonlySet<Recordatorio> = new Set([1, 2]);

/**
 * De 21:00 a 8:00 (hora de Colombia, UTC−5 sin horario de verano) no se
 * escribe: el recordatorio espera a la mañana. El servidor va en UTC, así que
 * sin esto el de las 24 h de una compra de madrugada llegaría de madrugada.
 * Los márgenes de abajo ya cubren la espera.
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
    buyerReminder3At: Date | null;
  },
  ahora: Date,
): Recordatorio | null {
  const edad = ahora.getTime() - fila.createdAt.getTime();
  if (edad < PRIMERO_A || edad > TERCERO_HASTA) return null;

  let cual: Recordatorio;
  if (edad < SEGUNDO_A) cual = 1;
  else if (edad < TERCERO_A) cual = 2;
  else cual = 3;

  const enviado = [fila.buyerReminder1At, fila.buyerReminder2At, fila.buyerReminder3At];
  if (enviado[cual - 1]) return null;

  // El último que salió, sea cual sea: el que toca espera la separación.
  const ultimo = enviado
    .filter((d): d is Date => !!d)
    .reduce<number>((m, d) => Math.max(m, d.getTime()), 0);
  if (ultimo && ahora.getTime() - ultimo < SEPARACION_MINIMA) return null;
  return cual;
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
  const marca = opts.marca?.trim() ?? '';
  const enMarca = marca ? ` en ${marca}` : '';
  const cabeza =
    opts.cual === 1
      ? `${saludo} Tu pago${enMarca} ya está confirmado, pero aún falta crear tu cuenta.`
      : opts.cual === 2
        ? `${saludo} Seguimos guardando tu pago${enMarca}, pero tu cuenta todavía no está creada.`
        : `${saludo} Tu cuenta${enMarca} sigue sin crearse y tu pago sigue a tu nombre.`;
  return (
    `${cabeza}\n\n` +
    `Solo toma 30 segundos:\n${opts.enlace}\n\n` +
    `Usa el mismo correo del pago (${opts.email}).`
  );
}

/**
 * El aviso al equipo de implementación. Lleva todo lo necesario para llamar
 * al cliente sin abrir el panel, y el enlace para reenviárselo tal cual.
 *
 * `llegoAlCliente` le dice al equipo si nuestro SMS le llegó: si no (teléfono
 * inválido, en la lista de no molestar), el contacto a mano es lo único que
 * queda, y tiene que saberlo.
 */
export function textoAvisoAlEquipo(opts: {
  cual: Recordatorio;
  marca: string | null;
  nombre: string | null;
  negocio: string | null;
  telefono: string | null;
  email: string;
  enlace: string;
  llegoAlCliente: boolean;
}): string {
  const cuando = opts.cual === 1 ? '30 min' : '24 h';
  const telefono = mostrarTelefono(opts.telefono);
  return (
    `🔔 Cliente sin registrarse (${cuando} desde el pago)\n` +
    `Marca: ${opts.marca?.trim() || '—'}\n` +
    `Cliente: ${opts.nombre?.trim() || '(sin nombre)'}\n` +
    `Negocio: ${opts.negocio?.trim() || 'aún no lo registra'}\n` +
    `Teléfono: ${telefono ?? '(no lo dejó)'}\n` +
    `Correo: ${opts.email}\n` +
    (opts.llegoAlCliente
      ? 'Ya le escribimos por SMS. Si no avanza, contáctalo.\n'
      : '⚠️ Nuestro SMS NO le llegó: contáctalo a mano.\n') +
    `\nEnlace de activación para reenviarle:\n${opts.enlace}`
  );
}

/** Teléfono legible y marcable: Hotmart lo manda sin «+» (573001112233). */
export function mostrarTelefono(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  if (t.startsWith('+')) return t;
  const digitos = t.replace(/\D/g, '');
  return digitos.length >= 10 ? `+${digitos}` : t;
}

/**
 * Datos del comprador según la pasarela (cada una los guarda en su sitio).
 *
 * El NEGOCIO solo lo trae Stripe, y solo si la marca activó «nombre de la
 * empresa» en su checkout. Hotmart no lo pide: hasta que el cliente se
 * registra, no se sabe.
 */
export function datosDelComprador(
  pasarela: 'HOTMART' | 'STRIPE',
  rawPayload: unknown,
): { nombre: string | null; telefono: string | null; negocio: string | null } {
  const raw = (rawPayload ?? {}) as any;
  if (pasarela === 'HOTMART') {
    const b = raw?.data?.buyer ?? {};
    return {
      nombre: b?.name ?? null,
      telefono: b?.checkout_phone ?? b?.phone ?? null,
      negocio: null,
    };
  }
  const obj = raw?.data?.object ?? {};
  const cd = obj?.customer_details ?? {};
  const campoNegocio = Array.isArray(obj?.custom_fields)
    ? obj.custom_fields.find((f: any) =>
        /negocio|empresa|business|company/i.test(
          `${f?.key ?? ''} ${f?.label?.custom ?? ''}`,
        ),
      )
    : null;
  return {
    nombre: cd?.name ?? obj?.customer_name ?? null,
    telefono: cd?.phone ?? obj?.customer_phone ?? null,
    negocio:
      cd?.business_name ??
      obj?.collected_information?.business_name ??
      campoNegocio?.text?.value ??
      null,
  };
}
