/**
 * ¿Este pedido tiene repartidor?
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Un pedido hecho desde el enlace de una OFICINA (`/d/<slug>?oficina=…`) se
 * entrega dentro del coworking: lo lleva quien atiende, andando. No hay
 * repartidor, no hay empresa de domicilios y no hay nada que seguir. Pero el
 * pedido es `fulfillment = DELIVERY` —porque sale del menú de domicilio— así
 * que arrastraba todo el aparato del domicilio: «SEGUIMIENTO DEL DOMICILIO»
 * con sus cinco pasos («Buscando repartidor» → … → «Entregado»), la empresa
 * (DOMIRED) y el «CHAT DEL DOMICILIO», un chat sin nadie al otro lado.
 * Reportado con el pedido #YD6J7P de Nudo Cowork, hecho desde «Sala de
 * Juntas».
 *
 * La raíz se arregla en el backend —a un pedido de oficina ya no se le crea
 * seguimiento ni se le avisa a la empresa de domicilios— pero los pedidos que
 * YA tienen su seguimiento creado siguen en la base, así que la pantalla
 * también tiene que saber callarse. Las dos cosas, no una.
 *
 * Está fuera del componente (y en .mjs) para poder probarlo:
 * `node scripts/pruebas-pedido-en-oficina.mjs`.
 *
 * @typedef {{ status?: string, deliveryCompany?: unknown } | null} SeguimientoDelPedido
 * @typedef {{ status?: string, enOficina?: boolean, delivery?: SeguimientoDelPedido } | null | undefined} PedidoPublico
 */

/**
 * Pedido entregado en una oficina. `enOficina` lo marca el backend a partir de
 * la oficina guardada en el pedido; la dirección NO viaja en esta respuesta
 * —es pública por un código— así que aquí solo llega el sí o el no.
 *
 * Un payload viejo o cacheado no trae el campo: entonces es `false` y todo se
 * comporta igual que antes, que es lo correcto para los pedidos de siempre.
 *
 * @param {PedidoPublico} pedido
 */
export function esPedidoEnOficina(pedido) {
  return pedido?.enOficina === true;
}

/**
 * ¿Se pinta el seguimiento del domicilio?
 *
 * @param {PedidoPublico} pedido
 */
export function hayRepartidor(pedido) {
  if (!pedido) return false;
  if (pedido.status === 'CANCELLED') return false;
  // En la oficina no hay repartidor aunque exista el seguimiento: los pedidos
  // anteriores al arreglo lo tienen creado en la base.
  if (esPedidoEnOficina(pedido)) return false;
  const seguimiento = pedido.delivery;
  if (!seguimiento || seguimiento.status === 'CANCELLED') return false;
  return true;
}

/**
 * ¿Se pinta el chat del domicilio?
 *
 * Además de haber repartidor hace falta EMPRESA asignada: sin ella el chat no
 * tiene con quién hablar. Eso ya estaba —salía en negocios de Sellea que no
 * usan domicilios— y se conserva tal cual.
 *
 * @param {PedidoPublico} pedido
 */
export function hayChatDelDomicilio(pedido) {
  return hayRepartidor(pedido) && !!pedido?.delivery?.deliveryCompany;
}
