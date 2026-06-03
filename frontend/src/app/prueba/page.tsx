import type { Metadata } from 'next';
import TrialSignupClient from './TrialSignupClient';

// Ruta privada para embajadores/equipo comercial/influencers. NO se debe
// linkear desde landing, footer ni menús públicos. Robots noindex para
// que Google no la indexe si alguien filtra la URL.
export const metadata: Metadata = {
  title: 'Modo prueba · Clubify',
  description: 'Prueba Clubify gratis durante 5 días.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function Page() {
  return <TrialSignupClient />;
}
