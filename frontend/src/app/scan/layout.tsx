import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Escáner · Clubify',
  description:
    'Escáner de tarjetas y pases Clubify para staff. Registra sellos, visitas y compras desde el móvil.',
  applicationName: 'Clubify Escáner',
  // Manifest aparte para que la PWA del scanner instale con start_url=/scan
  // y nombre "Clubify · Escáner" en lugar del manifest del sitio principal
  // que ahora apunta a / con nombre "Clubify".
  manifest: '/manifest-scanner.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Clubify Escáner',
    statusBarStyle: 'black-translucent',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  themeColor: '#0E1A24',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
