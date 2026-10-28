import { redirect } from 'next/navigation';

/**
 * El Reporte de comisiones se fusionó con Comisiones (2026-10-28): su resumen es
 * la pestaña «Resumen» y su cierre e historial, «Cierre e historial». La URL se
 * conserva para no romper enlaces guardados.
 */
export default function ReporteComisionesPage() {
  redirect('/admin/commissions?tab=resumen');
}
