// Legacy redirect — QRs viejos que apuntan a /m/<slug>/delivery van a
// la nueva ruta /d/<slug> (separación de rutas 2026-06-07).
import { redirect } from 'next/navigation';

export default function LegacyDeliveryRedirect({
  params,
}: {
  params: { slug: string };
}) {
  redirect(`/d/${params.slug}`);
}
