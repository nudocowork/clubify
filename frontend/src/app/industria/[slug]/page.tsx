'use client';
/**
 * Vista pública: detalle de una industria con sus presentaciones activas.
 *
 * Cada card linkea al slide deck interactivo en
 * /industria/{industrySlug}/{presentationSlug}.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

type Presentation = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverImage: string | null;
  themeColor: string | null;
  _count: { slides: number };
};

type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  themeColor: string | null;
  presentations: Presentation[];
};

export default function IndustryDetailPublicPage() {
  const { slug } = useParams<{ slug: string }>();
  const [industry, setIndustry] = useState<Industry | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api<Industry>(`/public/industries/${slug}`)
      .then(setIndustry)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg text-mute">
        Cargando…
      </div>
    );
  }
  if (notFound || !industry) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="card card-pad text-center max-w-md">
          <div className="text-4xl mb-2">⚠️</div>
          <div className="font-semibold mb-1">Industria no encontrada</div>
          <p className="text-sm text-mute">
            La URL puede haber cambiado o esta industria fue desactivada.
          </p>
          <Link href="/industrias" className="btn-primary inline-block mt-4">
            ← Ver todas las industrias
          </Link>
        </div>
      </div>
    );
  }

  const accent = industry.themeColor ?? '#22C55E';

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg to-bg2/40">
      {/* Hero */}
      <div
        className="relative overflow-hidden"
        style={{
          background: industry.coverImage
            ? `linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.85)), url("${industry.coverImage}") center/cover`
            : `linear-gradient(135deg, ${accent}22, ${accent}05)`,
        }}
      >
        <div className="max-w-5xl mx-auto px-4 py-12 md:py-20">
          <Link
            href="/industrias"
            className={`inline-flex items-center gap-1 text-sm mb-4 hover:underline ${
              industry.coverImage ? 'text-white/80' : 'text-mute'
            }`}
          >
            ← Todas las industrias
          </Link>
          <div className="flex items-start gap-4">
            <div className="text-6xl md:text-7xl leading-none flex-none">
              {industry.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={industry.iconUrl}
                  alt=""
                  className="w-20 h-20 md:w-24 md:h-24 object-contain"
                />
              ) : (
                industry.emoji || '🏢'
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1
                className={`text-3xl md:text-5xl font-bold tracking-tight leading-tight ${
                  industry.coverImage ? 'text-white' : ''
                }`}
              >
                {industry.name}
              </h1>
              {industry.description && (
                <p
                  className={`mt-3 md:text-lg max-w-2xl leading-relaxed ${
                    industry.coverImage ? 'text-white/90' : 'text-mute'
                  }`}
                >
                  {industry.description}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Presentations */}
      <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
        <h2 className="text-xl md:text-2xl font-bold mb-5">
          Presentaciones disponibles
        </h2>
        {industry.presentations.length === 0 ? (
          <div className="card card-pad text-center py-12 text-mute">
            Pronto vamos a publicar las presentaciones para esta industria.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {industry.presentations.map((p) => {
              const pAccent = p.themeColor ?? accent;
              return (
                <Link
                  key={p.id}
                  href={`/industria/${industry.slug}/${p.slug}`}
                  className="group relative overflow-hidden rounded-2xl bg-surface border border-line hover:border-mute transition-all hover:shadow-card hover:-translate-y-0.5"
                  style={{ borderTop: `4px solid ${pAccent}` }}
                >
                  {p.coverImage && (
                    <div
                      className="h-36 bg-cover bg-center"
                      style={{ backgroundImage: `url("${p.coverImage}")` }}
                    />
                  )}
                  <div className="p-5">
                    <div className="font-semibold text-lg leading-tight">
                      {p.title}
                    </div>
                    {p.description && (
                      <p className="text-sm text-mute mt-2 leading-relaxed line-clamp-3">
                        {p.description}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-4">
                      <div className="text-[11px] uppercase tracking-wider text-mute">
                        {p._count.slides}{' '}
                        {p._count.slides === 1 ? 'slide' : 'slides'}
                      </div>
                      <div
                        className="inline-flex items-center gap-1 text-sm font-semibold"
                        style={{ color: pAccent }}
                      >
                        Ver presentación
                        <span className="group-hover:translate-x-0.5 transition-transform">
                          →
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
