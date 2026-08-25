import { normalizeBusinessType, creditCostFor } from './business-types';

/**
 * NIVEL del producto InfoLink (freemium de Sellea Infolinks).
 *   FREE = captación (0 créditos, con publicidad de Sellea y límites).
 *   PRO  = pago del usuario final (0.25 créditos/mes, sin publicidad, todo).
 *
 * Este archivo es la ÚNICA fuente de verdad de qué puede hacer cada tier.
 * ESPEJO: frontend/src/lib/infolink-tier.ts — mantener sincronizado.
 *
 * Regla de compat: un negocio FULL (Negocio Completo) YA incluye el InfoLink en
 * su máximo nivel (sin publicidad); un INFOLINK con tier null es legacy y se
 * trata como PRO (nunca le quitamos funciones a cuentas existentes).
 */
export type InfolinkTier = 'FREE' | 'PRO';

export interface InfolinkCapabilities {
  tier: InfolinkTier;
  /** Máximo de botones activos. null = ilimitado. */
  maxButtons: number | null;
  /** Muestra el bloque "Creado con Sellea" (publicidad). */
  showSelleaAds: boolean;
  /** Puede quitar el branding de Sellea (== !showSelleaAds). */
  removeBranding: boolean;
  /** Colores de texto/acento personalizados (más allá de los presets). */
  customColors: boolean;
  /** Fondo personalizado (imagen / color libre). */
  customBackground: boolean;
  /** Acceso a todas las plantillas (no solo las básicas). */
  allTemplates: boolean;
  /** Iconos personalizados en botones. */
  customIcons: boolean;
  /** Analítica avanzada (fuentes, visitantes únicos, histórico completo). */
  advancedAnalytics: boolean;
  /** Créditos de plataforma que consume por mes (FREE=0, PRO=0.25, FULL=1). */
  monthlyCreditCost: number;
}

/** Normaliza cualquier valor a un tier válido. Null/legacy → PRO (no restringe). */
export function normalizeInfolinkTier(t: string | null | undefined): InfolinkTier {
  return t === 'FREE' ? 'FREE' : 'PRO';
}

/**
 * Capacidades efectivas del InfoLink de un negocio, según su tipo y tier.
 * - FULL: el InfoLink va a máximo nivel (como PRO), sin publicidad.
 * - INFOLINK + tier: FREE limitado / PRO completo (null → PRO por compat).
 */
export function infolinkCapabilities(
  businessType: string | null | undefined,
  infolinkTier: string | null | undefined,
): InfolinkCapabilities {
  const isFull = normalizeBusinessType(businessType) === 'FULL';
  const tier: InfolinkTier = isFull ? 'PRO' : normalizeInfolinkTier(infolinkTier);
  const pro = tier === 'PRO';
  return {
    tier,
    maxButtons: pro ? null : 5,
    showSelleaAds: !pro,
    removeBranding: pro,
    customColors: pro,
    customBackground: pro,
    allTemplates: pro,
    customIcons: pro,
    advancedAnalytics: pro,
    // FREE = 0. PRO = costo del InfoLink. FULL = costo del negocio completo.
    // Lee de la fuente única (business-types) para no duplicar el valor.
    monthlyCreditCost: !pro ? 0 : creditCostFor(isFull ? 'FULL' : 'INFOLINK'),
  };
}
