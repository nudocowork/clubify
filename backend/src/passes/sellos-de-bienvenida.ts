/**
 * Con cuántos sellos arranca un pase NUEVO.
 *
 * Dos fuentes, por orden:
 *  1. El enlace de campaña (UTM) por el que llegó, si trae sellos y sigue
 *     vigente: es lo más específico, el negocio lo armó para ESA campaña.
 *  2. Los «sellos al instalar» de la tarjeta (`Card.welcomeStamps`).
 *
 * Tope: uno menos que el cartón. Un pase que nace lleno no pasa por el sello
 * que dispara PASS_COMPLETED, así que el cliente tendría el premio sin el
 * aviso de «premio desbloqueado» y el negocio lo vería «8/8» sin canje. El
 * premio sale siempre por un sello real.
 *
 * Una tarjeta sin cartón (puntos, cashback, cupón…) no usa sellos: el valor de
 * la tarjeta no aplica. El del enlace se respeta como siempre se respetó.
 */
export function sellosDeBienvenida(
  card: {
    type: string;
    stampsRequired?: number | null;
    visitsRequired?: number | null;
    welcomeStamps?: number | null;
  },
  sellosDelEnlace = 0,
): number {
  const delEnlace = Math.max(0, Math.trunc(sellosDelEnlace || 0));
  const tope = card.type === 'VISITS' ? card.visitsRequired : card.stampsRequired;
  if (!tope || tope <= 0) return delEnlace;
  const pedido = delEnlace > 0 ? delEnlace : Math.max(0, Math.trunc(card.welcomeStamps ?? 0));
  return Math.min(pedido, tope - 1);
}
