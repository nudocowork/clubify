import { resolveBrandFromHeaders } from '@/lib/server-brand';
import { authBrandCss } from '@/lib/panel-brand-theme';

/**
 * Envuelve las pantallas de auth (login/registro/reset) con el tema de la marca
 * resuelto en el SERVER por host → el primer paint ya sale con el color real,
 * sin flash del verde Clubify (FODT). La clase `brand-auth` va en un wrapper
 * `display:contents` (no genera caja, no altera el layout) y activa el override
 * CSS para todos los descendientes. En Clubify (host clubify) no inyecta nada.
 */
export async function AuthBrandServer({ children }: { children: React.ReactNode }) {
  const brand = await resolveBrandFromHeaders();
  if (!brand?.primaryColor) return <>{children}</>;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: authBrandCss(brand.primaryColor) }} />
      <div className="brand-auth" style={{ display: 'contents' }}>
        {children}
      </div>
    </>
  );
}
