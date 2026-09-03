import type { Metadata } from 'next';
import {
  traerNegocio,
  metadataDeNegocio,
} from '@/lib/public-page-metadata';

/**
 * Menú libro (flipbook). Se comparte igual que el menú normal, y hasta ahora
 * el preview mostraba la marca de la plataforma en vez de la del negocio.
 */
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const negocio = await traerNegocio(`/api/public/m/${params.slug}`);
  return metadataDeNegocio({
    negocio,
    slug: params.slug,
    sufijo: 'Menú',
    descripcion: (n) => `Mira el menú completo de ${n}.`,
    vacio: 'Menú',
  });
}

export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
