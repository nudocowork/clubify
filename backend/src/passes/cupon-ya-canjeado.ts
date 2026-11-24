/**
 * ¿Este cliente ya canjeó ESTE cupón de un uso?
 *
 * Por qué existe (2026-11-24): al canjear un cupón de bienvenida el pase se
 * TRANSFORMA en la tarjeta de sellos (mismo pase, otro `cardId`). La única
 * guarda del registro era «¿tiene pase en esta tarjeta?», y ya no lo tenía: al
 * volver a abrir el enlace del cupón recibía OTRO café gratis. 21 casos en 7
 * negocios (Limorada 7, Café Macondo 4, Konys 3, &N COFFEE 3…); John Fredy
 * Velandia, en &N, lo recibió 9 minutos después de canjear el primero.
 *
 * El rastro es el sello del canje: desde 2026-11-24 guarda la tarjeta del
 * cupón (`Stamp.cardId`). Para los canjes anteriores (sin `cardId`) solo se
 * concluye si el negocio tiene UNA sola tarjeta de cupón de un uso: con
 * varias, un canje viejo no dice de cuál fue y no se le niega al cliente un
 * cupón distinto.
 *
 * Devuelve el pase al que fue a parar aquel cupón (su tarjeta de sellos) para
 * mostrárselo en vez de un cupón nuevo; null si puede recibirlo.
 */
export const TIPOS_DE_UN_USO = ['COUPON', 'DISCOUNT', 'GIFT'] as const;

type Db = any;

export async function canjeAnteriorDelCupon(
  db: Db,
  card: { id: string; tenantId: string; type: string; couponIndefinido?: boolean | null },
  customerId: string,
): Promise<{ passId: string } | null> {
  if (!(TIPOS_DE_UN_USO as readonly string[]).includes(card.type)) return null;
  // Un cupón indefinido se usa cada visita: no hay «ya lo canjeó».
  if (card.couponIndefinido) return null;
  const base = { tenantId: card.tenantId, customerId, action: 'REDEEM', redeemKind: 'COUPON' };

  const exacto = await db.stamp.findFirst({
    where: { ...base, cardId: card.id },
    orderBy: { createdAt: 'desc' },
    select: { passId: true },
  });
  if (exacto) return { passId: exacto.passId };

  const viejo = await db.stamp.findFirst({
    where: { ...base, cardId: null },
    orderBy: { createdAt: 'desc' },
    select: { passId: true },
  });
  if (!viejo) return null;
  const cupones = await db.card.count({
    where: { tenantId: card.tenantId, type: { in: [...TIPOS_DE_UN_USO] }, couponIndefinido: false },
  });
  return cupones === 1 ? { passId: viejo.passId } : null;
}
