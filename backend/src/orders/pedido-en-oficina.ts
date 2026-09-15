/**
 * Pedido hecho desde el enlace de una OFICINA: `/d/<slug>?oficina=<id de la carta>`.
 *
 * Por qué existe: Nudo Cowork tiene varias oficinas y quiere un menú en cada
 * una. Quien pide desde NUDO ESTUDIO está sentado en NUDO ESTUDIO: pedirle
 * departamento, municipio y dirección de calle no tiene sentido, y el negocio
 * lo que necesita saber es a qué oficina llevarlo. Hasta ahora el enlace de la
 * carta abría la carta correcta, pero el checkout exigía una dirección y el
 * pedido llegaba sin oficina: el nombre de la carta se perdía por el camino.
 *
 * La oficina ES una carta (`Menu`), el mecanismo que ya existía; no hay tabla
 * nueva. Y se guarda DENTRO de `deliveryAddress`, porque es el destino del
 * pedido: así el detalle en Pedidos, el mensaje al domiciliario y el aviso a
 * la empresa de domicilios —que leen `direccion`— la enseñan como destino sin
 * tocar cada uno de ellos.
 *
 * Es opt-in POR ENLACE (`?oficina=`), no por carta: los `?sede=` que ya están
 * impresos siguen pidiendo dirección exactamente igual que antes.
 */
export type OficinaDelPedido = { id: string; nombre: string };

/**
 * El destino de un pedido a una oficina. Lo arma el SERVIDOR con el nombre de
 * la carta: si lo mandara el cliente, cualquiera podría escribir otra oficina
 * —o una calle— y el negocio lo llevaría a donde no es.
 */
export function direccionDeOficina(
  oficina: OficinaDelPedido,
  customer: { phone?: string | null },
): Record<string, unknown> {
  const phone = (customer.phone ?? '').trim();
  return {
    oficina: { id: oficina.id, nombre: oficina.nombre },
    direccion: oficina.nombre,
    ...(phone ? { phone } : {}),
  };
}

/** La oficina guardada en un pedido, si la tiene. Los pedidos de siempre dan null. */
export function oficinaDelPedido(addr: unknown): OficinaDelPedido | null {
  if (!addr || typeof addr !== 'object') return null;
  const o = (addr as Record<string, unknown>).oficina;
  if (!o || typeof o !== 'object') return null;
  const { id, nombre } = o as Record<string, unknown>;
  if (typeof nombre !== 'string' || !nombre.trim()) return null;
  return { id: typeof id === 'string' ? id : '', nombre: nombre.trim() };
}
