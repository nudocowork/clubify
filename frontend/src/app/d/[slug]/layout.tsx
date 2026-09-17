import type { Metadata } from 'next';
import { hostDeLaPeticion } from '@/lib/host-de-la-peticion';
import {
  baseDeLaVistaPrevia,
  colorDelTema,
  imagenDeLaVistaPrevia,
} from '@/lib/vista-previa-del-negocio.mjs';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';

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
        title: 'Negocio',
        description: 'Pide directo desde tu mesa o lleva tu pedido.',
      };
    }
    const t = await res.json();
    const title = `${t.brandName} · Pide a domicilio`;
    const description =
      t.description ||
      `Pide a domicilio en ${t.brandName} desde el menú digital.`;
    // La vista previa es lo que pinta WhatsApp al compartir el enlace. Antes
    // salía `og:url` de soyclubify.com en los negocios de Sellea, y los que no
    // tenían imagen llevaban la tarjeta verde de Clubify (`/og-image.png`).
    // Sin dominio de marca ni imagen propia, no se pone nada.
    const image = imagenDeLaVistaPrevia(t.heroImageUrl, t.logoUrl);
    const base = baseDeLaVistaPrevia({
      host: hostDeLaPeticion(),
      websiteUrl: t.brand?.websiteUrl,
    });
    const url = base ? `${base}/d/${params.slug}` : null;
    const color = colorDelTema(t.primaryColor, t.brand?.primaryColor);
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
        ...(url ? { url } : {}),
        siteName: t.brandName,
        ...(image
          ? { images: [{ url: image, width: 1200, height: 630, alt: t.brandName }] }
          : {}),
        locale: 'es_CO',
        type: 'website',
      },
      twitter: {
        card: image ? 'summary_large_image' : 'summary',
        title,
        description,
        ...(image ? { images: [image] } : {}),
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
      ...(color ? { themeColor: color } : {}),
      ...(url ? { alternates: { canonical: url } } : {}),
    };
  } catch {
    return {
      title: 'Negocio',
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
