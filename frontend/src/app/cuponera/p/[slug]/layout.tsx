import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

/**
 * Título y descripción de las páginas HTML de una cuponera, resueltos en el
 * servidor. Sin esto heredaban el `metadata` de /cuponera («Cuponera Card —
 * Clubify»), y es eso lo que pinta WhatsApp al compartir el enlace: la página
 * de una cuponera de otra marca se presentaba como de Clubify. Sin nombre
 * resuelto no se pone ninguna marca.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/api/cuponera/public/page/${encodeURIComponent(params.slug)}`, {
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const p = (await res.json()) as { name?: string };
      if (p?.name) return { title: p.name, description: p.name, openGraph: { title: p.name } };
    }
  } catch {
    /* cae al neutro */
  }
  return { title: 'Cuponera', description: '' };
}

export default function PaginaCuponeraLayout({ children }: { children: React.ReactNode }) {
  return children;
}
