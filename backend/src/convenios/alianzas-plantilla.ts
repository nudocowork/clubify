/**
 * La plantilla de pase de una alianza: qué aspecto tiene y quién puede tocarlo.
 *
 * Sin Prisma ni Nest a propósito, para que los tests importen ESTE módulo y no
 * una copia de la lógica. Es el mismo motivo por el que existe
 * `alianzas-estado.ts`.
 *
 * Antes esta forma vivía dentro de `plantilla()` en el servicio público, que se
 * ejecuta cuando activa el PRIMER empleado. Eso tenía dos problemas: el dueño
 * no podía ver ni retocar la tarjeta antes de repartir el enlace (no existía
 * todavía), y el primer empleado fijaba para siempre unos colores que nadie
 * había elegido. Ahora la plantilla nace con la alianza y esto es lo que
 * comparten los dos caminos.
 */

/** Lo que se necesita de la marca del negocio para pintar la tarjeta. */
export type MarcaDelNegocio = {
  brandName: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
};

/** Lo que se necesita de la alianza. */
export type DatosDeLaAlianza = {
  id: string;
  name: string;
  logoUrl: string | null;
};

/** El diseño que el dueño puede cambiar desde el panel. */
export type DisenoDeLaAlianza = {
  name?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
};

/**
 * Título por defecto. Se separa para que el panel enseñe exactamente el mismo
 * como marcador de posición: si el editor propusiera uno y se guardara otro, el
 * dueño dejaría la caja vacía creyendo una cosa y saldría otra en el teléfono.
 *
 * El nombre se recorta ANTES de interpolarlo, no después: con el `.trim()` al
 * final, «  Ecopetrol  » daba «Convenio   Ecopetrol» con dos espacios dentro.
 */
export const tituloPorDefecto = (nombreEmpresa: string) =>
  `Convenio ${nombreEmpresa.trim()}`.trim();

/**
 * Texto de recompensa con el que nace la tarjeta.
 *
 * **No se edita, a propósito.** En un pase de alianza este campo lo pisan los
 * beneficios vivos —«10% de descuento · Bebida gratis»— en Apple, en Google y
 * en la vista del empleado: es lo que la persona enseña en la caja, y sale de
 * los cupones que el escáner va a aplicar de verdad. Dejarlo editable pondría
 * un control que no cambia nada visible y, peor, permitiría una tarjeta que
 * promete «20% de descuento» mientras la caja aplica el 10%.
 *
 * Se sigue escribiendo al crear porque la columna existe y un valor vacío
 * dejaría huecos en cualquier sitio que la lea sin pasar por la alianza.
 */
export const textoPorDefecto = (nombreEmpresa: string) =>
  `Beneficios de ${nombreEmpresa.trim()}`.trim();

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Normaliza un color, o devuelve `undefined` si no es un hex de 6 dígitos.
 *
 * Se descarta en vez de fallar porque estos valores llegan de un `<input
 * type=color>` y de pegados a mano: un valor raro no debe impedir guardar el
 * resto del diseño, solo no aplicarse. Lo que NO se hace es caer a un color de
 * la plataforma — ver la regla de marcas blancas.
 */
export function colorValido(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return HEX.test(t) ? t.toUpperCase() : undefined;
}

/**
 * Los datos con los que nace la `Card` de una alianza.
 *
 * `type: 'STAMPS'` por lo mismo que la tarjeta de club: toda la maquinaria de
 * billetera —render, push, geolocalización— opera sobre pases de sellos, y así
 * se hereda sin código nuevo. Los resolutores de «primera tarjeta de sellos del
 * negocio» filtran `convenioId: null` para no confundirla con la de
 * fidelización.
 */
export function datosDeLaPlantilla(
  tenantId: string,
  convenio: DatosDeLaAlianza,
  negocio: MarcaDelNegocio | null,
) {
  return {
    tenantId,
    convenioId: convenio.id,
    name: tituloPorDefecto(convenio.name),
    type: 'STAMPS' as const,
    // Los colores DEL NEGOCIO, explícitos. `Card.primaryColor` trae por defecto
    // el verde de Clubify (#22C55E), así que no escribirlos dejaría la tarjeta
    // de una marca blanca pintada con el color de la plataforma.
    primaryColor: colorValido(negocio?.primaryColor),
    secondaryColor: colorValido(negocio?.secondaryColor),
    // La tarjeta de alianza no cuenta nada: es un vale permanente. Se pone 1
    // porque la columna es opcional pero el render de sellos cae al default 10
    // si va en null, y «0 / 10» encima de un descuento del 15% no significa
    // nada para nadie.
    stampsRequired: 1,
    rewardText: textoPorDefecto(convenio.name),
    businessName: negocio?.brandName ?? '',
    // El logo del ALIADO manda en su tarjeta; si no cargó ninguno, el del
    // negocio. Nunca uno de la plataforma.
    logoUrl: convenio.logoUrl ?? negocio?.logoUrl ?? null,
    isActive: true,
  };
}

/**
 * Traduce lo que llega del editor a un `update` de Prisma, campo a campo.
 *
 * Lista blanca explícita, no un *spread* del cuerpo: por esta ruta se escribe
 * en `Card`, y un `...dto` dejaría al dueño de un convenio tocar `type`,
 * `stampsRequired` o `convenioId` de una tarjeta. Es el mismo motivo por el que
 * `actualizarCupon` no incluye `activoAliado`.
 *
 * Un campo ausente no se toca; uno vacío vuelve al valor por defecto, que es lo
 * que espera quien borra el texto de una caja para «dejarlo como estaba».
 */
export function cambiosDelDiseno(
  dto: DisenoDeLaAlianza,
  nombreEmpresa: string,
) {
  const cambios: Record<string, string | null> = {};

  if (dto.name !== undefined) {
    cambios.name = (dto.name ?? '').trim() || tituloPorDefecto(nombreEmpresa);
  }
  for (const c of ['primaryColor', 'secondaryColor'] as const) {
    if (dto[c] !== undefined) {
      const v = colorValido(dto[c]);
      if (v) cambios[c] = v;
    }
  }
  if (dto.logoUrl !== undefined) {
    // Vaciar el logo es una decisión válida: la franja cae a las iniciales de
    // la empresa, que es mejor que un hueco.
    cambios.logoUrl = (dto.logoUrl ?? '').trim() || null;
  }
  return cambios;
}
