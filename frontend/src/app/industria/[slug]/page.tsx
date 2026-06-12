'use client';
/**
 * Vista pública: industria → slides directos.
 *
 * Hace fetch a /public/industries/:slug/deck (devuelve la industria con
 * todos los slides de todas sus presentations activas concatenados) y
 * renderiza el SlideDeck unificado. Sin pantalla intermedia de lista de
 * presentations.
 *
 * Si quieres ver una presentation puntual, /industria/:slug/:pSlug sigue
 * funcionando como deep-link.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SlideDeck, type Slide } from '@/components/industry/SlideDeck';

type IndustryDeck = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  themeColor: string | null;
  presentations: Array<{ id: string; title: string; slug: string; slideCount: number }>;
  slides: Slide[];
};

export default function IndustryDeckPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<IndustryDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api<IndustryDeck>(`/public/industries/${slug}/deck`)
      .then(setData)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white/70">
        Cargando…
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="card card-pad text-center max-w-md">
          <div className="text-4xl mb-2">⚠️</div>
          <div className="font-semibold mb-1">Industria no encontrada</div>
          <Link href="/industrias" className="btn-primary inline-block mt-4">
            ← Ver todas las industrias
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SlideDeck
      slides={data.slides}
      themeColor={data.themeColor}
      industryThemeColor={data.themeColor}
      backHref="/industrias"
      emptyMessage={`${data.name} todavía no tiene slides publicados`}
      pdfName={`clubify-industria-${data.slug ?? data.name}`}
    />
  );
}
