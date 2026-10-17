import { ETIQUETA_DE_ROL } from './equipos';

/**
 * Textos derivados de cada fila del reporte. Puros: se prueban sin base.
 */

const DIA_MS = 86_400_000;

export type TipoDeVenta = 'NUEVA' | 'RENOVACION';

export const ETIQUETA_DE_TIPO_DE_VENTA: Record<TipoDeVenta, string> = {
  NUEVA: 'Venta nueva',
  RENOVACION: 'Renovación',
};

/**
 * ¿La comisión es de la venta inicial del negocio o de una renovación? Se mide
 * contra el PRIMER cobro pagado del negocio en Contabilidad (o, si no hay, su
 * fecha de compra): a ±3 días es la venta inicial — el mismo margen con el que
 * el motor decide «mismo cobro» (`referrals/clave-del-periodo.ts`). Sin ninguna
 * de las dos fechas no se sabe, y no se adivina.
 */
export function tipoDeVenta(
  fecha: Date | string,
  primerCobro: Date | string | null | undefined,
): TipoDeVenta | null {
  if (!primerCobro) return null;
  const d = new Date(fecha).getTime() - new Date(primerCobro).getTime();
  return d <= 3 * DIA_MS ? 'NUEVA' : 'RENOVACION';
}

/** Cómo va el CLIENTE (el negocio) con sus pagos, en una etiqueta corta. */
export function estadoDelCliente(t: {
  status: string | null | undefined;
  failedPaymentCount?: number | null;
  ultimoIngresoEstado?: string | null;
}): string {
  if (!t.status) return '—';
  if (t.status === 'SUSPENDED') return 'Suspendido';
  if (t.status === 'TRIAL') return 'En prueba';
  if ((t.failedPaymentCount ?? 0) > 0) {
    const n = t.failedPaymentCount ?? 0;
    return n === 1 ? 'Pago fallido' : `Pago fallido (${n} intentos)`;
  }
  if (t.ultimoIngresoEstado === 'REEMBOLSADO') return 'Último cobro reembolsado';
  if (t.ultimoIngresoEstado === 'CANCELADO') return 'Último cobro cancelado';
  return 'Al día';
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** La frase que explica de dónde sale una comisión. */
export function describirOperacion(c: {
  rol: string | null;
  colaborador: string;
  negocio: string | null;
  plan: string | null;
  tipoVenta: TipoDeVenta | null;
  baseUsd: number | null;
  porcentaje: number | null;
  montoUsd: number;
  esManual: boolean;
  tipoManual?: string | null;
  esDeEquipo: boolean;
}): string {
  const quien = `${c.colaborador}${c.rol && ETIQUETA_DE_ROL[c.rol] ? ` (${ETIQUETA_DE_ROL[c.rol].toLowerCase()})` : ''}`;
  const calculo =
    c.porcentaje != null && c.baseUsd != null && c.baseUsd > 0
      ? `${c.porcentaje}% sobre ${usd(c.baseUsd)} = ${usd(c.montoUsd)}`
      : `monto de ${usd(c.montoUsd)}`;
  if (c.esDeEquipo) {
    return `Comisión de equipo de ${quien}: ${calculo} (el porcentaje se aplica a las ventas de la quincena).`;
  }
  if (c.esManual) {
    const tipo = c.tipoManual ? c.tipoManual.toLowerCase() : 'manual';
    return `Comisión creada a mano (${tipo}) para ${quien}${c.negocio ? ` por ${c.negocio}` : ''}: ${calculo}.`;
  }
  const venta =
    c.tipoVenta === 'NUEVA' ? 'la venta nueva' : c.tipoVenta === 'RENOVACION' ? 'la renovación' : 'el cobro';
  const delPlan = c.plan ? ` del ${c.plan.replace(/^Plan /, 'plan ').toLowerCase()}` : '';
  return `Comisión de ${quien} por ${venta}${delPlan}${c.negocio ? ` de ${c.negocio}` : ''}: ${calculo}.`;
}
