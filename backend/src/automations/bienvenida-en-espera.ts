/**
 * LA BIENVENIDA ESPERA A QUE LA TARJETA ESTÉ EN EL WALLET.
 *
 * El fallo (Burrata, 2026-11-16, «no llega la notificación de bienvenida»): la
 * regla PASS_CREATED empujaba el push en el MISMO segundo en que se creaba el
 * pase, antes de que el cliente lo agregara a su Wallet. No había a quién
 * avisarle: en 30 días, casi ninguna bienvenida de la plataforma salió con
 * `delivered > 0` (Yummy Sushi 0 de 307, Drive Pizza 0 de 65). El iPhone
 * registra la tarjeta ~29 s después de emitida (mediana; p90 ~4 min).
 *
 * Peor en Apple: la Notification ya existía con `sentAt`, así que el .pkpass
 * que el cliente descargaba YA traía el saludo en `lastMessage`. Un push
 * posterior no cambiaba nada y el iPhone no mostraba aviso.
 *
 * Ahora la bienvenida nace EN ESPERA (`sentAt` null, `stats.pendiente`), el
 * .pkpass sale sin ella, y un cron la entrega cuando la tarjeta está instalada.
 * Al entregarla cambia el `lastMessage` → el iPhone muestra el aviso.
 */

/** Marca en `Notification.stats.pendiente` de una bienvenida en espera. */
export const BIENVENIDA_PENDIENTE = 'bienvenida';

/** Pasado esto sin instalar, la bienvenida ya no se envía (llegaría a destiempo). */
export const BIENVENIDA_CADUCA_MS = 48 * 60 * 60 * 1000;

/**
 * Google no avisa cuándo guarda el pase: solo sabemos que el cliente pulsó
 * «Guardar en Google Wallet». Se le da un minuto para terminar de guardarlo;
 * un mensaje a un objeto que todavía no está guardado no notifica.
 */
export const GOOGLE_MARGEN_MS = 60 * 1000;

export type PaseParaBienvenida = {
  walletPlatform: string | null;
  walletInstalledAt: Date | null;
  dispositivosApple: number;
};

/** ¿Ya hay a quién mandarle la bienvenida en este pase? */
export function paseListoParaBienvenida(p: PaseParaBienvenida, ahora: Date): boolean {
  // iPhone: Apple registró el dispositivo (y su token de push).
  if (p.dispositivosApple > 0) return true;
  // Google: el cliente pulsó guardar hace al menos un minuto.
  return (
    p.walletPlatform === 'GOOGLE' &&
    !!p.walletInstalledAt &&
    ahora.getTime() - p.walletInstalledAt.getTime() >= GOOGLE_MARGEN_MS
  );
}
