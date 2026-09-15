'use client';
/**
 * Detalle de una propuesta dentro del panel. Lo usa el administrador general
 * de una marca blanca, que tiene su Lab en el menú del panel: la página suelta
 * `/lab/<id>` no lleva su menú y lo sacaba del panel para votar o comentar.
 */
import { usePathname } from 'next/navigation';
import { marcaDeLaRuta } from '@/lib/brand-from-path';
import { LabDetalle } from '@/app/lab/LabDetalle';

export default function AdminLabDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const marca = marcaDeLaRuta(usePathname());
  // Si se entró por /admin/<marca>/lab, se vuelve por la misma URL: sin el
  // slug, el panel deja de saber qué marca está viendo.
  return (
    <LabDetalle
      id={params.id}
      volverHref={marca ? `/admin/${marca}/lab` : '/admin/lab'}
    />
  );
}
