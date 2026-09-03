import { AuthBrandServer } from '@/components/AuthBrandServer';

// Página de crear cuenta tras pagar, servida en el dominio de la marca (ej.
// www.selleala.com/activar). Hereda su color desde el server (scopeado a
// `.brand-auth`): sin esto el botón (.btn-primary), los links (text-brand), el
// badge y el panel lateral con gradiente (from-brand-*) salían en verde Clubify
// aunque la marca sea Sellea. Sin marca (Clubify/dev) → verde default, sin
// cambios. Mismo patrón que /login, /prueba y /registro-afiliado.
export default function ActivarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandServer>{children}</AuthBrandServer>;
}
