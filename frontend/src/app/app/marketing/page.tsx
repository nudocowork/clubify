'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';
import { ConstructionBadge } from '@/components/UnderConstruction';

type QrTool = {
  href: string;
  emoji: string;
  title: string;
  description: string;
  ready: boolean;
};

const TOOLS: QrTool[] = [
  {
    href: '/app/marketing/qr-menu',
    emoji: '🍽',
    title: 'QR Menú',
    description:
      'Cartel imprimible con el QR de tu menú digital. Ideal para mesas, mostrador o vitrina.',
    ready: true,
  },
  {
    href: '/app/marketing/qr-counter',
    emoji: '🪪',
    title: 'QR Mostrador',
    description:
      'Cartel para que el cliente escanee, instale su wallet y empiece a sumar sellos al instante.',
    ready: false,
  },
  {
    href: '/app/marketing/qr-discount',
    emoji: '🎁',
    title: 'QR Descuento',
    description:
      'Cartel promocional pequeño para campañas, primera compra, activaciones y descuentos.',
    ready: false,
  },
  {
    href: '/app/marketing/qr-reviews',
    emoji: '⭐',
    title: 'QR Reseñas',
    description:
      'Cartel para incentivar reseñas de Google. Usa automáticamente el filtro inteligente de 4-5★.',
    ready: false,
  },
];

export default function MarketingHub() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Marketing</h1>
      </div>

      <p className="text-sm text-mute max-w-2xl mb-6 leading-relaxed">
        Crea carteles QR profesionales para imprimir y usar en tu negocio. Cada
        QR es dinámico — si cambias menú, wallet o reseñas, el QR sigue
        funcionando automáticamente.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TOOLS.map((tool) => {
          const card = (
            <div
              className={`card card-pad h-full flex flex-col gap-2 transition ${
                tool.ready
                  ? 'hover:shadow-card-hover hover:border-brand/40 cursor-pointer'
                  : 'opacity-75'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">{tool.emoji}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-ink">{tool.title}</h3>
                    {!tool.ready && <ConstructionBadge label="Próximamente" />}
                  </div>
                </div>
                {tool.ready && (
                  <Icon name="arrow-right" size={18} className="text-mute" />
                )}
              </div>
              <p className="text-sm text-mute leading-relaxed">
                {tool.description}
              </p>
            </div>
          );

          return tool.ready ? (
            <Link key={tool.href} href={tool.href}>
              {card}
            </Link>
          ) : (
            <div key={tool.href}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
