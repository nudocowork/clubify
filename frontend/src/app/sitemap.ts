import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';
const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

/**
 * Sitemap del sitio público + catálogo dinámico de industrias y
 * presentaciones activas (pitch decks).
 *
 * Las páginas /m/[slug] (storefronts) NO se incluyen — son privadas
 * de cada negocio y se indexan vía links del propio dueño.
 *
 * Las industrias y presentations sí se incluyen para SEO — queremos
 * que el sitio aparezca al buscar "fidelización para cafeterías" etc.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticPages: {
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  }[] = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/industrias', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/signup', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/login', priority: 0.7, changeFrequency: 'yearly' },
    { path: '/legal/terms', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/legal/privacy', priority: 0.3, changeFrequency: 'yearly' },
  ];

  const dynamicEntries: MetadataRoute.Sitemap = [];
  // Best-effort — si el backend no responde, devolvemos solo las estáticas.
  // No queremos que sitemap.xml falle si el API está caído.
  //
  // Solo listamos /industria/{slug} — el flow está colapsado y cada
  // industria abre su deck completo en esa URL. /industria/{slug}/{pSlug}
  // existe como deep-link backward-compat pero no lo publicamos en el
  // sitemap para no diluir SEO con URLs paralelas al mismo contenido.
  try {
    const res = await fetch(`${API}/api/public/industries`, {
      next: { revalidate: 600 }, // 10 min de cache
    });
    if (res.ok) {
      const industries: Array<{ slug: string }> = await res.json();
      for (const ind of industries) {
        if (!ind?.slug) continue;
        dynamicEntries.push({
          url: `${SITE}/industria/${ind.slug}`,
          lastModified: now,
          changeFrequency: 'weekly',
          priority: 0.85,
        });
      }
    }
  } catch {
    // sitemap NO debe fallar por red — devolvemos solo estáticas.
  }

  return [
    ...staticPages.map((p) => ({
      url: `${SITE}${p.path}`,
      lastModified: now,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
    })),
    ...dynamicEntries,
  ];
}
