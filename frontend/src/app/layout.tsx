import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PWARegister } from '@/components/PWARegister';
import { ToastProvider } from '@/components/Toast';
import { DynamicFavicon } from '@/components/DynamicFavicon';

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

  const icon = faviconUrl
    ? [{ url: faviconUrl, type: 'image/png' }]
    : [
        { url: '/favicon.png', sizes: '64x64', type: 'image/png' },
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
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
        { url: '/icons/icon-512.png', width: 512, height: 512, alt: 'Clubify' },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Clubify · El sistema operativo de tu negocio local',
      description:
        'Vende por WhatsApp, fideliza con wallet y automatiza. Activa tu cuenta y empieza a vender hoy.',
      images: ['/icons/icon-512.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
    icons: {
      icon,
      apple: [
        { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
      ],
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
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
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
