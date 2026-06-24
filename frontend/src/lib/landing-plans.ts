import type { LandingPlan } from '@/components/LandingPricingCheckout';

export type { LandingPlan };

// Default fallback de planes — los reales se editan desde /admin/branding.
// Si la API no responde, mostramos estos para que la sección no quede
// vacía. checkoutUrl null → botón "Próximamente" deshabilitado.
//
// Compartido entre la landing (/) y el picker de /signup para que ambos
// muestren EXACTAMENTE los mismos 4 planes (mesa vs delivery del referido
// pedía "tal cual la página principal").
export const LANDING_PLAN_DEFAULTS: LandingPlan[] = [
  {
    id: 'mensual',
    name: 'Mensual',
    shortName: '1 mes',
    months: 1,
    price: 68,
    checkoutUrl: null,
    description: 'Sin compromiso. Cancela cuando quieras.',
  },
  {
    id: 'trimestral',
    name: 'Trimestral',
    shortName: '3 meses',
    months: 3,
    price: 150,
    checkoutUrl: null,
    description: 'Pagas cada 3 meses y ahorras frente al mensual.',
  },
  {
    id: 'semestral',
    name: 'Semestral',
    shortName: '6 meses',
    months: 6,
    price: 278,
    checkoutUrl: null,
    description: 'Compromiso de 6 meses con descuento significativo.',
  },
  {
    id: 'anual',
    name: 'Anual',
    shortName: '1 año',
    months: 12,
    price: 500,
    checkoutUrl: null,
    description: 'El mejor precio por mes. 1 año completo de Clubify.',
  },
];

const PERIOD_TO_PLAN: Record<
  string,
  { id: 'mensual' | 'trimestral' | 'semestral' | 'anual'; months: number }
> = {
  MENSUAL: { id: 'mensual', months: 1 },
  TRIMESTRAL: { id: 'trimestral', months: 3 },
  SEMESTRAL: { id: 'semestral', months: 6 },
  ANUAL: { id: 'anual', months: 12 },
};

/**
 * Planes de una MARCA BLANCA resueltos por host (dominio propio): usa los
 * WhiteLabelPaymentLink de la marca (su gateway/precios/links Stripe), NUNCA
 * los de Clubify. Devuelve null si el host es Clubify/dev o la marca no tiene
 * links → el caller cae a fetchLandingPlans() (Clubify). Aísla los planes por
 * marca tanto en la landing como en /signup.
 */
export async function fetchBrandPlansByHost(
  host: string,
): Promise<LandingPlan[] | null> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
  const h = (host || '').toLowerCase().split(':')[0];
  if (
    !h ||
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.endsWith('soyclubify.com') ||
    h.endsWith('clubify.app')
  ) {
    return null;
  }
  try {
    const r = await fetch(
      `${API}/api/superadmin-public/white-labels/payment-links-by-host?host=${encodeURIComponent(h)}`,
      { next: { revalidate: 60 } },
    );
    if (!r.ok) return null;
    const d: any = await r.json();
    if (!d || !Array.isArray(d.links) || !d.links.length) return null;
    const plans: LandingPlan[] = [];
    for (const l of d.links) {
      const m = PERIOD_TO_PLAN[l.periodicity as string];
      if (!m) continue; // CUSTOM u otros no se muestran en el selector
      plans.push({
        id: m.id,
        name: l.name || m.id,
        shortName: l.name || m.id,
        months: m.months,
        price: Number(l.amountUsd) || 0,
        checkoutUrl: l.url || null,
        description: '',
      });
    }
    return plans.length ? plans : null;
  } catch {
    return null;
  }
}

/**
 * Fetcha los 4 planes del backend y los fusiona con los defaults
 * (preservando name/months/description/shortName, que el backend no
 * devuelve). Tolerante a fallos: cae a los defaults si la API no responde.
 */
export async function fetchLandingPlans(): Promise<LandingPlan[]> {
  const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';
  try {
    const r = await fetch(`${API}/api/landing-plans`, {
      next: { revalidate: 60 },
    });
    if (!r.ok) return LANDING_PLAN_DEFAULTS;
    const d: any = await r.json();
    return LANDING_PLAN_DEFAULTS.map((def) => {
      const v = d?.[def.id];
      if (!v) return def;
      return {
        ...def,
        price: Number.isFinite(v.price) && v.price > 0 ? v.price : def.price,
        checkoutUrl:
          typeof v.checkoutUrl === 'string' && v.checkoutUrl.trim().length > 0
            ? v.checkoutUrl.trim()
            : null,
      };
    });
  } catch {
    return LANDING_PLAN_DEFAULTS;
  }
}
