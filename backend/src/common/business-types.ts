import { bundleMonths } from './plan-period';

/**
 * TIPOS DE NEGOCIO (líneas de producto de Fidelity).
 *
 * Un tipo de negocio define su COSTO EN CRÉDITOS por ciclo mensual (`creditCost`)
 * y qué experiencia/módulos ve el dueño. El motor de créditos NO conoce valores
 * fijos "1": lee `creditCost` del tipo y calcula todo automáticamente. Para
 * agregar un tipo futuro (Solo Wallet, Solo Delivery, …) basta con sumar una
 * entrada acá — el resto del sistema no cambia.
 *
 * Convención de créditos del sistema: 1 crédito = 30 días (1 mes) de servicio
 * para un Negocio Completo. Un ciclo de renovación/activación cuesta
 *   creditCost × meses_del_ciclo (Mensual=1, Trimestral=3, Semestral=6, Anual=12)
 * Ej: InfoLink anual = 0.25 × 12 = 3 créditos; Completo anual = 1 × 12 = 12.
 *
 * ESPEJO: frontend/src/lib/business-types.ts — mantener sincronizado.
 */
export type BusinessType = 'FULL' | 'INFOLINK';

export interface BusinessTypeDef {
  key: BusinessType;
  /** Etiqueta larga para selectores y fichas. */
  label: string;
  /** Etiqueta corta para badges/columnas. */
  shortLabel: string;
  /** Créditos que consume por CICLO MENSUAL (base). Se multiplica por los meses
   *  de la periodicidad para obtener el costo de un ciclo completo. */
  creditCost: number;
}

export const BUSINESS_TYPES: Record<BusinessType, BusinessTypeDef> = {
  FULL: {
    key: 'FULL',
    label: 'Negocio Completo',
    shortLabel: 'Completo',
    creditCost: 1,
  },
  INFOLINK: {
    key: 'INFOLINK',
    label: 'Solo InfoLink',
    shortLabel: 'InfoLink',
    creditCost: 0.25,
  },
};

export const DEFAULT_BUSINESS_TYPE: BusinessType = 'FULL';

/** Normaliza cualquier valor (null/legacy/desconocido) a un BusinessType válido.
 *  Todo lo que no sea 'INFOLINK' se trata como 'FULL' (los negocios existentes
 *  nacen sin el campo → Completo). */
export function normalizeBusinessType(t: string | null | undefined): BusinessType {
  return t === 'INFOLINK' ? 'INFOLINK' : 'FULL';
}

export function businessTypeLabel(t: string | null | undefined): string {
  return BUSINESS_TYPES[normalizeBusinessType(t)].label;
}

/** Costo base (1 mes) en créditos del tipo de negocio. */
export function creditCostFor(t: string | null | undefined): number {
  return BUSINESS_TYPES[normalizeBusinessType(t)].creditCost;
}

/** Redondeo a 2 decimales para mantener limpia la representación de créditos
 *  fraccionados (0.25, 0.75, …) y evitar drift al acumular. Los cuartos de
 *  crédito son exactos en punto flotante, pero normalizamos por prolijidad. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Costo total en créditos de UN ciclo de renovación/activación, según el tipo
 * de negocio y la periodicidad del plan.
 *   = creditCost(tipo) × meses(periodicidad)
 * Mensual → creditCost; Anual → creditCost × 12. Es la ÚNICA fórmula que el
 * motor de créditos debe usar para cobrar/comprometer/liberar.
 */
export function cycleCreditCost(
  type: string | null | undefined,
  periodicity: string | null | undefined,
): number {
  return round2(creditCostFor(type) * bundleMonths(periodicity));
}
