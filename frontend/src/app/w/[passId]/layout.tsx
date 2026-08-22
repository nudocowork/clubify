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
        title: 'Mi tarjeta',
        description: 'Tu tarjeta de fidelización digital.',
      };
    }
    const data = await res.json();
    // El título y la vista previa los ve el CLIENTE FINAL, y es lo que pinta
    // WhatsApp al compartir el enlace. Cae al nombre del NEGOCIO, nunca a
    // Clubify: la tarjeta de un negocio Sellea no puede anunciarse con el
    // nombre de otra plataforma.
    const brand = data?.tenant?.brandName ?? '';
    const cardName = data?.card?.name ?? 'Tarjeta de fidelización';
    const title = brand ? `${cardName} · ${brand}` : cardName;
    const description = brand
      ? `Tu tarjeta wallet en ${brand}. Suma sellos y reclama tu premio.`
      : 'Tu tarjeta wallet. Suma sellos y reclama tu premio.';
    return {
      title,
      description,
      robots: { index: false, follow: false }, // privado por usuario
      themeColor: data?.tenant?.primaryColor || '#22C55E',
      icons: data?.tenant?.logoUrl
        ? { icon: data.tenant.logoUrl, apple: data.tenant.logoUrl }
        : {
            icon: [
              { url: '/icons/icon.svg', type: 'image/svg+xml' },
              { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
              { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { url: '/favicon.ico', sizes: 'any' },
            ],
            apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
          },
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
      title: 'Mi tarjeta',
      description: 'Tu tarjeta de fidelización digital.',
      robots: { index: false, follow: false },
    };
  }
}

export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
