import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

const SITE_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com';

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  try {
    const res = await fetch(`${API}/api/public/m/${params.slug}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      return {
        title: 'Negocio · Clubify',
        description: 'Pide directo desde tu mesa o lleva tu pedido.',
      };
    }
    const t = await res.json();
    const title = `${t.brandName} · Pide a domicilio`;
    const description =
      t.description ||
      `Pide a domicilio en ${t.brandName} desde el menú digital.`;
    const image = t.heroImageUrl || t.logoUrl || `${SITE_URL}/og-image.png`;
    const url = `${SITE_URL}/d/${params.slug}`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        url,
        siteName: t.brandName,
        images: [{ url: image, width: 1200, height: 630, alt: t.brandName }],
        locale: 'es_CO',
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [image],
      },
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
            apple: [
              { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
            ],
          },
      themeColor: t.primaryColor || '#22C55E',
      alternates: { canonical: url },
    };
  } catch {
    return {
      title: 'Negocio · Clubify',
      description: 'Pide a domicilio desde el menú digital.',
    };
  }
}

export default function StorefrontDeliveryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
