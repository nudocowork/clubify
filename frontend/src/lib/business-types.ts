/**
 * TIPOS DE NEGOCIO (líneas de producto de Fidelity) — ESPEJO de
 * backend/src/common/business-types.ts. Mantener sincronizado.
 *
 * Un tipo define su costo en créditos por ciclo mensual (`creditCost`) y qué
 * módulos ve el dueño. Costo de un ciclo = creditCost × meses de la periodicidad.
 */
export type BusinessType = 'FULL' | 'INFOLINK';

export interface BusinessTypeDef {
  key: BusinessType;
  label: string;
  shortLabel: string;
  creditCost: number;
}

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeDef> = {
  FULL: { key: 'FULL', label: 'Negocio Completo', shortLabel: 'Completo', creditCost: 1 },
  INFOLINK: { key: 'INFOLINK', label: 'Solo InfoLink', shortLabel: 'InfoLink', creditCost: 0.25 },
};

export const DEFAULT_BUSINESS_TYPE: BusinessType = 'FULL';

export function normalizeBusinessType(t: string | null | undefined): BusinessType {
  return t === 'INFOLINK' ? 'INFOLINK' : 'FULL';
}

export function businessTypeLabel(t: string | null | undefined): string {
  return BUSINESS_TYPES[normalizeBusinessType(t)].label;
}

export function businessTypeShortLabel(t: string | null | undefined): string {
  return BUSINESS_TYPES[normalizeBusinessType(t)].shortLabel;
}

export function creditCostFor(t: string | null | undefined): number {
  return BUSINESS_TYPES[normalizeBusinessType(t)].creditCost;
}

export function isInfoLinkOnly(t: string | null | undefined): boolean {
  return normalizeBusinessType(t) === 'INFOLINK';
}

/** Meses de un ciclo según periodicidad (espejo de common/plan-period.ts). */
function bundleMonths(p: string | null | undefined): number {
  switch ((p || 'MENSUAL').toUpperCase()) {
    case 'TRIMESTRAL':
      return 3;
    case 'SEMESTRAL':
      return 6;
    case 'ANUAL':
      return 12;
    default:
      return 1;
  }
}

/** Costo total de un ciclo (créditos) = creditCost × meses. Ej InfoLink anual = 3. */
export function cycleCreditCost(
  type: string | null | undefined,
  periodicity: string | null | undefined,
): number {
  return Math.round(creditCostFor(type) * bundleMonths(periodicity) * 100) / 100;
}

/** Formatea créditos: entero sin decimales, fraccionado con hasta 2 (0.25, 8.75). */
export function formatCredits(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}
