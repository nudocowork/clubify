import { AuthBrandServer } from '@/components/AuthBrandServer';

// Registro público de afiliados/influencer servido en el dominio de la marca
// (ej. app.selleala.com): hereda su logo + colores desde el server → primer
// paint con la marca, sin parpadeo de Clubify (FODT). Mismo patrón que /login.
export default function RegistroAfiliadoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandServer>{children}</AuthBrandServer>;
}
