/**
 * La parte del SOCIO en la cascada de utilidad.
 *
 * Dentro de Clubify hay un socio directo que se lleva un porcentaje. La base
 * DEPENDE DEL MES DE LA VENTA (Javier, 2026-10-01):
 *
 *   - Ventas hasta AGOSTO de 2026: el % sobre el BRUTO, el total de la venta
 *     sin descontar impuesto ni fee de pasarela. Es lo que se le venía dando
 *     desde mayo.
 *   - Ventas desde SEPTIEMBRE de 2026: el % sobre el NETO, lo que queda tras
 *     descontar impuesto y fee. Se le paga a fin de mes, revisado el mes.
 *
 * Ninguna de las dos resta egresos, nómina ni comisiones. Entre el 2026-09-17 y
 * el 2026-10-01 se calculó sobre la UTILIDAD (regla de Sara, que restaba las
 * tres): con la nómina de mayo ($1.667) le daba $0 ese mes, y junio-agosto
 * salían a $22–$84 en vez de $447–$494. Si alguien vuelve a pedir «sobre la
 * utilidad», ese es el precedente.
 *
 * Se aplica VENTA A VENTA, según su mes contable: un rango que cruce
 * septiembre suma bruto de un lado y neto del otro, sin promediar.
 *
 * Es del socio de CLUBIFY: con «todas las marcas» sigue saliendo solo de las
 * ventas de Clubify. Las de una marca blanca no son suyas.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Primer mes contable (Bogotá) en el que la base del socio es el NETO. */
export const MES_DESDE_EL_NETO = '2026-09';

/**
 * La base del socio de UNA venta: su bruto si es de antes de septiembre de
 * 2026, su neto desde entonces. `mes` es su mes contable, `YYYY-MM`.
 */
export function baseDelSocio(mes: string, brutoUsd: number, netoUsd: number): number {
  return mes < MES_DESDE_EL_NETO ? brutoUsd : netoUsd;
}

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
 * Lo que le toca: el porcentaje de su base (la suma de `baseDelSocio` de las
 * ventas del período). Nunca negativo.
 */
export function parteDelSocio(baseUsd: number, porcentaje: number): number {
  return round2((Math.max(baseUsd, 0) * porcentaje) / 100);
}
