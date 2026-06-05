import type { Metadata } from 'next';
import SellerRegisterClient from './SellerRegisterClient';

// Página pública para que un vendedor se autoregistre bajo un embajador
// específico. URL: /seller/register/<ambassadorCode>. Compartida vía
// WhatsApp/IG por el embajador desde su panel /affiliate/team. NO la
// indexamos para evitar que aparezca en Google.
export const metadata: Metadata = {
  title: 'Suma a tu equipo · Clubify',
  description:
    'Registrate como vendedor del equipo de tu embajador en Clubify.',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function Page({ params }: { params: { code: string } }) {
  return <SellerRegisterClient code={params.code} />;
}
