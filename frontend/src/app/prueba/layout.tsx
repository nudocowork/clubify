import { AuthBrandServer } from '@/components/AuthBrandServer';

// Página de prueba servida en el dominio de la marca (ej. www.selleala.com):
// hereda su color desde el server y lo aplica scopeado a `.brand-auth`. Sin
// esto, TODO lo `brand` (el pill "🎁 Prueba", el botón "Activar mi prueba"
// = .btn-primary, los links text-brand) salía en verde Clubify aunque la marca
// sea Sellea (naranja #FF4D3D). Sin marca (Clubify/dev) → verde default, sin
// cambios. Mismo patrón que /login y /registro-afiliado.
export default function PruebaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthBrandServer>{children}</AuthBrandServer>;
}
