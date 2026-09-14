/**
 * NIVEL del producto InfoLink (freemium de Sellea Infolinks).
 * ESPEJO de backend/src/common/infolink-tier.ts — mantener sincronizado.
 *
 *   FREE = captación (0 créditos, con publicidad de Sellea y límites).
 *   PRO  = pago del usuario final (0.1 créditos/mes, sin publicidad, todo).
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

/**
 * Cómo se nombra el TIPO de un negocio en el panel.
 *
 * «Solo InfoLink» a secas no decía lo único que hace falta saber para cobrar:
 * si esa cuenta es de las gratuitas (captación, 0 créditos) o de las que pagan.
 * Lo preguntó Javier el 2026-09-14 mirando a Fressh, y no se podía contestar
 * desde la tabla. Un InfoLink sin nivel guardado es legacy y cuenta como PRO,
 * igual que en el motor de créditos.
 */
export function tipoDeNegocioEtiqueta(
  businessType: string | null | undefined,
  infolinkTier: string | null | undefined,
): { texto: string; infolink: boolean; gratis: boolean } {
  if (businessType !== 'INFOLINK') {
    return { texto: 'Completo', infolink: false, gratis: false };
  }
  const gratis = normalizeInfolinkTier(infolinkTier) === 'FREE';
  return {
    texto: gratis ? 'InfoLink Free' : 'InfoLink PRO',
    infolink: true,
    gratis,
  };
}
