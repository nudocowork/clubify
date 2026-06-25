import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

/**
 * Metadata para la página pública de seguimiento de pedido.
 * El código del pedido NO se expone en el title (privacidad).
 */
export async function generateMetadata({
  params,
}: {
  params: { code: string };
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/api/public/orders/${params.code}`, {
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      return {
        title: 'Pedido',
        description: 'Sigue el estado de tu pedido en tiempo real.',
      };
    }
    const o = await res.json();
    const brand = o?.tenant?.brandName ?? 'Clubify';
    const title = `Pedido en ${brand}`;
    const description = `Sigue el estado de tu pedido en ${brand}.`;
    return {
      title,
      description,
      robots: { index: false, follow: false }, // privado: no indexar
      openGraph: {
        title,
        description,
        siteName: brand,
        url: `${SITE_URL}/o/${params.code}`,
        type: 'website',
      },
    };
  } catch {
    return {
      title: 'Pedido',
      description: 'Sigue el estado de tu pedido en tiempo real.',
      robots: { index: false, follow: false },
    };
  }
}

export default function OrderTrackerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
