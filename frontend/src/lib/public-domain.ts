// Base pública de los links que un negocio COMPARTE (infolink, QR, reservas,
// menú). Precedencia (PDF dominios personalizados 2026-07-25):
//   1. Storefront.customDomain  → dominio propio del negocio (birrialeon.com)
//   2. brandPublicDomain / brandAppDomain → dominio de la marca blanca
//   3. soyclubify.com (default Clubify)
// Así, cuando un negocio conecta su dominio, todos los links que genera la
// plataforma quedan en SU dominio, sin referencias visibles a soyclubify.com.

type TenantDomainFields = {
  customDomain?: string | null;
  brandPublicDomain?: string | null;
  brandAppDomain?: string | null;
} | null | undefined;

/** Normaliza un dominio: sin protocolo, sin path, sin barra final, minúsculas. */
export function cleanDomain(d?: string | null): string {
  return (d || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Host público (sin protocolo) del negocio, honrando el dominio propio.
 *  Precedencia: customDomain > brandAppDomain > brandPublicDomain > soyclubify.
 *  El orden de marca (app antes que public) preserva EXACTO el comportamiento
 *  histórico de la URL vanity de InfoLinks — solo anteponemos el customDomain.
 *  Para reservas (que históricamente usa el dominio PÚBLICO) ver el call site. */
export function publicHostForTenant(t: TenantDomainFields): string {
  return (
    cleanDomain(t?.customDomain) ||
    cleanDomain(t?.brandAppDomain) ||
    cleanDomain(t?.brandPublicDomain) ||
    'soyclubify.com'
  );
}

/** Base absoluta (https://host) para construir links públicos del negocio. */
export function publicBaseForTenant(t: TenantDomainFields): string {
  return `https://${publicHostForTenant(t)}`;
}
