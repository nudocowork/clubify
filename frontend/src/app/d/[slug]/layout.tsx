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
    // Iconos del negocio por el generador (favicon 32/48/192 + apple 180 opaco).
    const ICON_API =
      process.env.NEXT_PUBLIC_API_URL ?? 'https://api.soyclubify.com';
    const iconV =
      (t.logoUrl || params.slug || '1')
        .toString()
        .slice(-16)
        .replace(/[^a-zA-Z0-9]/g, '') || '1';
    const tIcon = (size: number, purpose: 'any' | 'apple') =>
      `${ICON_API}/api/superadmin-public/white-labels/icon?tenant=${encodeURIComponent(
        params.slug,
      )}&size=${size}&purpose=${purpose}&v=${iconV}`;

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
      icons: {
        icon: [
          { url: tIcon(32, 'any'), sizes: '32x32', type: 'image/png' },
          { url: tIcon(48, 'any'), sizes: '48x48', type: 'image/png' },
          { url: tIcon(192, 'any'), sizes: '192x192', type: 'image/png' },
        ],
        shortcut: [{ url: tIcon(48, 'any') }],
        apple: [{ url: tIcon(180, 'apple'), sizes: '180x180', type: 'image/png' }],
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
