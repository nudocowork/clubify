import { notFound, redirect } from 'next/navigation';

/**
 * Vanity URLs para Infolinks — soyclubify.com/<slug>.
 *
 * Server Component: resuelve el rootSlug contra el backend y redirige
 * al `/i/<tenantSlug>/<linkSlug>` real. Esto evita duplicar el componente
 * pesado del viewer; el redirect es server-side (302) así no hay flash
 * visual del lado del cliente.
 *
 * Next.js prioriza rutas estáticas sobre dinámicas — `/admin`, `/app`,
 * `/login`, etc. siguen funcionando porque sus carpetas matchean primero.
 * Solo cuando el slug NO matchea ninguna ruta estática, este page
 * captura el request. Si el slug tampoco resuelve a un Infolink válido
 * (rootSlug no existe o inactivo), devolvemos 404.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type ResolvedResponse = {
  tenant: { slug: string };
  link: { slug: string };
};

export default async function VanitySlugPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = (params?.slug ?? '').toLowerCase().trim();
  if (!slug) notFound();

  let resolved: ResolvedResponse | null = null;
  try {
    // Solo el destino, cacheado 60 s (Degodoy, 2026-10-06: el salto del QR
    // tardaba 1,6–1,8 s en CADA escaneo, sin caché, pidiendo el InfoLink
    // entero solo para redirigir). Si el backend aún no tiene `/destino`
    // (se desplegó antes el frontend), cae al de siempre.
    const base = `${API}/api/public/info-link-by-root/${encodeURIComponent(slug)}`;
    let r = await fetch(`${base}/destino`, { next: { revalidate: 60 } });
    if (!r.ok) r = await fetch(base, { cache: 'no-store' });
    if (r.ok) {
      resolved = (await r.json()) as ResolvedResponse;
    }
  } catch {
    // Si el backend está caído caemos al notFound — mejor 404 que
    // página rota.
  }

  if (!resolved?.tenant?.slug || !resolved?.link?.slug) {
    notFound();
  }

  redirect(`/i/${resolved.tenant.slug}/${resolved.link.slug}`);
}
