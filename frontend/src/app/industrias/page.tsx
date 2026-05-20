'use client';
/**
 * Vista pública: lista de industrias activas (catálogo de sales decks).
 *
 * Grid de cards estilo Netflix/pitch deck — cada card linkea a su
 * industria con presentaciones específicas.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  themeColor: string | null;
};

export default function IndustriasPage() {
  const [items, setItems] = useState<Industry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Industry[]>('/public/industries')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg to-bg2/40">
      <div className="max-w-6xl mx-auto px-4 py-10 md:py-14">
        <div className="text-center mb-10 md:mb-14">
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
            Clubify para tu industria
          </h1>
          <p className="text-mute mt-3 md:text-lg max-w-2xl mx-auto leading-relaxed">
            Elegí tu rubro y mirá una demo en 60 segundos del sistema
            completo: fidelización, menú digital, pedidos a WhatsApp,
            automatizaciones y más.
          </p>
        </div>

        {loading ? (
          <div className="text-mute py-16 text-center">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="card card-pad text-center py-16 text-mute max-w-md mx-auto">
            Pronto vamos a publicar las demos por rubro.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((i) => {
              const accent = i.themeColor ?? '#22C55E';
              return (
                <Link
                  key={i.id}
                  href={`/industria/${i.slug}`}
                  className="group relative overflow-hidden rounded-2xl bg-surface border border-line hover:border-mute transition-all hover:shadow-card hover:-translate-y-0.5"
                  style={{ borderTop: `4px solid ${accent}` }}
                >
                  {i.coverImage && (
                    <div
                      className="h-36 bg-cover bg-center"
                      style={{ backgroundImage: `url("${i.coverImage}")` }}
                    />
                  )}
                  <div className="p-5">
                    <div className="flex items-start gap-3 mb-2">
                      <div className="text-4xl leading-none flex-none">
                        {i.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={i.iconUrl}
                            alt=""
                            className="w-12 h-12 object-contain"
                          />
                        ) : (
                          i.emoji || '🏢'
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-lg leading-tight">
                          {i.name}
                        </div>
                      </div>
                    </div>
                    {i.description && (
                      <p className="text-sm text-mute leading-relaxed line-clamp-3">
                        {i.description}
                      </p>
                    )}
                    <div
                      className="mt-4 inline-flex items-center gap-1 text-sm font-semibold"
                      style={{ color: accent }}
                    >
                      Iniciar presentación
                      <span className="group-hover:translate-x-0.5 transition-transform">
                        →
                      </span>
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
