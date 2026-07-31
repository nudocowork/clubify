import Link from 'next/link';
import { resolveBrandFromHeaders } from '@/lib/server-brand';
import { authBrandCss, mixHex } from '@/lib/panel-brand-theme';

// El 404 se sirve para cualquier ruta inexistente, incluidos los dominios
// propios de marcas blancas (ej. selleala.com). Los colores `brand-*` de
// Tailwind están FIJOS en verde Clubify; se resuelve la marca por host y se
// inyecta el CSS scopeado a `.brand-auth` (mismo patrón que login) para que el
// botón "Entrar a mi panel" tome el color real. El "404" usa un gradiente
// (que el CSS scopeado NO cubre) → se pinta con estilo inline derivado del
// color de la marca. Sin marca (Clubify/dev) queda el verde por defecto.
export default async function NotFound() {
  const brand = await resolveBrandFromHeaders();
  const c = brand?.primaryColor || null;
  const gradStyle = c
    ? {
        backgroundImage: `linear-gradient(to right, ${mixHex(
          c,
          'white',
          0.18,
        )}, ${c}, ${mixHex(c, 'black', 0.3)})`,
      }
    : undefined;

  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-6">
      {c && <style dangerouslySetInnerHTML={{ __html: authBrandCss(c) }} />}
      <div className="brand-auth text-center max-w-md">
        <div
          className={
            c
              ? 'text-7xl font-bold bg-clip-text text-transparent'
              : 'text-7xl font-bold bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700 bg-clip-text text-transparent'
          }
          style={gradStyle}
        >
          404
        </div>
        <h1 className="text-2xl font-bold mt-3">Esta página no existe</h1>
        <p className="text-mute mt-2 leading-relaxed">
          O fue movida. Volvamos al inicio o entra a tu panel.
        </p>
        <div className="flex gap-2 justify-center mt-6">
          <Link href="/" className="btn-ghost">
            ← Inicio
          </Link>
          <Link href="/login" className="btn-primary">
            Entrar a mi panel
          </Link>
        </div>
      </div>
    </main>
  );
}
