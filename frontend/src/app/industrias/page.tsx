'use client';
/**
 * Vista pública: lista de industrias activas (catálogo de sales decks).
 *
 * Grid de cards Netflix/pitch deck — cada card linkea a /industria/{slug}
 * que muestra los slides directos. El estilo visual de cada banner lo
 * elige el admin desde /admin/industries (5 variantes IndustryCoverStyle).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  IndustryCoverCard,
  type IndustryCoverStyle,
} from '@/components/industry/IndustryCoverCard';

type Industry = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  coverStyle: IndustryCoverStyle | null;
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
            Elige tu rubro y mira una demo en 60 segundos del sistema
            completo: fidelización, menú digital, pedidos a WhatsApp,
            automatizaciones y más.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-[4/3] rounded-2xl bg-bg2 animate-pulse"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="card card-pad text-center py-16 text-mute max-w-md mx-auto">
            Pronto vamos a publicar las demos por rubro.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
            {items.map((i) => (
              <Link
                key={i.id}
                href={`/industria/${i.slug}`}
                className="block group transition-transform hover:-translate-y-1"
              >
                <IndustryCoverCard
                  industry={{
                    name: i.name,
                    description: i.description,
                    emoji: i.emoji,
                    iconUrl: i.iconUrl,
                    coverImage: i.coverImage,
                    coverStyle: i.coverStyle,
                    themeColor: i.themeColor,
                  }}
                />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
