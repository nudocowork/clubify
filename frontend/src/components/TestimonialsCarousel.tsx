'use client';

import { useEffect, useRef, useState } from 'react';

type Video = { id: string; name: string };

// Cadencia del auto-avance (ms). Lento para que se sienta suave, no nervioso.
const AUTOPLAY_MS = 4200;
// Tras una interacción manual, pausa el auto-avance este tiempo antes de retomar.
const RESUME_AFTER_MS = 9000;

/**
 * Carrusel de testimonios en video (sección "Nuestros clientes" del landing).
 * Rail horizontal con scroll-snap + dots + flechas (desktop) + auto-avance
 * lento en vaivén (no queda estático). Pausa al pasar el mouse / interactuar y
 * respeta prefers-reduced-motion. Escala al sumar más videos sin romper el
 * layout. Client component: page.tsx es server.
 */
export function TestimonialsCarousel({ videos }: { videos: Video[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const dirRef = useRef(1); // vaivén: 1 = avanza, -1 = retrocede
  const pausedRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    activeRef.current = best;
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

  // Interacción manual (dot/flecha): navega y pausa el auto-avance un rato.
  function userGo(i: number) {
    go(i);
    pausedRef.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      pausedRef.current = false;
    }, RESUME_AFTER_MS);
  }

  // Auto-avance lento en vaivén.
  useEffect(() => {
    if (videos.length <= 1) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const t = setInterval(() => {
      if (pausedRef.current || document.hidden) return;
      let n = activeRef.current + dirRef.current;
      if (n >= videos.length) {
        n = videos.length - 2;
        dirRef.current = -1;
      } else if (n < 0) {
        n = 1;
        dirRef.current = 1;
      }
      go(Math.max(0, n));
    }, AUTOPLAY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos.length]);

  return (
    <div
      className="max-w-6xl mx-auto"
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      onTouchStart={() => userGo(activeRef.current)}
    >
      <div className="relative">
        {/* Flechas (solo desktop) */}
        <button
          type="button"
          aria-label="Anterior"
          onClick={() => userGo(active - 1)}
          className="hidden md:grid place-items-center absolute left-0 -translate-x-1/2 top-[38%] -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white border border-line shadow-md text-ink/70 hover:text-brand hover:border-brand/40 transition disabled:opacity-30"
          disabled={active === 0}
        >
          <span className="text-xl leading-none -mt-0.5">‹</span>
        </button>
        <button
          type="button"
          aria-label="Siguiente"
          onClick={() => userGo(active + 1)}
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
            onClick={() => userGo(i)}
            className={`h-2 rounded-full transition-all ${
              i === active ? 'w-6 bg-brand' : 'w-2 bg-line hover:bg-brand/40'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
