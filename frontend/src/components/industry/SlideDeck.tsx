'use client';
/**
 * SlideDeck — viewer interactivo de slides para industrias y presentaciones.
 *
 * Usado por:
 *  - /industria/[slug]/page.tsx → deck unificado con todos los slides de
 *    todas las presentations activas de la industria (concatenados).
 *  - /industria/[slug]/[pSlug]/page.tsx → deck de una sola presentation
 *    (deep-link).
 *
 * Features:
 *  - Navegación: keyboard (← → Esc Space), swipe horizontal mobile,
 *    click en dots/flechas.
 *  - 10 layouts (COVER, IMAGE_LEFT, IMAGE_RIGHT, FULL_IMAGE, TEXT_ONLY,
 *    QUOTE, CTA, STATS, COMPARISON, VIDEO).
 *  - 5 animations re-disparadas vía key al cambiar slide.
 *  - Mobile first; layouts split hacen stack en mobile.
 *  - Progress bar arriba; dots indicators abajo (desktop only).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export type SlideLayout =
  | 'COVER'
  | 'IMAGE_LEFT'
  | 'IMAGE_RIGHT'
  | 'FULL_IMAGE'
  | 'TEXT_ONLY'
  | 'QUOTE'
  | 'CTA'
  | 'STATS'
  | 'COMPARISON'
  | 'VIDEO';

export type SlideAnimation = 'NONE' | 'FADE' | 'SLIDE_RIGHT' | 'SLIDE_UP' | 'ZOOM';

export type Slide = {
  id: string;
  sortOrder: number;
  layout: SlideLayout;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  ctaText: string | null;
  ctaUrl: string | null;
  bgColor: string | null;
  textColor: string | null;
  animation: SlideAnimation;
  content: any;
};

const ANIMATION_CLASS: Record<SlideAnimation, string> = {
  NONE: '',
  FADE: 'animate-deck-fade',
  SLIDE_RIGHT: 'animate-deck-slide-right',
  SLIDE_UP: 'animate-deck-slide-up',
  ZOOM: 'animate-deck-zoom',
};

export function SlideDeck({
  slides,
  themeColor,
  industryThemeColor,
  backHref,
  emptyMessage = 'Esta presentación todavía no tiene slides',
}: {
  slides: Slide[];
  themeColor?: string | null;
  industryThemeColor?: string | null;
  backHref: string;
  emptyMessage?: string;
}) {
  const router = useRouter();
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const total = slides.length;
  const current = slides[idx] ?? null;

  const goNext = useCallback(() => {
    setIdx((i) => Math.min(i + 1, total - 1));
  }, [total]);
  const goPrev = useCallback(() => {
    setIdx((i) => Math.max(i - 1, 0));
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Escape') {
        router.push(backHref);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, router, backHref]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null || touchStartY.current == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext();
      else goPrev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  }

  if (total === 0 || !current) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="card card-pad text-center max-w-md">
          <div className="text-4xl mb-2">🎬</div>
          <div className="font-semibold mb-1">{emptyMessage}</div>
          <Link href={backHref} className="btn-primary inline-block mt-4">
            ← Volver
          </Link>
        </div>
      </div>
    );
  }

  const accent =
    current.bgColor ?? themeColor ?? industryThemeColor ?? '#0A0A0A';
  const textColor = current.textColor ?? autoContrast(accent);
  const animClass = ANIMATION_CLASS[current.animation] ?? '';

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ background: accent, color: textColor }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Progress bar arriba */}
      <div className="absolute top-0 inset-x-0 h-1 bg-white/15 z-30">
        <div
          className="h-full bg-white transition-all duration-300"
          style={{ width: `${((idx + 1) / total) * 100}%` }}
        />
      </div>

      {/* Top bar: close + counter */}
      <div className="absolute top-3 inset-x-0 z-20 flex items-center justify-between px-4">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 text-xs opacity-80 hover:opacity-100"
        >
          ← Salir
        </Link>
        <div className="text-xs font-mono opacity-80">
          {idx + 1} / {total}
        </div>
      </div>

      {/* Slide content — key re-monta para re-disparar la animación */}
      <div
        key={`${current.id}-${idx}`}
        className={`absolute inset-0 flex items-center justify-center px-4 sm:px-8 md:px-16 ${animClass}`}
      >
        <SlideRenderer slide={current} textColor={textColor} />
      </div>

      {/* Nav buttons — solo desktop. Mobile usa swipe. */}
      <button
        onClick={goPrev}
        disabled={idx === 0}
        className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed items-center justify-center text-2xl z-20 transition"
        aria-label="Slide anterior"
      >
        ‹
      </button>
      <button
        onClick={goNext}
        disabled={idx === total - 1}
        className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed items-center justify-center text-2xl z-20 transition"
        aria-label="Slide siguiente"
      >
        ›
      </button>

      {/* Dots indicator abajo */}
      <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-1.5 z-20">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? 'w-6 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
            }`}
            aria-label={`Ir al slide ${i + 1}`}
          />
        ))}
      </div>

      <style jsx global>{`
        @keyframes deck-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes deck-slide-right {
          from { transform: translateX(40px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes deck-slide-up {
          from { transform: translateY(40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes deck-zoom {
          from { transform: scale(0.92); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .animate-deck-fade { animation: deck-fade 400ms ease-out; }
        .animate-deck-slide-right { animation: deck-slide-right 450ms ease-out; }
        .animate-deck-slide-up { animation: deck-slide-up 450ms ease-out; }
        .animate-deck-zoom { animation: deck-zoom 500ms ease-out; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Renderer + layouts (sin cambios respecto a la versión original)
// ─────────────────────────────────────────────────────────────────────

function SlideRenderer({ slide, textColor }: { slide: Slide; textColor: string }) {
  const { layout } = slide;
  if (layout === 'COVER') return <SlideCover slide={slide} textColor={textColor} />;
  if (layout === 'IMAGE_LEFT') return <SlideImageSide slide={slide} side="left" textColor={textColor} />;
  if (layout === 'IMAGE_RIGHT') return <SlideImageSide slide={slide} side="right" textColor={textColor} />;
  if (layout === 'FULL_IMAGE') return <SlideFullImage slide={slide} />;
  if (layout === 'TEXT_ONLY') return <SlideTextOnly slide={slide} textColor={textColor} />;
  if (layout === 'QUOTE') return <SlideQuote slide={slide} textColor={textColor} />;
  if (layout === 'CTA') return <SlideCta slide={slide} textColor={textColor} />;
  if (layout === 'STATS') return <SlideStats slide={slide} textColor={textColor} />;
  if (layout === 'COMPARISON') return <SlideComparison slide={slide} textColor={textColor} />;
  if (layout === 'VIDEO') return <SlideVideo slide={slide} textColor={textColor} />;
  return <SlideCover slide={slide} textColor={textColor} />;
}

function SlideCover({ slide, textColor }: { slide: Slide; textColor: string }) {
  return (
    <div className="max-w-3xl text-center">
      {slide.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.imageUrl} alt="" className="max-h-[40vh] mx-auto mb-6 object-contain" />
      )}
      {slide.subtitle && (
        <div className="text-sm md:text-base opacity-80 uppercase tracking-widest mb-2 md:mb-4">{slide.subtitle}</div>
      )}
      {slide.title && (
        <h2 className="text-3xl md:text-6xl font-bold leading-tight tracking-tight">{slide.title}</h2>
      )}
      {slide.body && (
        <p className="mt-4 md:mt-6 text-base md:text-lg opacity-90 leading-relaxed max-w-2xl mx-auto whitespace-pre-line">{slide.body}</p>
      )}
      {slide.ctaText && slide.ctaUrl && <CtaButton slide={slide} textColor={textColor} />}
    </div>
  );
}

function SlideImageSide({ slide, side, textColor }: { slide: Slide; side: 'left' | 'right'; textColor: string }) {
  return (
    <div className={`grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 items-center max-w-6xl w-full ${side === 'right' ? 'md:[&>*:first-child]:order-2' : ''}`}>
      <div>
        {slide.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={slide.imageUrl} alt="" className="w-full max-h-[60vh] object-contain rounded-2xl" />
        ) : (
          <div className="aspect-video rounded-2xl bg-white/10" />
        )}
      </div>
      <div>
        {slide.subtitle && (
          <div className="text-sm opacity-80 uppercase tracking-widest mb-2">{slide.subtitle}</div>
        )}
        {slide.title && (
          <h2 className="text-2xl md:text-4xl font-bold leading-tight tracking-tight">{slide.title}</h2>
        )}
        {slide.body && (
          <p className="mt-4 text-base md:text-lg opacity-90 leading-relaxed whitespace-pre-line">{slide.body}</p>
        )}
        {slide.ctaText && slide.ctaUrl && <CtaButton slide={slide} textColor={textColor} />}
      </div>
    </div>
  );
}

function SlideFullImage({ slide }: { slide: Slide }) {
  return (
    <div className="absolute inset-0">
      {slide.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      {(slide.title || slide.subtitle || slide.body) && (
        <div className="absolute inset-0 bg-black/40 flex items-end p-6 md:p-12">
          <div className="text-white max-w-3xl">
            {slide.subtitle && (
              <div className="text-sm opacity-80 uppercase tracking-widest mb-2">{slide.subtitle}</div>
            )}
            {slide.title && (
              <h2 className="text-3xl md:text-6xl font-bold leading-tight">{slide.title}</h2>
            )}
            {slide.body && (
              <p className="mt-3 text-base md:text-lg opacity-90 leading-relaxed whitespace-pre-line">{slide.body}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SlideTextOnly({ slide, textColor }: { slide: Slide; textColor: string }) {
  return (
    <div className="max-w-3xl text-center">
      {slide.subtitle && (
        <div className="text-sm md:text-base opacity-80 uppercase tracking-widest mb-3">{slide.subtitle}</div>
      )}
      {slide.title && (
        <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight mb-6">{slide.title}</h2>
      )}
      {slide.body && (
        <p className="text-lg md:text-2xl opacity-90 leading-relaxed whitespace-pre-line">{slide.body}</p>
      )}
      {slide.ctaText && slide.ctaUrl && <CtaButton slide={slide} textColor={textColor} />}
    </div>
  );
}

function SlideQuote({ slide, textColor }: { slide: Slide; textColor: string }) {
  return (
    <div className="max-w-3xl text-center">
      <div className="text-6xl md:text-8xl opacity-30 leading-none">❝</div>
      {slide.body && (
        <p className="text-2xl md:text-4xl font-medium leading-snug mt-2 md:mt-4 whitespace-pre-line">{slide.body}</p>
      )}
      {slide.title && (
        <div className="mt-6 md:mt-8 text-sm md:text-base opacity-80 uppercase tracking-widest">— {slide.title}</div>
      )}
      {slide.subtitle && (
        <div className="text-xs md:text-sm opacity-60 mt-1">{slide.subtitle}</div>
      )}
      {void textColor}
    </div>
  );
}

function SlideCta({ slide, textColor }: { slide: Slide; textColor: string }) {
  return (
    <div className="max-w-2xl text-center">
      {slide.title && (
        <h2 className="text-3xl md:text-5xl font-bold leading-tight tracking-tight">{slide.title}</h2>
      )}
      {slide.body && (
        <p className="mt-4 text-base md:text-lg opacity-90 leading-relaxed whitespace-pre-line">{slide.body}</p>
      )}
      {slide.ctaText && slide.ctaUrl && <CtaButton slide={slide} textColor={textColor} prominent />}
    </div>
  );
}

function SlideStats({ slide, textColor }: { slide: Slide; textColor: string }) {
  const stats: Array<{ label?: string; value?: string }> = Array.isArray(slide.content?.stats) ? slide.content.stats : [];
  return (
    <div className="max-w-5xl w-full text-center">
      {slide.title && (
        <h2 className="text-2xl md:text-4xl font-bold mb-8 md:mb-12 leading-tight">{slide.title}</h2>
      )}
      <div className={`grid gap-6 md:gap-10 ${stats.length >= 4 ? 'grid-cols-2 md:grid-cols-4' : stats.length === 3 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
        {stats.map((s, i) => (
          <div key={i}>
            <div className="text-4xl md:text-6xl font-bold leading-none">{s.value ?? '—'}</div>
            <div className="text-sm md:text-base opacity-80 mt-2 md:mt-3 uppercase tracking-wider">{s.label ?? ''}</div>
          </div>
        ))}
      </div>
      {slide.ctaText && slide.ctaUrl && <CtaButton slide={slide} textColor={textColor} />}
    </div>
  );
}

function SlideComparison({ slide, textColor }: { slide: Slide; textColor: string }) {
  const left = slide.content?.left ?? { title: 'Antes', items: [] };
  const right = slide.content?.right ?? { title: 'Con Clubify', items: [] };
  const leftItems: string[] = Array.isArray(left.items) ? left.items : [];
  const rightItems: string[] = Array.isArray(right.items) ? right.items : [];
  return (
    <div className="max-w-5xl w-full">
      {slide.title && (
        <h2 className="text-2xl md:text-4xl font-bold mb-6 md:mb-10 text-center leading-tight">{slide.title}</h2>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white/10 rounded-2xl p-5 md:p-7">
          <div className="text-sm uppercase tracking-widest opacity-80 mb-3">{left.title}</div>
          <ul className="space-y-2">
            {leftItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="opacity-60">✗</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white/20 rounded-2xl p-5 md:p-7">
          <div className="text-sm uppercase tracking-widest opacity-90 mb-3 font-semibold">{right.title}</div>
          <ul className="space-y-2">
            {rightItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <span>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {void textColor}
    </div>
  );
}

function SlideVideo({ slide, textColor }: { slide: Slide; textColor: string }) {
  const url = slide.videoUrl ?? '';
  const isYouTube = /youtube\.com\/embed\//.test(url) || /youtu\.be\//.test(url);
  const embedUrl = isYouTube ? url.replace(/youtu\.be\/([^?]+)/, 'www.youtube.com/embed/$1') : url;
  return (
    <div className="max-w-5xl w-full">
      {slide.title && (
        <h2 className="text-xl md:text-3xl font-bold mb-4 text-center">{slide.title}</h2>
      )}
      <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black/60">
        {url ? (
          isYouTube ? (
            <iframe
              src={embedUrl}
              title={slide.title ?? 'video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full border-0"
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={url} controls className="w-full h-full" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center opacity-50">Sin URL de video</div>
        )}
      </div>
      {slide.body && (
        <p className="mt-4 text-sm md:text-base opacity-90 text-center whitespace-pre-line">{slide.body}</p>
      )}
      {slide.ctaText && slide.ctaUrl && <CtaButton slide={slide} textColor={textColor} />}
    </div>
  );
}

function CtaButton({ slide, textColor, prominent = false }: { slide: Slide; textColor: string; prominent?: boolean }) {
  const isExternal = !!slide.ctaUrl?.startsWith('http') || !!slide.ctaUrl?.startsWith('//');
  const cls = prominent
    ? 'inline-flex items-center gap-2 px-8 py-4 rounded-full bg-white text-black font-bold text-lg shadow-xl hover:scale-105 transition-transform mt-8'
    : 'inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/15 hover:bg-white/25 font-semibold mt-6 transition';
  const href = slide.ctaUrl ?? '#';
  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls} style={{ color: prominent ? undefined : textColor }}>
        {slide.ctaText} →
      </a>
    );
  }
  return (
    <Link href={href} className={cls} style={{ color: prominent ? undefined : textColor }}>
      {slide.ctaText} →
    </Link>
  );
}

/** YIQ heuristic: devuelve negro o blanco según luminosidad del color hex. */
function autoContrast(hex: string): string {
  const m = hex.replace('#', '');
  if (m.length !== 3 && m.length !== 6) return '#FFFFFF';
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 160 ? '#0A0A0A' : '#FFFFFF';
}
