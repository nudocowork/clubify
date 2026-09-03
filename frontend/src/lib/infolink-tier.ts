/**
 * NIVEL del producto InfoLink (freemium de Sellea Infolinks).
 * ESPEJO de backend/src/common/infolink-tier.ts — mantener sincronizado.
 *
 *   FREE = captación (0 créditos, con publicidad de Sellea y límites).
 *   PRO  = pago del usuario final (0.25 créditos/mes, sin publicidad, todo).
 *
 * FULL (Negocio Completo) incluye el InfoLink al máximo (como PRO). INFOLINK con
 * tier null es legacy → se trata como PRO (nunca se le quitan funciones).
 */
export type InfolinkTier = 'FREE' | 'PRO';

export interface InfolinkCapabilities {
  tier: InfolinkTier;
  /** Máximo de botones activos. null = ilimitado. */
  maxButtons: number | null;
  showSelleaAds: boolean;
  removeBranding: boolean;
  customColors: boolean;
  customBackground: boolean;
  allTemplates: boolean;
  customIcons: boolean;
  advancedAnalytics: boolean;
  monthlyCreditCost: number;
}

export function normalizeInfolinkTier(t: string | null | undefined): InfolinkTier {
  return t === 'FREE' ? 'FREE' : 'PRO';
}

export function infolinkCapabilities(
  businessType: string | null | undefined,
  infolinkTier: string | null | undefined,
): InfolinkCapabilities {
  const isFull = businessType !== 'INFOLINK';
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
    monthlyCreditCost: isFull ? 1 : pro ? 0.1 : 0,
  };
}
