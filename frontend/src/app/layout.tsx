import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PWARegister } from '@/components/PWARegister';
import { ToastProvider } from '@/components/Toast';
import { DynamicFavicon } from '@/components/DynamicFavicon';
import { googleFontsUrl } from '@/lib/marketing/qr-poster-config';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

/**
 * generateMetadata corre en el server side y revalida cada 60s. Pulla el
 * branding (logo + favicon) desde la API y los inyecta en metadata.icons —
 * así el favicon custom viene en el HTML inicial sin esperar al cliente.
 * Es la forma correcta porque los browsers cachean favicons agresivamente
 * a nivel SO; un swap client-side rara vez se respeta tras el primer load.
 */
export async function generateMetadata(): Promise<Metadata> {
  let faviconUrl: string | null = null;
  try {
    const r = await fetch(`${API_URL}/api/branding`, {
      next: { revalidate: 60 },
    });
    if (r.ok) {
      const data = await r.json();
      faviconUrl = data?.faviconUrl ?? null;
    }
  } catch {
    // Si el backend está offline, caemos al favicon default
  }

  // Orden importante para Google Search: SVG primero (vectorial, mejor calidad),
  // luego PNGs por tamaño ascendente, luego favicon.ico como fallback legacy.
  // Si hay un favicon custom de branding (super admin Setting) lo priorizamos.
  //
  // FAVICON_VERSION: bump cuando regeneramos los PNGs/SVG locales — Google
  // y browsers cachean favicons por semanas-meses. La query string fuerza
  // re-fetch en clientes (browsers ignoran cuando el contenido cambia, pero
  // ven URL distinta y refrescan). Para Google Search hay que pedir
  // re-indexación en Search Console; este cache-bust acelera el proceso.
  const FAVICON_VERSION = '2026-05-16';
  const v = (url: string) =>
    url.includes('?') ? `${url}&v=${FAVICON_VERSION}` : `${url}?v=${FAVICON_VERSION}`;
  const icon = faviconUrl
    ? [{ url: faviconUrl, type: 'image/png' }]
    : [
        { url: v('/icons/icon.svg'), type: 'image/svg+xml' },
        { url: v('/favicon-16.png'), sizes: '16x16', type: 'image/png' },
        { url: v('/favicon-32.png'), sizes: '32x32', type: 'image/png' },
        { url: v('/favicon-48.png'), sizes: '48x48', type: 'image/png' },
        { url: v('/favicon-96.png'), sizes: '96x96', type: 'image/png' },
        { url: v('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
        { url: v('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
        { url: v('/favicon.ico'), sizes: 'any' },
      ];

  return {
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_APP_URL ?? 'https://soyclubify.com',
    ),
    title: {
      default: 'Clubify · El sistema operativo de tu negocio local',
      template: '%s · Clubify',
    },
    description:
      'Vende por WhatsApp, fideliza con tarjetas wallet y automatiza con un solo lugar. Activa tu cuenta y empieza a vender hoy.',
    manifest: '/manifest.webmanifest',
    applicationName: 'Clubify',
    appleWebApp: {
      capable: true,
      title: 'Clubify',
      statusBarStyle: 'black-translucent',
      startupImage: ['/apple-touch-icon.png'],
    },
    openGraph: {
      title: 'Clubify · El sistema operativo de tu negocio local',
      description:
        'Vende por WhatsApp, fideliza con tarjetas wallet y automatiza. Activa tu cuenta y empieza a vender hoy.',
      url: '/',
      siteName: 'Clubify',
      locale: 'es_LA',
      type: 'website',
      images: [
        { url: v('/og-image.png'), width: 1200, height: 630, alt: 'Clubify · El sistema operativo de tu negocio local' },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Clubify · El sistema operativo de tu negocio local',
      description:
        'Vende por WhatsApp, fideliza con wallet y automatiza. Activa tu cuenta y empieza a vender hoy.',
      images: [v('/og-image.png')],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    icons: {
      icon,
      shortcut: [{ url: v('/favicon.ico') }],
      apple: [
        { url: v('/apple-touch-icon.png'), sizes: '180x180', type: 'image/png' },
      ],
      other: [
        {
          rel: 'mask-icon',
          url: v('/icons/safari-pinned-tab.svg'),
          color: '#22C55E',
        },
      ],
    },
    other: {
      'msapplication-TileColor': '#22C55E',
      'msapplication-TileImage': v('/icons/icon-192.png'),
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#22C55E',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* TODAS las fuentes de FONT_OPTIONS cargadas globalmente —
            disponibles en cualquier página (panel admin, billing,
            cotizaciones, editor QR, wallet pass preview). Una sola
            request al CDN de Google, browsers cachean agresivamente.
            Antes solo Inter estaba global y el resto cargaba on-demand
            cuando montaba QrPosterEditor — quedaban inutilizables en
            otras vistas. */}
        <link
          href={googleFontsUrl()}
          rel="stylesheet"
        />
      </head>
      <body>
        <DynamicFavicon />
        <ToastProvider>{children}</ToastProvider>
        <PWARegister />
      </body>
    </html>
  );
}
