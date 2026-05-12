import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

/**
 * Genera metadata server-side por tenant — para que cuando alguien comparta
 * el link del storefront en WhatsApp/IG/Facebook/Twitter aparezca un preview
 * rico con logo, nombre del negocio y descripción.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/api/public/m/${params.slug}`, {
      next: { revalidate: 300 }, // 5 min de cache para no martirizar el backend
    });
    if (!res.ok) {
      return {
        title: 'Negocio · Clubify',
        description: 'Pide directo desde tu mesa o lleva tu pedido.',
      };
    }
    const t = await res.json();
    const title = `${t.brandName} · Pide y suma sellos`;
    const description =
      t.description ||
      `Menú digital de ${t.brandName}. Ordena por WhatsApp y suma sellos en tu tarjeta wallet.`;
    const image = t.heroImageUrl || t.logoUrl || `${SITE_URL}/og-image.png`;
    const url = `${SITE_URL}/m/${params.slug}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        siteName: t.brandName,
        images: [
          {
            url: image,
            width: 1200,
            height: 630,
            alt: t.brandName,
          },
        ],
        locale: 'es_CO',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [image],
      },
      // White-label: si el tenant tiene logoUrl, su logo es el favicon
      // del storefront. Si no, explícitamente declaramos el cascade Clubify
      // (Next 14 no hereda metadata.icons del root layout cuando se devuelve
      // undefined desde un child generateMetadata).
      icons: t.logoUrl
        ? { icon: t.logoUrl, apple: t.logoUrl }
        : {
            icon: [
              { url: '/icons/icon.svg', type: 'image/svg+xml' },
              { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
              { url: '/favicon-96.png', sizes: '96x96', type: 'image/png' },
              { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
              { url: '/favicon.ico', sizes: 'any' },
            ],
            apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
          },
      themeColor: t.primaryColor || '#22C55E',
      alternates: { canonical: url },
    };
  } catch {
    return {
      title: 'Negocio · Clubify',
      description: 'Pide directo desde tu mesa o lleva tu pedido.',
    };
  }
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
