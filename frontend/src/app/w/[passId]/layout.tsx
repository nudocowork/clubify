import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

/**
 * Metadata para la vista pública del pase wallet.
 * Cuando se comparte el link, muestra el negocio y el tipo de tarjeta.
 */
export async function generateMetadata({
  params,
}: {
  params: { passId: string };
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/api/passes/${params.passId}/public`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) {
      return {
        title: 'Mi tarjeta · Clubify',
        description: 'Tu tarjeta de fidelización digital.',
      };
    }
    const data = await res.json();
    const brand = data?.tenant?.brandName ?? 'Clubify';
    const cardName = data?.card?.name ?? 'Tarjeta de fidelización';
    const title = `${cardName} · ${brand}`;
    const description = `Tu tarjeta wallet en ${brand}. Suma sellos y reclama tu premio.`;
    return {
      title,
      description,
      robots: { index: false, follow: false }, // privado por usuario
      themeColor: data?.tenant?.primaryColor || '#22C55E',
      icons: data?.tenant?.logoUrl ? { icon: data.tenant.logoUrl } : undefined,
      openGraph: {
        title,
        description,
        siteName: brand,
        url: `${SITE_URL}/w/${params.passId}`,
        type: 'website',
      },
    };
  } catch {
    return {
      title: 'Mi tarjeta · Clubify',
      description: 'Tu tarjeta de fidelización digital.',
      robots: { index: false, follow: false },
    };
  }
}

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
