// Modo del menú público — rutas separadas (2026-06-07).
//
// `/m/<slug>`  → MESA      (informativo: sin carrito/checkout/WhatsApp)
// `/d/<slug>`  → DELIVERY  (pedido completo: carrito + checkout + WhatsApp)
//
// Legacy:
// `/m/<slug>/delivery` queda como redirect → `/d/<slug>` para QRs viejos.
//
// El frontend deriva el modo del PRIMER segmento del path y lo propaga a:
//   - el fetch al backend (`?mode=mesa|delivery`)
//   - el body del POST /orders (`mode: 'MESA'|'DELIVERY'`)
//   - todos los `<Link>` y `replaceState` internos del storefront, así
//     navegar entre categorías NO pierde el contexto.
//
// Helpers centralizados acá para no esparcir el branching por 8 layouts.

export type StorefrontMode = 'mesa' | 'delivery';

/**
 * Detecta el mode del pathname actual. Mira el primer segmento:
 *   /d/...                 → 'delivery'
 *   /m/.../delivery        → 'delivery' (compat con QRs viejos)
 *   resto                  → 'mesa'
 */
export function modeFromPathname(pathname: string): StorefrontMode {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] === 'd') return 'delivery';
  if (segs[0] === 'm' && segs.includes('delivery')) return 'delivery';
  return 'mesa';
}

/**
 * Slug → URL absoluta para una página del storefront, respetando el
 * canal actual (mesa vs delivery). Acepta segmentos opcionales para
 * deep-links (sección + subsección).
 *
 * Mesa SIEMPRE en `/m/<slug>`, delivery SIEMPRE en `/d/<slug>`.
 */
export function buildStorefrontPath(
  storefrontSlug: string,
  mode: StorefrontMode,
  sectionSlug?: string | null,
  subSlug?: string | null,
): string {
  const base =
    mode === 'delivery'
      ? `/d/${storefrontSlug}`
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
