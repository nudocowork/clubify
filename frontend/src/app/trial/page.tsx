import type { Metadata } from 'next';
import TrialSignupClient from '../prueba/TrialSignupClient';

// Alias en inglés de /prueba. Mismo componente, mismo flow. No-index igual.
export const metadata: Metadata = {
  title: 'Trial mode · Clubify',
  description: 'Try Clubify free for 5 days.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function Page() {
  return <TrialSignupClient />;
}
