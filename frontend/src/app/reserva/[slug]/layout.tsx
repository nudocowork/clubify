import type { Metadata } from 'next';

const API =
  process.env.BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:4949';
const ICON_API = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.soyclubify.com';

/**
 * Metadata de la página de reservas/agenda de un negocio. La página es client
 * component (sin metadata propia) → sin esto heredaba el favicon de Clubify.
 * Iconos del negocio por el generador (favicon 32/48/192 + apple-touch 180
 * opaco) desde el logo del negocio → su marca → inicial. Nunca Clubify.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const iconV =
    (params.slug || '1').slice(-16).replace(/[^a-zA-Z0-9]/g, '') || '1';
  const tIcon = (size: number, purpose: 'any' | 'apple') =>
    `${ICON_API}/api/superadmin-public/white-labels/icon?tenant=${encodeURIComponent(
      params.slug,
    )}&size=${size}&purpose=${purpose}&v=${iconV}`;

  // Nombre del negocio (best-effort) para el título; si falla, título genérico.
  let brandName = 'Reservas';
  try {
    const res = await fetch(`${API}/api/public/m/${params.slug}`, {
      next: { revalidate: 300 },
    });
    if (res.ok) {
      const t = await res.json();
      if (t?.brandName) brandName = `Reservas · ${t.brandName}`;
    }
  } catch {
    // título genérico
  }

  return {
    title: brandName,
    icons: {
      icon: [
        { url: tIcon(32, 'any'), sizes: '32x32', type: 'image/png' },
        { url: tIcon(48, 'any'), sizes: '48x48', type: 'image/png' },
        { url: tIcon(192, 'any'), sizes: '192x192', type: 'image/png' },
      ],
      shortcut: [{ url: tIcon(48, 'any') }],
      apple: [{ url: tIcon(180, 'apple'), sizes: '180x180', type: 'image/png' }],
    },
  };
}

export default function ReservaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
