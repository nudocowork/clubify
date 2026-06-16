import type { Metadata } from 'next';
import AmbassadorRegisterClient from './AmbassadorRegisterClient';

// Página pública para que alguien se autoregistre como EMBAJADOR bajo un
// influencer específico. URL: /ambassador/register/<influencerCode>.
// Compartida por el influencer desde su panel /affiliate/team. No indexada.
export const metadata: Metadata = {
  title: 'Sumate como embajador · Clubify',
  description: 'Regístrate como embajador en Clubify.',
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function Page({ params }: { params: { code: string } }) {
  return <AmbassadorRegisterClient code={params.code} />;
}
