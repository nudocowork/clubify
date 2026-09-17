/**
 * La parte del SOCIO en la cascada de utilidad.
 *
 * Dentro de Clubify hay un socio directo que se lleva un porcentaje. La base la
 * fijó Sara el 2026-09-17: **«el % del socio sale del monto de la utilidad»** —
 * lo que queda tras fee e impuestos, egresos, nómina y comisiones pagadas—. La
 * primera versión (misma mañana) lo calculaba sobre el neto de las ventas, que
 * era lo entendido entonces: con nómina o comisiones de por medio daba bastante
 * más, así que la diferencia importa.
 *
 * Un mes en pérdida no le genera deuda: su parte es cero, no negativa.
 *
 * Es del socio de CLUBIFY: con «todas las marcas» sigue saliendo solo de la
 * utilidad de Clubify —su neto, sus egresos y su nómina—. Ni las ventas ni los
 * costos de una marca blanca son suyos. (Las comisiones de afiliados todavía no
 * se separan por marca: son el costo de la plataforma entera, decisión v1.)
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Porcentaje: primero el ajuste propio de Contabilidad; si no hay, el del socio
 * que ya se configura en Referidos (`referrals.socioPercent`, el mismo que usa
 * el libro de comisiones), para que cambiarlo donde siempre se cambió llegue
 * aquí. Sin ninguno, el 10 %.
 */
export const CLAVE_PORCENTAJE_SOCIO = 'contabilidad.socio.porcentaje';
export const CLAVE_PORCENTAJE_SOCIO_REFERIDOS = 'referrals.socioPercent';
export const PORCENTAJE_SOCIO_POR_DEFECTO = 10;

/**
 * El motor de comisiones YA sabe crear comisiones del rol SOCIO en cada cobro
 * (`generateSocioCommission`, si se configura `referrals.socioCodeId`). Hoy está
 * apagado, pero si alguien lo enciende esas filas entrarían en «Comisiones
 * pagadas» Y en la línea «Socio»: el socio se restaría dos veces. Las
 * comisiones de la cascada lo excluyen. Una comisión sin destinatario (legacy)
 * sigue contando: `NOT … is` no la descarta.
 */
export const NO_ES_COMISION_DEL_SOCIO = {
  NOT: { recipientCode: { is: { role: 'SOCIO' as const } } },
};

/** Un porcentaje entre 0 y 100 (acepta coma decimal); cualquier otra cosa, el 10 %. */
export function porcentajeValido(raw: string | null | undefined): number {
  const n = Number(String(raw ?? '').trim().replace(',', '.'));
  if (raw == null || String(raw).trim() === '' || !Number.isFinite(n) || n < 0 || n > 100) {
    return PORCENTAJE_SOCIO_POR_DEFECTO;
  }
  return n;
}

export async function porcentajeDelSocio(prisma: {
  setting: { findUnique: (args: { where: { key: string } }) => Promise<{ value: string } | null> };
}): Promise<number> {
  for (const key of [CLAVE_PORCENTAJE_SOCIO, CLAVE_PORCENTAJE_SOCIO_REFERIDOS]) {
    const fila = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
    if (fila?.value != null && String(fila.value).trim() !== '') return porcentajeValido(fila.value);
  }
  return PORCENTAJE_SOCIO_POR_DEFECTO;
}

/**
 * Lo que le toca de la utilidad (antes de su propia parte). Con la utilidad en
 * negativo, cero: un mes malo no le genera deuda al socio.
 */
export function parteDelSocio(utilidadUsd: number, porcentaje: number): number {
  return round2((Math.max(utilidadUsd, 0) * porcentaje) / 100);
}
