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
    const image = t.heroImageUrl || t.logoUrl || `${SITE_URL}/og-default.png`;
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
      icons: t.logoUrl ? { icon: t.logoUrl, apple: t.logoUrl } : undefined,
      themeColor: t.primaryColor || '#6366F1',
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
