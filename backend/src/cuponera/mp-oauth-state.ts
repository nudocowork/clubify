import { createHmac, timingSafeEqual } from 'crypto';

/**
 * El `state` del OAuth de MercadoPago.
 *
 * El callback (`/cuponera/mp/oauth/callback`) es público: llega por la
 * redirección del navegador del vendedor. Lo ÚNICO que dice a qué cuponera
 * pertenecen las credenciales es este state, así que va firmado: sin firma,
 * cualquiera podría pegar SUS credenciales de MP en la cuponera de otro y
 * quedarse con los cobros. MP además exige que no lleve información sensible
 * y que sea único por intento.
 *
 * Formato: `<campaignId>.<vence epoch s>.<nonce>.<hmac>`. La clave es el
 * Client Secret de la aplicación de MP: existe exactamente cuando el OAuth
 * está configurado y nunca viaja en el state.
 */
const TTL_SEGUNDOS = 15 * 60; // el código de MP vive 10 min; el state, un poco más.

export function firmarEstadoOauth(secret: string, campaignId: string, ahoraMs = Date.now()): string {
  const vence = Math.floor(ahoraMs / 1000) + TTL_SEGUNDOS;
  const nonce = Math.random().toString(36).slice(2, 10);
  const base = `${campaignId}.${vence}.${nonce}`;
  const firma = createHmac('sha256', secret).update(base).digest('hex');
  return `${base}.${firma}`;
}

/** Devuelve el campaignId si la firma es válida y no venció; null si no. */
export function verificarEstadoOauth(
  secret: string,
  state: string | undefined | null,
  ahoraMs = Date.now(),
): string | null {
  if (!state) return null;
  const partes = state.split('.');
  if (partes.length !== 4) return null;
  const [campaignId, venceStr, nonce, firma] = partes;
  const vence = Number(venceStr);
  if (!campaignId || !Number.isFinite(vence) || !firma) return null;
  if (vence * 1000 < ahoraMs) return null;
  const esperada = createHmac('sha256', secret)
    .update(`${campaignId}.${venceStr}.${nonce}`)
    .digest('hex');
  const a = Buffer.from(firma, 'utf8');
  const b = Buffer.from(esperada, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return campaignId;
}
