/**
 * ¿El último respaldo es lo bastante reciente, o volvimos a quedarnos sin red?
 *
 * Existe por una cifra concreta: el respaldo nocturno estuvo fallando
 * 135 noches SEGUIDAS (del 13 de mayo a fin de septiembre de 2026) y nadie se
 * enteró, porque el único aviso de fallo dependía de un Sentry que tampoco
 * estaba configurado. El fallo de fondo no fue el backup: fue que su ausencia
 * no hacía ruido en ningún sitio que alguien mirara.
 *
 * Por eso esto NO vigila que el job de respaldo «corra»: vigila el RESULTADO —
 * que exista un objeto reciente en el bucket. Da igual si el job murió, si
 * alguien borró los secretos o si el cron de GitHub se desactivó solo (pasa,
 * tras 60 días sin commits): sin objeto fresco, suena.
 */

/** Qué encontró la comprobación, ya decidido. */
export type EstadoDelRespaldo =
  | { ok: true }
  | { ok: false; motivo: string };

/**
 * @param masReciente `null` = no hay NINGÚN objeto de respaldo.
 * @param ahora       inyectado para poder probar sin relojes de mentira.
 * @param horasMax    26 y no 24: el respaldo corre a las 03:00 UTC y esta
 *                    revisión a las 13:00 UTC, así que uno sano siempre tiene
 *                    ~10 h. Con 24 justas, un job que un día tarde o se
 *                    reintente haría sonar la alarma sin motivo — y una alarma
 *                    que suena sin motivo se aprende a ignorar.
 */
export function respaldoVencido(
  masReciente: Date | null,
  ahora: Date,
  horasMax = 26,
): EstadoDelRespaldo {
  if (!masReciente) {
    return {
      ok: false,
      motivo:
        'No hay NINGÚN respaldo en el bucket. Si la base se pierde hoy, no hay vuelta.',
    };
  }
  const horas = (ahora.getTime() - masReciente.getTime()) / 3_600_000;
  if (horas > horasMax) {
    // En horas hasta los dos días: «27 horas» dice «anoche falló» mucho
    // mejor que «1 día(s)», que suena a menos de lo que es.
    const edad =
      horas >= 48 ? `${Math.floor(horas / 24)} día(s)` : `${Math.round(horas)} horas`;
    return {
      ok: false,
      motivo: `El último respaldo tiene ${edad} (el tope son ${horasMax} h). El nocturno lleva ese tiempo sin lograrlo.`,
    };
  }
  return { ok: true };
}
