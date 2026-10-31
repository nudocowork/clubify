/**
 * Reglas puras del Sales Wall (la pantalla de ventas para la TV de la oficina):
 * qué cuenta como venta y qué como renovación, quién la vendió y cómo se
 * nombra el plan. Fuera del servicio para probarlas sin base de datos.
 */

import { esPruebaGratisHotmart } from '../billing/prueba-gratis-hotmart';

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

/**
 * Un pago de Hotmart sin cuenta que el muro puede anunciar como venta.
 * El ingreso nace al activar el negocio, a veces horas después del pago, y
 * Javier quiere el aviso cuando entra la compra (2026-10-31).
 *
 * Por ese mismo producto se cobran servicios sueltos, y también caen aquí sin
 * negocio (`notifyPendingRecovery`). Por eso se exige suscripción y comprador
 * sin cuenta: si hay duda no se anuncia, y la venta avisa al activarse.
 */
export function esCompraPorActivar(pago: {
  subscriberCode: string | null;
  rawPayload: unknown;
  compradorTieneCuenta: boolean;
}): boolean {
  if (!pago.subscriberCode || pago.compradorTieneCuenta) return false;
  if (esPruebaGratisHotmart(pago.rawPayload)) return false;
  const compra = (pago.rawPayload as { data?: { purchase?: { recurrence_number?: unknown } } } | null)?.data?.purchase;
  return !(Number(compra?.recurrence_number) > 1);
}

/** El nombre que trae Hotmart: la periodicidad se resuelve al activar. */
export function planDelPago(rawPayload: unknown): string {
  const plan = (rawPayload as { data?: { subscription?: { plan?: { name?: unknown } } } } | null)?.data?.subscription?.plan?.name;
  return typeof plan === 'string' ? plan.trim() : '';
}

/** «Plan Trimestral». La Mensualidad básica (USD 25) se nombra aparte. */
export function nombreDelPlan(periodicidad: string | null | undefined, montoUsd: number): string {
  const p = (periodicidad ?? '').toUpperCase();
  if (p === 'MENSUAL' && montoUsd > 0 && montoUsd <= 30) return 'Mensualidad básica';
  return NOMBRE_DEL_PLAN[p] ?? '';
}
