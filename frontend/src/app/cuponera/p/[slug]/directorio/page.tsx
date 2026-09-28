'use client';
import { useParams } from 'next/navigation';
import { PaginaHtml } from '@/components/cuponera/PaginaHtml';

/** Página de directorio de una cuponera, en el HTML que cargó su administrador. */
export default function PaginaDirectorio() {
  const { slug } = useParams<{ slug: string }>();
  return <PaginaHtml slug={slug} tipo="directorio" />;
}
