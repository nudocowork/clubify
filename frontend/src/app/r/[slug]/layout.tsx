import type { Metadata } from 'next';
import {
  traerNegocio,
  metadataDeNegocio,
} from '@/lib/public-page-metadata';

/**
 * Página de reseñas. Se comparte por WhatsApp constantemente ("déjanos tu
 * opinión"), así que el preview lo ve mucha gente. Sin esto salía con la
 * marca de Clubify aunque el negocio fuera de otra marca.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const negocio = await traerNegocio(`/api/public/r/${params.slug}`);
  return metadataDeNegocio({
    negocio,
    slug: params.slug,
    descripcion: (n) => `Cuéntanos cómo te fue en ${n}. Toma menos de un minuto.`,
    vacio: 'Deja tu opinión',
  });
}

export default function ReviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
