'use client';
/**
 * IndustryCoverCard — banner visual de una industria, con 5 variantes
 * estilo Netflix/Apple/Stripe que el admin elige desde el picker.
 *
 * El mismo coverImage se renderiza distinto según coverStyle:
 *  - DARK_OVERLAY: imagen + overlay oscuro + texto blanco abajo (Netflix).
 *  - GRADIENT_BRAND: imagen + gradient bottom-up del themeColor.
 *  - BLUR_GLASS: imagen blureada + glass card centrada (premium).
 *  - MINIMAL: imagen clean + texto compacto esquina abajo, sin overlay.
 *  - MODERN_SPLIT: split 50/50 — imagen derecha, bloque sólido themeColor izquierda.
 *
 * Se usa en /industrias (lista pública) y en el picker del admin.
 */

import type { ReactNode } from 'react';

export type IndustryCoverStyle =
  | 'DARK_OVERLAY'
  | 'GRADIENT_BRAND'
  | 'BLUR_GLASS'
  | 'MINIMAL'
  | 'MODERN_SPLIT';

export type IndustryCardData = {
  name: string;
  description: string | null;
  emoji: string | null;
  iconUrl: string | null;
  coverImage: string | null;
  coverStyle: IndustryCoverStyle | null;
  themeColor: string | null;
};

export function IndustryCoverCard({
  industry,
  /** Override del estilo (para previews del picker que muestran un mismo
   *  industry con 5 variantes distintas). Si no se pasa usa industry.coverStyle. */
  styleOverride,
  /** Si true, hace que el componente sea solo visual sin ser link/clickable
   *  (modo preview). En la lista pública es false y se envuelve en Link. */
  preview = false,
  className = '',
  /** Ratio de la card. Default landscape (4:3). En el picker uso ratio fijo
   *  para que las 5 cards se vean uniformes. */
  ratio = 'landscape',
}: {
  industry: IndustryCardData;
  styleOverride?: IndustryCoverStyle;
  preview?: boolean;
  className?: string;
  ratio?: 'landscape' | 'square' | 'wide';
}) {
  const style = styleOverride ?? industry.coverStyle ?? 'DARK_OVERLAY';
  const accent = industry.themeColor ?? '#22C55E';
  const cover = industry.coverImage;
  const ratioCls =
    ratio === 'wide'
      ? 'aspect-[16/9]'
      : ratio === 'square'
        ? 'aspect-square'
        : 'aspect-[4/3]';

  const containerCls = `relative w-full ${ratioCls} overflow-hidden rounded-2xl bg-bg2 ${
    preview ? '' : 'cursor-pointer'
  } ${className}`;

  return (
    <div className={containerCls}>
      {style === 'DARK_OVERLAY' && <DarkOverlay industry={industry} cover={cover} accent={accent} />}
      {style === 'GRADIENT_BRAND' && <GradientBrand industry={industry} cover={cover} accent={accent} />}
      {style === 'BLUR_GLASS' && <BlurGlass industry={industry} cover={cover} accent={accent} />}
      {style === 'MINIMAL' && <Minimal industry={industry} cover={cover} accent={accent} />}
      {style === 'MODERN_SPLIT' && <ModernSplit industry={industry} cover={cover} accent={accent} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 1: DARK_OVERLAY (Netflix)
// ─────────────────────────────────────────────────────────────────────

function DarkOverlay({
  industry,
  cover,
  accent,
}: {
  industry: IndustryCardData;
  cover: string | null;
  accent: string;
}) {
  return (
    <>
      <CoverBg cover={cover} accent={accent} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <IconBadge industry={industry} accent={accent} />
        <div className="font-bold text-xl leading-tight mt-2">{industry.name}</div>
        {industry.description && (
          <div className="text-xs text-white/85 mt-1 leading-snug line-clamp-2">
            {industry.description}
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 2: GRADIENT_BRAND
// ─────────────────────────────────────────────────────────────────────

function GradientBrand({
  industry,
  cover,
  accent,
}: {
  industry: IndustryCardData;
  cover: string | null;
  accent: string;
}) {
  return (
    <>
      <CoverBg cover={cover} accent={accent} />
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(to top, ${accent} 0%, ${accent}cc 30%, transparent 75%)`,
        }}
      />
      <div className="absolute inset-x-0 bottom-0 p-4 text-white">
        <div className="font-bold text-2xl leading-tight">{industry.name}</div>
        {industry.description && (
          <div className="text-xs text-white/90 mt-1 leading-snug line-clamp-2">
            {industry.description}
          </div>
        )}
      </div>
      <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 flex items-center justify-center text-xl shadow-sm">
        {industry.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={industry.iconUrl} alt="" className="w-6 h-6 object-contain" />
        ) : (
          industry.emoji || '🏢'
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 3: BLUR_GLASS (premium)
// ─────────────────────────────────────────────────────────────────────

function BlurGlass({
  industry,
  cover,
  accent,
}: {
  industry: IndustryCardData;
  cover: string | null;
  accent: string;
}) {
  return (
    <>
      <CoverBg cover={cover} accent={accent} className="scale-110" blur />
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="bg-white/15 backdrop-blur-md border border-white/30 rounded-2xl p-5 text-white text-center shadow-2xl max-w-xs">
          <div className="text-3xl mb-2 leading-none">
            {industry.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={industry.iconUrl}
                alt=""
                className="w-10 h-10 mx-auto object-contain"
              />
            ) : (
              industry.emoji || '🏢'
            )}
          </div>
          <div className="font-bold text-lg leading-tight">{industry.name}</div>
          {industry.description && (
            <div className="text-xs text-white/85 mt-1.5 leading-snug line-clamp-2">
              {industry.description}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 4: MINIMAL
// ─────────────────────────────────────────────────────────────────────

function Minimal({
  industry,
  cover,
  accent,
}: {
  industry: IndustryCardData;
  cover: string | null;
  accent: string;
}) {
  return (
    <>
      <CoverBg cover={cover} accent={accent} />
      <div className="absolute inset-x-0 bottom-0 bg-white/95 backdrop-blur-sm border-t border-line2 p-3">
        <div className="flex items-center gap-2.5">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-xl flex-none"
            style={{ background: `${accent}15`, color: accent }}
          >
            {industry.iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={industry.iconUrl} alt="" className="w-5 h-5 object-contain" />
            ) : (
              industry.emoji || '🏢'
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-tight truncate">
              {industry.name}
            </div>
            {industry.description && (
              <div className="text-[11px] text-mute leading-snug truncate">
                {industry.description}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Variant 5: MODERN_SPLIT
// ─────────────────────────────────────────────────────────────────────

function ModernSplit({
  industry,
  cover,
  accent,
}: {
  industry: IndustryCardData;
  cover: string | null;
  accent: string;
}) {
  return (
    <div className="absolute inset-0 grid grid-cols-2">
      <div
        className="flex flex-col justify-center p-4 text-white"
        style={{ background: accent }}
      >
        <div className="text-2xl leading-none">
          {industry.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={industry.iconUrl} alt="" className="w-7 h-7 object-contain" />
          ) : (
            industry.emoji || '🏢'
          )}
        </div>
        <div className="font-bold text-base md:text-lg leading-tight mt-2">
          {industry.name}
        </div>
        {industry.description && (
          <div className="text-[11px] text-white/85 mt-1 leading-snug line-clamp-3">
            {industry.description}
          </div>
        )}
      </div>
      <div className="relative">
        <CoverBg cover={cover} accent={accent} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function CoverBg({
  cover,
  accent,
  className = '',
  blur = false,
}: {
  cover: string | null;
  accent: string;
  className?: string;
  blur?: boolean;
}) {
  if (!cover) {
    return (
      <div
        className={`absolute inset-0 ${className}`}
        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}aa)` }}
      />
    );
  }
  return (
    <div
      className={`absolute inset-0 bg-cover bg-center ${className} ${blur ? 'blur-xl' : ''}`}
      style={{ backgroundImage: `url("${cover}")` }}
    />
  );
}

function IconBadge({
  industry,
  accent,
}: {
  industry: IndustryCardData;
  accent: string;
}): ReactNode {
  return (
    <div
      className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-xl shadow-md"
      style={{ background: accent }}
    >
      {industry.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={industry.iconUrl} alt="" className="w-5 h-5 object-contain" />
      ) : (
        industry.emoji || '🏢'
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Exports auxiliares
// ─────────────────────────────────────────────────────────────────────

export const COVER_STYLES: Array<{
  id: IndustryCoverStyle;
  label: string;
  hint: string;
}> = [
  { id: 'DARK_OVERLAY', label: 'Oscuro', hint: 'Overlay negro estilo Netflix' },
  { id: 'GRADIENT_BRAND', label: 'Gradient marca', hint: 'Gradient con el color del tema' },
  { id: 'BLUR_GLASS', label: 'Glass', hint: 'Imagen blureada + card glass premium' },
  { id: 'MINIMAL', label: 'Minimal', hint: 'Banner clean con info abajo' },
  { id: 'MODERN_SPLIT', label: 'Split', hint: 'Bloque marca + imagen 50/50' },
];
