/**
 * Reglas puras de la Biblioteca de Infolinks: con qué dominio se comparte cada
 * enlace y en qué orden salen los negocios.
 *
 * El dominio es la misma regla del panel del negocio (`publicHostForTenant` en
 * el frontend): dominio propio del negocio, luego el de la app de su marca,
 * luego el público de su marca y, al final, soyclubify.com. Si aquí se usara
 * otro, el equipo copiaría para un negocio de Sellea un enlace con
 * soyclubify.com, que delata la plataforma.
 */

export interface DominiosDelNegocio {
  /** `Storefront.customDomain`. */
  dominioPropio?: string | null;
  /** `WhiteLabel.appDomain`. */
  dominioAppMarca?: string | null;
  /** `WhiteLabel.domain`. */
  dominioMarca?: string | null;
}

const limpiar = (d?: string | null) =>
  (d ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

export function hostPublico(d: DominiosDelNegocio): string {
  return limpiar(d.dominioPropio) || limpiar(d.dominioAppMarca) || limpiar(d.dominioMarca) || 'soyclubify.com';
}

/**
 * El enlace de un InfoLink. Con «enlace corto» (`rootSlug`) vive en la raíz del
 * dominio; sin él, en `/i/<negocio>/<infolink>`.
 */
export function enlaceDelInfolink(
  host: string,
  slugNegocio: string,
  il: { slug: string; rootSlug?: string | null },
): string {
  return il.rootSlug
    ? `https://${host}/${il.rootSlug}`
    : `https://${host}/i/${slugNegocio}/${il.slug}`;
}

/** La página con TODOS los InfoLinks activos del negocio. */
export function enlaceDeLaLista(host: string, slugNegocio: string): string {
  return `https://${host}/i/${slugNegocio}`;
}

/**
 * Orden de la biblioteca: primero los negocios con algún InfoLink activo, y
 * dentro de cada grupo por nombre. Un negocio con todos sus InfoLinks pausados
 * sigue saliendo (se puede buscar), pero al final.
 */
export function ordenarNegocios<T extends { nombre: string; activos: number }>(xs: T[]): T[] {
  return [...xs].sort(
    (a, b) =>
      Number(b.activos > 0) - Number(a.activos > 0) ||
      a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }),
  );
}
