import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { resolveBrandForHost } from '@/lib/server-brand';

// Metadata del scanner MARCA-CONSCIENTE: en el dominio de una marca blanca
// (ej. app.selleala.com) el staff ve "Escáner · Sellea", no "Clubify".
// Resuelve la marca por host; fallback a "Clubify" solo en el dominio Clubify.
export async function generateMetadata(): Promise<Metadata> {
  const host = headers().get('host') ?? '';
  const brand = await resolveBrandForHost(host);
  const name = brand?.name?.trim() || 'Clubify';
  return {
    title: `Escáner · ${name}`,
    description: `Escáner de tarjetas y pases de ${name} para staff. Registra sellos, visitas y compras desde el móvil.`,
    applicationName: `${name} Escáner`,
    // Manifest aparte para que la PWA del scanner instale con start_url=/scan.
    manifest: '/manifest-scanner.webmanifest',
    appleWebApp: {
      capable: true,
      title: `${name} Escáner`,
      statusBarStyle: 'black-translucent',
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

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
