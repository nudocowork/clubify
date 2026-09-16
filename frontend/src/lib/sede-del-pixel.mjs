/**
 * La sede, dentro de los eventos del píxel del negocio.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * De los cuatro eventos que manda el menú, solo la COMPRA llevaba la sede
 * (`content_category`), así que en Meta se podían comparar ventas por
 * sucursal pero no ver el embudo: que una sede recibe carritos que no se
 * cierran no se veía por ningún lado. Con la sede también en ViewContent,
 * AddToCart e InitiateCheckout, el embudo se puede desglosar entero.
 *
 * Y llevaba el ID: en los informes de Meta se leía «50bb2564-19a0-467f-…»,
 * que no le dice nada a quien paga los anuncios. Ahora `content_category` es
 * el NOMBRE («Sambil Margarita») y el id viaja aparte en `sede_id`, que es
 * la llave estable por si hace falta cruzar datos.
 *
 * Está aquí y no dentro de `pixel-del-negocio.ts` para poder probarlo: ese
 * módulo toca `window.fbq` y no se puede importar desde node.
 * `node scripts/pruebas-pixel-por-sede.mjs`.
 *
 * @typedef {{ id?: string | null, nombre?: string | null } | null | undefined} SedeDelPixel
 */

/**
 * Añade la sede a los parámetros de un evento.
 *
 * Tres reglas, y las tres importan:
 *
 * 1. Sin sede resuelta NO se inventa nada: un negocio de una sola sede —o sin
 *    ninguna— manda exactamente los mismos parámetros que antes. Es la
 *    diferencia entre añadir una dimensión y ensuciar los datos de todos.
 * 2. Lo que ya venga puesto MANDA. Si algún día un evento trae su propio
 *    `content_category`, no se le pisa.
 * 3. El nombre es lo que se lee; el id es lo que no cambia aunque el negocio
 *    renombre la sucursal. Por eso van los dos.
 *
 * @param {Record<string, unknown> | undefined} params
 * @param {SedeDelPixel} sede
 * @returns {Record<string, unknown>}
 */
export function paramsConSede(params, sede) {
  const p = { ...(params ?? {}) };
  const id = (sede?.id ?? '').trim();
  const nombre = (sede?.nombre ?? '').trim();
  // Sin id no hay sede: un nombre suelto no identifica nada y no se manda.
  if (!id) return p;
  if (p.content_category == null) {
    // El nombre si lo sabemos; el id como respaldo, que es lo que se mandaba
    // antes y siempre es mejor que dejar el evento sin desglose.
    p.content_category = nombre || id;
  }
  if (p.sede_id == null) p.sede_id = id;
  return p;
}
