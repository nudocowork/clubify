import { notFound, redirect } from 'next/navigation';

/**
 * `/i/<slug>` — un solo tramo, sin el slug del enlace.
 *
 * Esta ruta NO existía y devolvía 404. El problema es que el generador de
 * carteles QR produce exactamente esa forma para los códigos de tipo
 * INFOLINK (`qr-posters.service.ts` → `${base}/i/${slug}`), y la pantalla de
 * QR de marketing hace lo mismo cuando no se elige un enlace concreto.
 * Resultado: carteles impresos y entregados a clientes que llevaban a una
 * página de error. Salió a la luz con Amor Espresso café, cuyo QR apunta a
 * `/i/amor-espresso-cafe-nn`.
 *
 * No se puede arreglar cambiando la URL: los QR están impresos y pegados en
 * las mesas. Se arregla haciendo que la URL impresa resuelva — el backend
 * ahora acepta el slug del negocio además del rootSlug, y devuelve su
 * infolink principal (el más antiguo, que es el que existía cuando se
 * imprimió el cartel).
 *
 * Es el mismo patrón que `/<slug>` (vanity URLs): resolvemos del lado del
 * servidor y redirigimos al `/i/<negocio>/<enlace>` real, sin duplicar el
 * componente pesado del visor ni provocar un parpadeo en el cliente.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

type ResolvedResponse = {
  tenant: { slug: string };
  link: { slug: string };
};

export default async function InfolinkSinEnlacePage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = (params?.slug ?? '').toLowerCase().trim();
  if (!slug) notFound();

  let resolved: ResolvedResponse | null = null;
  try {
    const r = await fetch(
      `${API}/api/public/info-link-by-root/${encodeURIComponent(slug)}`,
      { cache: 'no-store' },
    );
    if (r.ok) {
      resolved = (await r.json()) as ResolvedResponse;
    }
  } catch {
    // Backend caído: mejor 404 que una página rota a medias.
  }

  if (!resolved?.tenant?.slug || !resolved?.link?.slug) {
    notFound();
  }

  // Fuera del try: `redirect()` funciona lanzando, y dentro del catch se
  // tragaría y la página quedaría en blanco.
  redirect(`/i/${resolved.tenant.slug}/${resolved.link.slug}`);
}
