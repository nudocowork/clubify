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
