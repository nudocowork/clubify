import type { Metadata } from 'next';
import TrialSignupClient from './TrialSignupClient';

// Ruta privada para embajadores/equipo comercial/influencers. NO se debe
// linkear desde landing, footer ni menús públicos. Robots noindex para
// que Google no la indexe si alguien filtra la URL.
// Título/desc genéricos (sin marca): la página se sirve en varios dominios
// (Clubify + marcas blancas). El contenido visible sí es brand-aware.
export const metadata: Metadata = {
  title: 'Modo prueba',
  description: 'Activa tu prueba.',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function Page() {
  return <TrialSignupClient />;
}
