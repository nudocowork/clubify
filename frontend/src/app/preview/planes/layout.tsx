import type { Metadata } from 'next';

// Preview interno comparativo de 5 layouts de planes. NO indexar en
// buscadores — es solo para que el founder elija un diseño antes de
// promover a la home / checkout real.
export const metadata: Metadata = {
  title: 'Preview · Planes · Clubify',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function PreviewPlanesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
