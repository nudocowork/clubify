import { MES_DESDE_EL_NETO, parteDelSocio } from '../finance/socio';

/**
 * La parte del SOCIO que calcula Contabilidad, mostrada en el reporte de
 * comisiones SOLO COMO DATO.
 *
 * Por qué es informativa y no una comisión (bitácora 136, decisión de Javier
 * del 2026-10-17): el 10 % del socio ya se descuenta en Contabilidad con la
 * línea «Socio» (`finance/socio.ts`) y se le paga a fin de mes. Si además
 * naciera como fila de `Commission`, o se sumara al total, al cierre o a
 * «pendiente de pago» de este reporte, se le pagaría dos veces. Por eso este
 * objeto viaja APARTE de los totales y nada de `totales.ts` lo lee.
 *
 * La regla (bruto hasta septiembre de 2026, neto desde octubre, solo ventas
 * de Clubify, venta a venta) NO se repite aquí: la base llega ya calculada por
 * `IncomeRecordService.summary` —la misma consulta que usa la cascada de
 * Contabilidad— y aquí solo se aplica `parteDelSocio` y se etiqueta.
 */

/**
 * Contabilidad no guarda A QUIÉN corresponde la línea «Socio»: es un
 * porcentaje sin destinatario (ni código ni usuario). Hoy ese socio es Javier
 * (bitácora 136), así que se nombra en el texto. Si un día hay otro socio, la
 * etiqueta se cambia aquí y en ningún otro sitio.
 */
export const NOMBRE_DEL_SOCIO_DE_CONTABILIDAD = 'Socio (Javier)';

export const NOTA_SOCIO_DE_CONTABILIDAD =
  'Se paga desde Contabilidad a fin de mes — no es una comisión del corte.';

/** Sobre qué se calculó: depende del mes de cada venta. */
export type BaseDelSocio = 'BRUTO' | 'NETO' | 'MIXTA';

export const ETIQUETA_DE_BASE: Record<BaseDelSocio, string> = {
  BRUTO: 'Bruto (ventas hasta septiembre de 2026)',
  NETO: 'Neto (ventas desde octubre de 2026)',
  MIXTA: 'Bruto hasta septiembre de 2026 y neto desde octubre, venta a venta',
};

export type SocioDeContabilidad = {
  nombre: string;
  montoUsd: number;
  porcentaje: number;
  baseUsd: number;
  base: BaseDelSocio;
  baseEtiqueta: string;
  nota: string;
  /** Siempre `true`: marca para quien lo lea que NO entra en ningún total. */
  informativo: true;
};

/**
 * Qué base aplica a un rango de días de Bogotá (`YYYY-MM-DD`). Sin «desde» el
 * rango empieza en el pasado (lado del bruto); sin «hasta», llega a hoy.
 */
export function baseDelRango(desde: string | undefined, hasta: string | undefined, hoy: string): BaseDelSocio {
  const mesDesde = desde ? desde.slice(0, 7) : null;
  const mesHasta = (hasta ?? hoy).slice(0, 7);
  if (mesHasta < MES_DESDE_EL_NETO) return 'BRUTO';
  if (mesDesde && mesDesde >= MES_DESDE_EL_NETO) return 'NETO';
  return 'MIXTA';
}

export function socioDeContabilidad(p: {
  baseUsd: number;
  porcentaje: number;
  desde?: string;
  hasta?: string;
  hoy: string;
}): SocioDeContabilidad {
  const base = baseDelRango(p.desde, p.hasta, p.hoy);
  return {
    nombre: NOMBRE_DEL_SOCIO_DE_CONTABILIDAD,
    montoUsd: parteDelSocio(p.baseUsd, p.porcentaje),
    porcentaje: p.porcentaje,
    baseUsd: Math.round(p.baseUsd * 100) / 100,
    base,
    baseEtiqueta: ETIQUETA_DE_BASE[base],
    nota: NOTA_SOCIO_DE_CONTABILIDAD,
    informativo: true,
  };
}
