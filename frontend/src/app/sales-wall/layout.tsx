import { PuertaDelReporte } from '../reporte-comisiones/_components/PuertaDelReporte';

export const metadata = { title: 'Sales Wall · Clubify' };

/**
 * /sales-wall — pantalla de ventas para la TV de la oficina. Va fuera de
 * /admin y SIN el menú lateral: ocupa toda la pantalla.
 *
 * La misma puerta que el Reporte de comisiones (solo SUPER_ADMIN de la
 * plataforma, nunca dentro de otra marca): la pantalla lleva montos y el logo
 * de Clubify. El candado de verdad está en el servidor (`SoloPlataformaGuard`).
 */
export default function SalesWallLayout({ children }: { children: React.ReactNode }) {
  return <PuertaDelReporte>{children}</PuertaDelReporte>;
}
