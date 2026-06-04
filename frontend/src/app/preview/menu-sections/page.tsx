'use client';

import { useState } from 'react';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import { SECTION_COVER_TEMPLATES } from '@/lib/menu/section-cover-templates';
import type { SectionCoverConfig } from '@/lib/menu/section-cover-config';

/**
 * Preview del layout SECTIONS del storefront — mock data para que el
 * dueño vea cómo queda el menú premium antes de configurarlo.
 *
 * Muestra:
 * 1. Los 8 templates pre-armados aplicados a secciones realistas.
 * 2. Una sección con detalle: subsecciones (chips horizontales) +
 *    grid de productos con foto + precio.
 * 3. Toggle entre lista y detalle para que se vea el flow completo.
 *
 * Las imágenes de fondo son de Unsplash (gratis, sin atribución
 * obligatoria) — el dueño normalmente sube las suyas.
 */

type MockProduct = {
  id: string;
  name: string;
  basePrice: number;
  imageUrl: string;
};

type MockSection = {
  id: string;
  name: string;
  tagline: string;
  cover: SectionCoverConfig;
  products: MockProduct[];
  subsections?: { id: string; name: string; products: MockProduct[] }[];
};

// Imágenes de Unsplash optimizadas a 800px ancho
const IMG = (id: string) =>
  `https://images.unsplash.com/${id}?w=800&q=80&auto=format&fit=crop`;

const MOCK_SECTIONS: MockSection[] = [
  {
    id: 'hamburguesas',
    name: 'Hamburguesas',
    tagline: 'Carne 100% premium, pan brioche artesanal',
    cover: {
      ...SECTION_COVER_TEMPLATES[0].config,
      bgImageUrl: IMG('photo-1568901346375-23c9450c58cd'),
    },
    products: [
      {
        id: 'h1',
        name: 'Clásica',
        basePrice: 28000,
        imageUrl: IMG('photo-1568901346375-23c9450c58cd'),
      },
      {
        id: 'h2',
        name: 'BBQ Bacon',
        basePrice: 34000,
        imageUrl: IMG('photo-1572802419224-296b0aeee0d9'),
      },
      {
        id: 'h3',
        name: 'Doble queso',
        basePrice: 36000,
        imageUrl: IMG('photo-1606131731446-5568d87113aa'),
      },
      {
        id: 'h4',
        name: 'Veggie',
        basePrice: 26000,
        imageUrl: IMG('photo-1525059696034-4967a729002e'),
      },
    ],
    subsections: [
      {
        id: 'h-clasicas',
        name: 'Clásicas',
        products: [
          {
            id: 'h1',
            name: 'Clásica',
            basePrice: 28000,
            imageUrl: IMG('photo-1568901346375-23c9450c58cd'),
          },
          {
            id: 'h3',
            name: 'Doble queso',
            basePrice: 36000,
            imageUrl: IMG('photo-1606131731446-5568d87113aa'),
          },
        ],
      },
      {
        id: 'h-premium',
        name: 'Premium',
        products: [
          {
            id: 'h2',
            name: 'BBQ Bacon',
            basePrice: 34000,
            imageUrl: IMG('photo-1572802419224-296b0aeee0d9'),
          },
        ],
      },
      {
        id: 'h-veggie',
        name: 'Veggie',
        products: [
          {
            id: 'h4',
            name: 'Veggie',
            basePrice: 26000,
            imageUrl: IMG('photo-1525059696034-4967a729002e'),
          },
        ],
      },
    ],
  },
  {
    id: 'cortes',
    name: 'Cortes al Grill',
    tagline: 'Cortes premium importados, asados al carbón',
    cover: {
      ...SECTION_COVER_TEMPLATES[1].config,
      bgImageUrl: IMG('photo-1558030006-450675393462'),
    },
    products: [
      {
        id: 'c1',
        name: 'Ribeye 400g',
        basePrice: 78000,
        imageUrl: IMG('photo-1558030006-450675393462'),
      },
      {
        id: 'c2',
        name: 'Lomo fino',
        basePrice: 68000,
        imageUrl: IMG('photo-1607013251379-e6eecfffe234'),
      },
    ],
  },
  {
    id: 'cocteleria',
    name: 'Coctelería',
    tagline: 'Cocteles de autor + clásicos',
    cover: {
      ...SECTION_COVER_TEMPLATES[7].config,
      bgImageUrl: IMG('photo-1551024709-8f23befc6f87'),
    },
    products: [
      {
        id: 'co1',
        name: 'Mojito',
        basePrice: 22000,
        imageUrl: IMG('photo-1551024709-8f23befc6f87'),
      },
      {
        id: 'co2',
        name: 'Margarita',
        basePrice: 24000,
        imageUrl: IMG('photo-1514362545857-3bc16c4c7d1b'),
      },
    ],
  },
  {
    id: 'cervezas',
    name: 'Cervezas',
    tagline: 'Tiradas, importadas y artesanales',
    cover: {
      ...SECTION_COVER_TEMPLATES[5].config,
      bgImageUrl: IMG('photo-1535958636474-b021ee887b13'),
    },
    products: [
      {
        id: 'b1',
        name: 'Heineken',
        basePrice: 9000,
        imageUrl: IMG('photo-1535958636474-b021ee887b13'),
      },
      {
        id: 'b2',
        name: 'Stout artesanal',
        basePrice: 14000,
        imageUrl: IMG('photo-1608270586620-248524c67de9'),
      },
    ],
  },
  {
    id: 'entradas',
    name: 'Entradas',
    tagline: 'Para compartir y abrir el apetito',
    cover: {
      ...SECTION_COVER_TEMPLATES[3].config,
      bgImageUrl: IMG('photo-1541592106381-b31e9677c0e5'),
    },
    products: [
      {
        id: 'e1',
        name: 'Patacones con hogao',
        basePrice: 18000,
        imageUrl: IMG('photo-1541592106381-b31e9677c0e5'),
      },
      {
        id: 'e2',
        name: 'Empanadas',
        basePrice: 16000,
        imageUrl: IMG('photo-1606756790138-261d2b21cd75'),
      },
    ],
  },
  {
    id: 'postres',
    name: 'Postres',
    tagline: 'Hechos en casa, todos los días',
    cover: {
      ...SECTION_COVER_TEMPLATES[6].config,
      bgImageUrl: IMG('photo-1551024601-bec78aea704b'),
    },
    products: [
      {
        id: 'p1',
        name: 'Brownie con helado',
        basePrice: 14000,
        imageUrl: IMG('photo-1551024601-bec78aea704b'),
      },
      {
        id: 'p2',
        name: 'Cheesecake',
        basePrice: 16000,
        imageUrl: IMG('photo-1565958011703-44f9829ba187'),
      },
    ],
  },
  {
    id: 'bebidas',
    name: 'Bebidas',
    tagline: 'Refrescos, jugos y agua',
    cover: {
      ...SECTION_COVER_TEMPLATES[2].config,
      bgImageUrl: IMG('photo-1437418747212-8d9709afab22'),
    },
    products: [
      {
        id: 'be1',
        name: 'Limonada de coco',
        basePrice: 12000,
        imageUrl: IMG('photo-1437418747212-8d9709afab22'),
      },
    ],
  },
  {
    id: 'desayunos',
    name: 'Desayunos',
    tagline: 'Hasta las 12 del día',
    cover: {
      ...SECTION_COVER_TEMPLATES[4].config,
      bgImageUrl: IMG('photo-1525351484163-7529414344d8'),
    },
    products: [
      {
        id: 'd1',
        name: 'Calentado paisa',
        basePrice: 22000,
        imageUrl: IMG('photo-1525351484163-7529414344d8'),
      },
    ],
  },
];

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MenuSectionsPreview() {
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [activeSub, setActiveSub] = useState<string | null>(null);

  const section = activeSection
    ? MOCK_SECTIONS.find((s) => s.id === activeSection)
    : null;

  return (
    <div className="min-h-screen bg-bg2/30">
      {/* Header explicativo (no se ve en el storefront real) */}
      <div className="bg-bg border-b border-line">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold">
            Preview · Layout SECTIONS
          </div>
          <h1 className="text-xl font-bold m-0 mt-1">Menú premium por secciones</h1>
          <p className="text-xs text-mute mt-1">
            Vista mobile. Click en una sección para entrar al detalle con
            subsecciones y productos.
          </p>
        </div>
      </div>

      {/* Frame mobile centrado */}
      <div className="max-w-md mx-auto px-4 py-6">
        {!section ? (
          // Vista 1: lista de banners
          <div className="space-y-3 animate-in fade-in duration-300">
            {MOCK_SECTIONS.map((m, idx) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setActiveSection(m.id);
                  setActiveSub(null);
                }}
                className="block w-full text-left active:scale-[0.98] hover:scale-[1.005] transition-transform duration-150"
                style={{
                  animation: `slideUp 0.35s ease-out ${idx * 60}ms both`,
                }}
              >
                <SectionCoverPreview
                  config={m.cover}
                  title={m.name}
                  tagline={m.tagline}
                />
              </button>
            ))}
          </div>
        ) : (
          // Vista 2: detalle de sección
          <div
            key={section.id}
            className="space-y-4"
            style={{ animation: 'slideInRight 0.3s ease-out' }}
          >
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setActiveSection(null);
                  setActiveSub(null);
                }}
                className="absolute top-3 left-3 z-10 w-10 h-10 rounded-full bg-black/40 backdrop-blur-md text-white flex items-center justify-center active:scale-95 transition-transform shadow-md"
                aria-label="Volver"
              >
                ←
              </button>
              <SectionCoverPreview
                config={section.cover}
                title={section.name}
                tagline={section.tagline}
              />
            </div>

            {section.subsections && section.subsections.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 sticky top-0 z-20 bg-bg/95 backdrop-blur-md py-2 -mt-2">
                <SubChip
                  label="Todo"
                  count={
                    section.products.length +
                    (section.subsections ?? []).reduce(
                      (n, s) => n + s.products.length,
                      0,
                    )
                  }
                  active={!activeSub}
                  onClick={() => setActiveSub(null)}
                />
                {section.subsections.map((s) => (
                  <SubChip
                    key={s.id}
                    label={s.name}
                    count={s.products.length}
                    active={activeSub === s.id}
                    onClick={() => setActiveSub(s.id)}
                  />
                ))}
              </div>
            )}

            <div
              key={activeSub ?? 'all'}
              className="grid grid-cols-2 gap-3 animate-in fade-in duration-200"
            >
              {(activeSub
                ? section.subsections?.find((s) => s.id === activeSub)?.products ?? []
                : [
                    ...section.products,
                    ...(section.subsections ?? []).flatMap((s) => s.products),
                  ]
              ).map((p, idx) => (
                <div
                  key={p.id}
                  style={{
                    animation: `cardIn 0.3s ease-out ${idx * 30}ms both`,
                  }}
                >
                  <ProductCard product={p} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function SubChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap text-sm font-semibold px-4 py-2 rounded-full border transition active:scale-95 ${
        active
          ? 'text-white border-transparent bg-brand shadow-md'
          : 'text-ink border-line bg-bg'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1.5 text-[11px] opacity-70">· {count}</span>
      )}
    </button>
  );
}

function ProductCard({ product }: { product: MockProduct }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  return (
    <div className="block rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md border border-line2 transition-all duration-200">
      <div className="aspect-square bg-gradient-to-br from-bg2 to-bg2/60 relative overflow-hidden">
        {!imgLoaded && (
          <div className="absolute inset-0 animate-pulse bg-bg2/80" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={product.imageUrl}
          alt={product.name}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          className={`w-full h-full object-cover transition-opacity duration-300 ${
            imgLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>
      <div className="p-2.5">
        <div className="font-semibold text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
          {product.name}
        </div>
        <div className="font-bold text-sm mt-1.5">{fmt(product.basePrice)}</div>
      </div>
    </div>
  );
}
