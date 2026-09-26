/**
 * A qué filtro pertenece cada tarjeta del listado.
 *
 * EL FALLO (2026-09-25, Javier): estando en «Sellos» aparecía «Café Plan», que
 * es una **Tarjeta de club**. La causa es que Alianzas y Club NO son tipos de
 * `CardType`: por dentro las dos son `STAMPS`, y lo que de verdad las distingue
 * es la plantilla de la que cuelgan (`convenioId` / `clubPlanId`).
 *
 * El filtro excluía la alianza —con su comentario explicándolo— y se olvidaba
 * del club. Por eso vive aquí y no suelto dentro del componente: es una regla,
 * tiene un caso que ya falló, y se puede probar.
 */

/**
 * @param {{ type?: string, convenioId?: unknown, clubPlanId?: unknown }} tarjeta
 * @param {'all'|'alianza'|'club'|string} filtro
 * @returns {boolean}
 */
export function coincideElTipo(tarjeta, filtro) {
  const esAlianza = Boolean(tarjeta?.convenioId);
  const esClub = Boolean(tarjeta?.clubPlanId);

  // «Todos los tipos» no enseña las alianzas: no son tarjetas que el dueño
  // gestione desde aquí, y mezclarlas fue justo lo que sobraba. Se ven pidiendo
  // su ficha a propósito. Las de club SÍ se quedan: esas sí son suyas.
  if (filtro === 'all') return !esAlianza;
  if (filtro === 'alianza') return esAlianza;
  if (filtro === 'club') return esClub;

  // Un tipo real del catálogo (Sellos, Cupón, Puntos…). Ni alianzas ni clubes,
  // aunque por dentro sean `STAMPS`: cada uno tiene su propia pestaña, y aquí
  // saldrían con el contador congelado y sin poder gestionarse.
  return tarjeta?.type === filtro && !esAlianza && !esClub;
}

/**
 * ¿Este cartón está roto por no tener tope configurado?
 *
 * EL CASO REAL (producción, 2026-09-26): «Descomunal - Cocina y SportBar»
 * reparte una tarjeta por «Desgranado de Pollo + Gaseosa» desde julio, con 59
 * pases y 54 instalados en teléfonos. `stampsRequired` está vacío, así que:
 *
 *  · el pase dice «8/10» — y ese 10 es un respaldo del código, no un número
 *    que el negocio eligiera;
 *  · el pase NO puede llegar nunca a «completa», porque la regla de estado se
 *    rinde sin tope. Nadie puede reclamar el pollo.
 *
 * Su dueño no tiene forma de enterarse: en su panel la tarjeta se ve normal.
 * Por eso el aviso.
 *
 * El club y la alianza quedan fuera aunque por dentro sean `STAMPS`: el club
 * usa el contador como cupo del mes y la alianza nace con tope 1 a propósito.
 * Avisar de ellas sería ruido, y el ruido se ignora.
 *
 * @param {{type?: string, stampsRequired?: number|null, visitsRequired?: number|null, convenioId?: string|null, clubPlanId?: string|null}} tarjeta
 * @returns {boolean}
 */
export function cartonSinTope(tarjeta) {
  if (!tarjeta) return false;
  if (tarjeta.convenioId || tarjeta.clubPlanId) return false;
  // `== null` a propósito: un tope de 0 es un valor, no un hueco. Con
  // `!tarjeta.stampsRequired` una tarjeta de 0 saldría avisada sin estarlo.
  if (tarjeta.type === 'STAMPS') return tarjeta.stampsRequired == null;
  if (tarjeta.type === 'VISITS') return tarjeta.visitsRequired == null;
  return false;
}
