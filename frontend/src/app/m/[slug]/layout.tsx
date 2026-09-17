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
        title: 'Negocio',
        description: 'Pide directo desde tu mesa o lleva tu pedido.',
      };
    }
    const t = await res.json();
    // Iconos del negocio generados al vuelo (favicon 32/48/192 + apple-touch 180
    // opaco) desde el logo del negocio → marca → inicial. Antes apuntaban a la
    // imagen cruda (logo ancho) → pixelado/genérico en accesos directos.
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
    const title = `${t.brandName} · Pide y suma sellos`;
    const description =
      t.description ||
      `Menú digital de ${t.brandName}. Ordena por WhatsApp y suma sellos en tu tarjeta wallet.`;
    // Base de URL: el dominio desde el que se comparte (marca o dominio propio
    // del negocio) o, desde un dominio de la plataforma, la web de SU marca.
    // Antes caía a `SITE_URL` (Clubify) si la marca no tenía web, y un negocio
    // sin portada ni logo llevaba de imagen `/og-image.png` —la tarjeta verde
    // de Clubify, que es el mismo archivo en todos los dominios—. Sin marca ni
    // imagen propia, no se pone nada.
    const base = baseDeLaVistaPrevia({
      host: hostDeLaPeticion(),
      websiteUrl: t.brand?.websiteUrl,
    });
    const image = imagenDeLaVistaPrevia(t.heroImageUrl, t.logoUrl);
    const url = base ? `${base}/m/${params.slug}` : null;
    const color = colorDelTema(t.primaryColor, t.brand?.primaryColor);

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        ...(url ? { url } : {}),
        siteName: t.brandName,
        ...(image
          ? {
              images: [
                {
                  url: image,
                  width: 1200,
                  height: 630,
                  alt: t.brandName,
                },
              ],
            }
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
      // Iconos del negocio SIEMPRE por el generador: favicon 32/48/192 cuadrado
      // + apple-touch 180 opaco, desde el logo del negocio (→ su marca → inicial
      // del negocio sobre su color). Nunca hereda Clubify ni usa la imagen cruda.
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
      description: 'Pide directo desde tu mesa o lleva tu pedido.',
    };
  }
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
