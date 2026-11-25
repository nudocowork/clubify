import type { Metadata } from 'next';

// Banco de pruebas interno: que no aparezca en buscadores.
export const metadata: Metadata = {
  title: 'Laboratorio de tarjetas',
  robots: { index: false, follow: false },
};

export default function LaboratorioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
