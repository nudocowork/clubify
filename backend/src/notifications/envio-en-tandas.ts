/**
 * Lo que comparten los tres caminos que empujan un mensaje a muchos pases:
 * el envío inmediato, el programado de fecha única y el recurrente.
 *
 * El recurrente se quedó con el bucle en fila india cuando los otros dos ya
 * iban por tandas (lo dejó anotado el arreglo de 2026-09-11), y era justo el
 * que más se usa: 145 envíos en dos semanas, contra 4 de fecha única.
 */

/**
 * De cuántos pases en cuántos. El push de un pase es casi todo espera de red
 * (Google y APNs). Con varias recurrencias a la misma hora corren a la vez,
 * así que esto se multiplica: no subirlo sin mirar la cuota de la API de
 * Google Wallet.
 */
export const CONCURRENCIA_DEL_PUSH = 6;

/** Recorre `items` de `n` en `n`, esperando cada tanda. */
export async function enTandas<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
  }
}

/**
 * Cuántas notificaciones salieron de verdad en el push de UN pase.
 *
 * Apple: los dispositivos a los que APNs aceptó el aviso (`sent`).
 * Google: solo si salió la NOTIFICACIÓN (`notified`, el `addMessage`), no si
 * se actualizó la tarjeta. Antes contaba `ok`, que es «se pudo escribir el
 * pase»: con el `addMessage` fallando, el panel habría dicho «entregado» a
 * un cliente al que no le sonó nada.
 */
export function entregadosDelPush(
  r: { sent?: number; google?: { ok?: boolean; notified?: boolean } } | null | undefined,
): number {
  return (r?.sent ?? 0) + (r?.google?.notified ? 1 : 0);
}
