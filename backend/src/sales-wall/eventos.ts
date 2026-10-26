/**
 * Reglas puras del Sales Wall (la pantalla de ventas para la TV de la oficina):
 * qué cuenta como venta y qué como renovación, quién la vendió y cómo se
 * nombra el plan. Fuera del servicio para probarlas sin base de datos.
 */

export type TipoDeEvento = 'venta' | 'renovacion';

/** NUEVA = venta. RENOVACION y UPGRADE = un cliente que se queda. El resto
 *  (créditos, servicios sueltos) no es venta ni renovación y no sale. */
export function tipoDeIngreso(categoria: string | null | undefined): TipoDeEvento | null {
  const c = (categoria ?? '').toUpperCase();
  if (c === 'NUEVA') return 'venta';
  if (c === 'RENOVACION' || c === 'UPGRADE') return 'renovacion';
  return null;
}

/**
 * Quién vendió: el mismo orden que el reparto de comisiones —vendedor, luego
 * embajador, luego influencer—. Un socio no vende a nombre propio en la
 * pantalla. Sin nadie, «Venta directa».
 */
const PRIORIDAD: Record<string, number> = { VENDOR: 0, AMBASSADOR: 1, INFLUENCER: 2 };
export function afiliadoQueVendio(
  usos: Array<{ role: string; ownerName: string | null }>,
): string {
  const candidatos = usos
    .filter((u) => u.ownerName?.trim() && PRIORIDAD[u.role] !== undefined)
    .sort((a, b) => PRIORIDAD[a.role] - PRIORIDAD[b.role]);
  return candidatos[0]?.ownerName!.trim() ?? 'Venta directa';
}

const NOMBRE_DEL_PLAN: Record<string, string> = {
  MENSUAL: 'Plan Mensual',
  TRIMESTRAL: 'Plan Trimestral',
  SEMESTRAL: 'Plan Semestral',
  ANUAL: 'Plan Anual',
};

/** «Plan Trimestral». La Mensualidad básica (USD 25) se nombra aparte. */
export function nombreDelPlan(periodicidad: string | null | undefined, montoUsd: number): string {
  const p = (periodicidad ?? '').toUpperCase();
  if (p === 'MENSUAL' && montoUsd > 0 && montoUsd <= 30) return 'Mensualidad básica';
  return NOMBRE_DEL_PLAN[p] ?? '';
}
