// Modo del menú público — separación definitiva (2026-06-06).
//
// `/m/<slug>`           → MESA  (default nuevo)
// `/m/<slug>/delivery`  → DELIVERY (sub-route)
//
// El frontend deriva el modo de la ruta y lo propaga a:
//   - el fetch al backend (`?mode=mesa|delivery`)
//   - el body del POST /orders (`mode: 'MESA'|'DELIVERY'`)
//   - todos los `<Link>` y `replaceState` internos del storefront, así
//     navegar entre categorías NO pierde el contexto.
//
// Helpers centralizados acá para no esparcir el branching por 8 layouts.

export type StorefrontMode = 'mesa' | 'delivery';

/**
 * Slug → URL absoluta para una página del storefront, respetando el
 * canal actual (mesa vs delivery). Acepta segmentos opcionales para
 * deep-links (sección + subsección).
 */
export function buildStorefrontPath(
  storefrontSlug: string,
  mode: StorefrontMode,
  sectionSlug?: string | null,
  subSlug?: string | null,
): string {
  const base =
    mode === 'delivery'
      ? `/m/${storefrontSlug}/delivery`
      : `/m/${storefrontSlug}`;
  if (!sectionSlug) return base;
  const cat = `${base}/${sectionSlug}`;
  return subSlug ? `${cat}/${subSlug}` : cat;
}

/** Valor del campo `mode` para POST /orders. */
export function orderModeFor(mode: StorefrontMode): 'MESA' | 'DELIVERY' {
  return mode === 'delivery' ? 'DELIVERY' : 'MESA';
}

/** Query param que va al backend en GET /public/m/<slug>/menu. */
export function backendModeParam(mode: StorefrontMode): 'mesa' | 'delivery' {
  return mode;
}
