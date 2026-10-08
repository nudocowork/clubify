import { notFound, redirect } from 'next/navigation';
import { resolverDestinoCorto } from '@/lib/infolink/destino-corto';
import { ReintentarEnlace } from '@/components/ReintentarEnlace';

/**
 * Vanity URLs para Infolinks — soyclubify.com/<slug>.
 *
 * Server Component: resuelve el rootSlug contra el backend y redirige
 * al `/i/<tenantSlug>/<linkSlug>` real. Esto evita duplicar el componente
 * pesado del viewer; el redirect es server-side (302) así no hay flash
 * visual del lado del cliente.
 *
 * Next.js prioriza rutas estáticas sobre dinámicas — `/admin`, `/app`,
 * `/login`, etc. siguen funcionando porque sus carpetas matchean primero.
 * Solo cuando el slug NO matchea ninguna ruta estática, este page
 * captura el request. Si el slug tampoco resuelve a un Infolink válido
 * (rootSlug no existe o inactivo), devolvemos 404.
 */

export default async function VanitySlugPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = (params?.slug ?? '').toLowerCase().trim();
  if (!slug) notFound();

  // Con tiempo límite y salida visible: ver `resolverDestinoCorto`.
  const destino = await resolverDestinoCorto(slug);
  if (destino.tipo === 'no-existe') notFound();
  if (destino.tipo === 'fallo') return <ReintentarEnlace href={`/${slug}`} />;
  // Fuera de cualquier try: `redirect()` funciona lanzando.
  redirect(destino.ruta);
}
