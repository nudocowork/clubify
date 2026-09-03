import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { resolveBrandForHost } from '@/lib/server-brand';

// Título marca-consciente: en el dominio de una marca blanca el lanzador dice
// el nombre de esa marca, nunca "Clubify".
export async function generateMetadata(): Promise<Metadata> {
  const host = headers().get('host') ?? '';
  const brand = await resolveBrandForHost(host);
  const name = brand?.name?.trim() || 'Clubify';
  return {
    title: `Inicio · ${name}`,
    // Pantalla privada: no debe indexarse.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return children;
}
