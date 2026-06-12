'use client';
/**
 * Vista pública: deep-link a UNA presentation puntual de una industria.
 *
 * URL: /industria/{industrySlug}/{presentationSlug}
 *
 * Esta ruta queda para compartir presentaciones puntuales. La UX primaria
 * ahora es /industria/{slug} que muestra TODOS los slides concatenados de
 * todas las presentations de la industria.
 *
 * Usa el componente compartido SlideDeck para el rendering.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SlideDeck, type Slide } from '@/components/industry/SlideDeck';

type Presentation = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  themeColor: string | null;
  industry: {
    id: string;
    name: string;
    slug: string;
    emoji: string | null;
    iconUrl: string | null;
    themeColor: string | null;
  };
  slides: Slide[];
};

export default function SlideDeckPage() {
  const { slug, pSlug } = useParams<{ slug: string; pSlug: string }>();
  const [deck, setDeck] = useState<Presentation | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug || !pSlug) return;
    setLoading(true);
    api<Presentation>(`/public/presentations/${slug}/${pSlug}`)
      .then(setDeck)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug, pSlug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white/70">
        Cargando deck…
      </div>
    );
  }

  if (notFound || !deck) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="card card-pad text-center max-w-md">
          <div className="text-4xl mb-2">⚠️</div>
          <div className="font-semibold mb-1">Presentación no encontrada</div>
          <Link
            href={`/industria/${slug}`}
            className="btn-primary inline-block mt-4"
          >
            ← Volver
          </Link>
        </div>
      </div>
    );
  }

  return (
    <SlideDeck
      slides={deck.slides}
      themeColor={deck.themeColor}
      industryThemeColor={deck.industry.themeColor}
      backHref={`/industria/${slug}`}
      emptyMessage="Esta presentación todavía no tiene slides"
      pdfName={`clubify-${deck.industry.slug ?? deck.industry.name}-${deck.slug ?? deck.title ?? 'presentacion'}`}
    />
  );
}
