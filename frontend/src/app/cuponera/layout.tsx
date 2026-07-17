import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Living Card — Cuponera Clubify',
  description: 'Tu tarjeta de comunidad: beneficios, descuentos y experiencias en los negocios aliados.',
};

export default function CuponeraLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #eaf4f9 0%, #f6f9fb 40%, #ffffff 100%)',
        fontFamily: '"Figtree", system-ui, sans-serif',
        color: '#0f172a',
      }}
    >
      {children}
    </div>
  );
}
