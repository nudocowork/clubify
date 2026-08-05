'use client';

import { useRef, useState } from 'react';

type Video = { id: string; name: string };

/**
 * Carrusel de testimonios en video (sección "Nuestros clientes" del landing).
 * Rail horizontal con scroll-snap + dots + flechas (desktop). Escala bien al
 * sumar más videos sin romper el layout (a diferencia del grid, donde 3 items
 * dejaban uno huérfano en la 2ª fila). Client component: page.tsx es server.
 */
export function TestimonialsCarousel({ videos }: { videos: Video[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function onScroll() {
    const el = railRef.current;
    if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    cards.forEach((c, i) => {
      const cc = c.offsetLeft + c.clientWidth / 2;
      const d = Math.abs(cc - center);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setActive(best);
  }

  function go(i: number) {
    const el = railRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(videos.length - 1, i));
    const card = el.children[clamped] as HTMLElement | undefined;
    if (!card) return;
    el.scrollTo({
      left: card.offsetLeft - (el.clientWidth - card.clientWidth) / 2,
      behavior: 'smooth',
    });
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="relative">
        {/* Flechas (solo desktop) */}
        <button
          type="button"
          aria-label="Anterior"
          onClick={() => go(active - 1)}
          className="hidden md:grid place-items-center absolute left-0 -translate-x-1/2 top-[38%] -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white border border-line shadow-md text-ink/70 hover:text-brand hover:border-brand/40 transition disabled:opacity-30"
          disabled={active === 0}
        >
          <span className="text-xl leading-none -mt-0.5">‹</span>
        </button>
        <button
          type="button"
          aria-label="Siguiente"
          onClick={() => go(active + 1)}
          className="hidden md:grid place-items-center absolute right-0 translate-x-1/2 top-[38%] -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white border border-line shadow-md text-ink/70 hover:text-brand hover:border-brand/40 transition disabled:opacity-30"
          disabled={active === videos.length - 1}
        >
          <span className="text-xl leading-none -mt-0.5">›</span>
        </button>

        <div
          ref={railRef}
          onScroll={onScroll}
          className="flex gap-6 overflow-x-auto snap-x snap-mandatory pb-4 px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {videos.map((v) => (
            <div
              key={v.id}
              className="snap-center shrink-0 w-[86%] sm:w-[460px] bg-white rounded-2xl overflow-hidden border border-line shadow-sm"
            >
              <div className="w-full aspect-video bg-black">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${v.id}`}
                  title={`Testimonio ${v.name}`}
                  className="w-full h-full"
                  style={{ border: 0 }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
              <div className="flex items-center gap-2.5 px-5 py-4">
                <div className="text-amber-500 text-sm">★★★★★</div>
                <div className="font-semibold text-sm">{v.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-2 mt-4">
        {videos.map((v, i) => (
          <button
            key={v.id}
            type="button"
            aria-label={`Ir al testimonio ${i + 1}`}
            onClick={() => go(i)}
            className={`h-2 rounded-full transition-all ${
              i === active ? 'w-6 bg-brand' : 'w-2 bg-line hover:bg-brand/40'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
