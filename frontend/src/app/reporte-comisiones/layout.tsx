import AppShell from '@/components/AppShell';
import { resolveBrandFromHeadersOrSlug } from '@/lib/server-brand';
import { PuertaDelReporte } from './_components/PuertaDelReporte';

export const metadata = { title: 'Reporte de comisiones' };

/**
 * /reporte-comisiones vive fuera de /admin (URL pedida por el dueño), así que
 * no hereda el layout del panel: se monta aquí el mismo AppShell.
 *
 * La puerta va POR FUERA del AppShell: el AppShell manda a /app a quien no es
 * admin, y un afiliado tiene que ir a SU panel (/affiliate), no a /app. El
 * candado de verdad está en el servidor (`SoloPlataformaGuard` + SUPER_ADMIN);
 * esto solo evita que alguien vea una página que le va a responder 403.
 */
export default async function ReporteComisionesLayout({ children }: { children: React.ReactNode }) {
  const brand = await resolveBrandFromHeadersOrSlug();
  return (
    <PuertaDelReporte>
      <AppShell
        variant="admin"
        serverBrandColor={brand?.primaryColor ?? null}
        serverBrandBackground={brand?.backgroundColor ?? null}
        serverBrandLogo={brand?.logoUrl ?? null}
        serverBrandName={brand?.name ?? null}
      >
        {children}
      </AppShell>
    </PuertaDelReporte>
  );
}
