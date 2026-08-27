import { AuthBrandServer } from '@/components/AuthBrandServer';

// Programa de referidos público servido en el dominio de la marca
// (ej. app.selleala.com): hereda su logo + colores desde el server → primer
// paint con la marca, sin parpadeo de Clubify (FODT). Mismo patrón que
// /registro-afiliado. Cubre también /refer/[code] por anidación de layouts.
export default function ReferLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandServer>{children}</AuthBrandServer>;
}
