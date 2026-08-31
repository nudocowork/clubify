import { resolveBrandFromHeaders } from '@/lib/server-brand';
import { authBrandCss } from '@/lib/panel-brand-theme';

// Tema de marca para TODO el panel de afiliado (/affiliate/*). Sin esto los
// tabs (.tab-active), botones (.btn-primary) y verdes (text-ok) salían en verde
// Clubify aunque el afiliado sea de una marca blanca (Sellea → naranja). Se
// resuelve la marca por host (server) y se inyecta el CSS scopeado a
// `.brand-auth`. Sin marca (Clubify/dev) → verde por defecto, sin cambios.
export default async function AffiliateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const brand = await resolveBrandFromHeaders();
  const c = brand?.primaryColor || null;
  return (
    <>
      {c && <style dangerouslySetInnerHTML={{ __html: authBrandCss(c) }} />}
      <div className="brand-auth">{children}</div>
    </>
  );
}
