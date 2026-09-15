'use client';
import { LabDetalle } from '../LabDetalle';

// Fix 2026-06-10: Next.js 14.2.x recibe `params` como objeto plain, no
// como Promise. El patrón `use(params)` (Next 15+) crasheaba la página
// con React error #438 al renderizar /lab/<id>. La página entraba al
// ErrorBoundary ("Algo salió mal"). Volvemos a la firma plana.
//
// La lógica vive en `LabDetalle` porque el panel admin monta el mismo detalle
// en `/admin/lab/[id]`, con otro enlace de vuelta.
export default function LabDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return <LabDetalle id={params.id} volverHref="/lab" />;
}
