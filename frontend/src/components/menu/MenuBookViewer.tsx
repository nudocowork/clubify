'use client';

// Storefront público del menú visual tipo libro (FLIPBOOK).
//
// Hace fetch a /api/public/m/:slug/menu-book (devuelve { sections: [...] }
// con páginas-imagen activas y popup expandido si está enabled). Renderiza
// las páginas como un slider CSS-snap horizontal:
//   - Una página visible a la vez ocupando casi todo el ancho.
//   - Swipe horizontal nativo (touch en mobile, drag en desktop).
//   - Snap mandatory entre páginas — la imagen siempre queda centrada.
//   - Chips sticky superiores que saltan a la primera página de su sección
//     con scrollIntoView smooth.
//   - Botones prev/next + indicador "X / Y" + fullscreen.
//   - Popup overlay al tap en página con popup activado.
//
// Decisión técnica: se removió react-pageflip (versión anterior) porque
// en mobile con usePortrait+stretch el comportamiento de page-flip 3D no
// era confiable — a veces apilaba las páginas verticalmente en lugar de
// paginar. El CSS snap nativo es más robusto cross-device y se siente
// premium con scroll-smooth + snap-mandatory.

import { useEffect, useMemo, useRef, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4949';

// ─────────────────────────────────────────────────────────────────────
// Tipos espejo del endpoint público
// ─────────────────────────────────────────────────────────────────────

type Popup = {
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  buttonColor: string | null;
};

type Page = {
  id: string;
  imageUrl: string;
  popup: Popup | null;
};

type Section = {
  id: string;
  title: string;
  pages: Page[];
};

type BookData = { sections: Section[] };

/** Slugify simple (ASCII, lowercase, guiones). Espejo del backend slugify. */
function sectionSlugify(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function MenuBookViewer({
  slug,
  primary,
  initialSectionSlug,
  urlPrefix = '/book',
}: {
  slug: string;
  primary: string;
  /** Si viene, arranca el viewer en la primera página de esa sección y
   *  no actualiza la URL al cargar. Cualquier cambio posterior sí. */
  initialSectionSlug?: string;
  /** Prefijo de URL para deep-links a sección. Default `/book` (modo libro
   *  vive en su propia ruta desde F5.2). Para backwards-compat se acepta
   *  `/m` cuando todavía se monte desde el storefront principal. */
  urlPrefix?: '/book' | '/m';
}) {
  const [data, setData] = useState<BookData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [openPopup, setOpenPopup] = useState<Popup | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Para no pisar la URL durante el primer render (sino al refrescar
  // /m/x/seccion-y sin haber scrolleado quedaría /m/x).
  const initialUrlSetRef = useRef(false);

  // ── Fetch
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/public/m/${slug}/menu-book`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: BookData) => {
        if (!cancelled) setData(d);
      })
      .catch((e: any) => {
        if (!cancelled) setLoadErr(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // ── Plano de páginas + offset por sección (para chips) + map slug→id
  const { allPages, sectionStarts, sectionSlugs } = useMemo(() => {
    const pages: Array<Page & { sectionId: string }> = [];
    const starts: Record<string, number> = {};
    const slugMap: Record<string, string> = {}; // slug → sectionId
    if (data) {
      // Resolver slugs con desambiguación (si dos secciones slugifyan igual,
      // segunda gana sufijo -2, -3, etc).
      const seen = new Set<string>();
      for (const s of data.sections) {
        starts[s.id] = pages.length;
        let baseSlug = sectionSlugify(s.title) || s.id.slice(0, 8);
        let candidate = baseSlug;
        let suffix = 2;
        while (seen.has(candidate)) {
          candidate = `${baseSlug}-${suffix++}`;
        }
        seen.add(candidate);
        slugMap[candidate] = s.id;
        for (const p of s.pages) pages.push({ ...p, sectionId: s.id });
      }
    }
    return { allPages: pages, sectionStarts: starts, sectionSlugs: slugMap };
  }, [data]);

  // ── Mapa inverso sectionId → slug (para construir URL al cambiar sección)
  const slugBySectionId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [s, id] of Object.entries(sectionSlugs)) m[id] = s;
    return m;
  }, [sectionSlugs]);

  // ── Saltar a sección inicial si vino por URL (/m/[slug]/[sectionSlug])
  useEffect(() => {
    if (!data || !initialSectionSlug) {
      initialUrlSetRef.current = true;
      return;
    }
    const targetSectionId = sectionSlugs[initialSectionSlug];
    if (!targetSectionId) {
      initialUrlSetRef.current = true;
      return; // slug no existe → arranca en página 0 (fallback)
    }
    const targetIdx = sectionStarts[targetSectionId];
    if (targetIdx == null) {
      initialUrlSetRef.current = true;
      return;
    }
    // Saltar después de un tick para que el scroller ya esté montado.
    setTimeout(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const pageWidth = el.clientWidth;
      el.scrollTo({ left: targetIdx * pageWidth, behavior: 'auto' });
      setPageIdx(targetIdx);
      initialUrlSetRef.current = true;
    }, 50);
  }, [data, initialSectionSlug, sectionSlugs, sectionStarts]);

  // ── Navegación: scrollTo página por índice
  function goTo(idx: number) {
    const total = allPages.length;
    if (total === 0) return;
    const target = Math.max(0, Math.min(total - 1, idx));
    const el = scrollerRef.current;
    if (!el) return;
    const pageWidth = el.clientWidth;
    el.scrollTo({ left: target * pageWidth, behavior: 'smooth' });
    setPageIdx(target);
  }

  // ── Detecta página actual mientras el user hace swipe / scroll
  function onScrollerScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== pageIdx) setPageIdx(idx);
  }

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false));
    }
  }

  useEffect(() => {
    function onFs() {
      setIsFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ── Preload próximas 2 imágenes para evitar pop-in al pasar
  useEffect(() => {
    for (let i = 1; i <= 2; i++) {
      const target = allPages[pageIdx + i];
      if (!target) break;
      const img = new window.Image();
      img.src = target.imageUrl;
    }
  }, [allPages, pageIdx]);

  // ── activeSectionId computed BEFORE early returns (rules of hooks).
  // Vale empty string cuando data aún no cargó.
  const activeSectionId = useMemo(() => {
    if (!data) return '';
    let id = data.sections[0]?.id ?? '';
    for (const s of data.sections) {
      if (sectionStarts[s.id] <= pageIdx) id = s.id;
    }
    return id;
  }, [data, sectionStarts, pageIdx]);

  // ── Sincronizar URL con sección activa — replaceState para no inflar el
  // historial con cada swipe. Hook ANTES de los early returns para no
  // violar reglas (sino React tira error #310 cuando data pasa de
  // null → loaded y este hook empieza a ejecutarse).
  useEffect(() => {
    if (!initialUrlSetRef.current) return;
    if (typeof window === 'undefined') return;
    if (!activeSectionId) return;
    const activeSlug = slugBySectionId[activeSectionId];
    if (!activeSlug) return;
    const targetPath = `${urlPrefix}/${slug}/${activeSlug}`;
    if (window.location.pathname === targetPath) return;
    window.history.replaceState({}, '', targetPath);
  }, [activeSectionId, slugBySectionId, slug, urlPrefix]);

  // ── Loading / error / empty
  if (loadErr) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-12 text-center">
        <div className="text-3xl mb-2">📖</div>
        <div className="font-semibold">No pudimos cargar el menú</div>
        <div className="text-xs text-mute mt-1">{loadErr}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="max-w-5xl mx-auto px-3 sm:px-5 py-3 flex flex-col items-center gap-4">
        <div className="w-full flex gap-2 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-7 w-24 rounded-full bg-bg2 animate-pulse flex-none"
            />
          ))}
        </div>
        <div className="w-full max-w-md aspect-[3/4] rounded-lg bg-bg2 animate-pulse shadow-sm" />
        <div className="text-xs text-mute">Cargando menú…</div>
      </div>
    );
  }
  if (allPages.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-12 text-center">
        <div className="text-3xl mb-2">📖</div>
        <div className="font-semibold">El menú aún se está preparando</div>
        <div className="text-xs text-mute mt-1">Vuelve a mirar en un momento.</div>
      </div>
    );
  }

  // activeSectionId + useEffect de URL sync ya fueron movidos ARRIBA
  // de los early returns (~líneas 214-238) para no violar las reglas
  // de hooks. Aquí solo usamos el valor ya computado.

  return (
    <div
      ref={containerRef}
      className="w-full flex flex-col"
    >
      {/* Chips de sección — overlay translúcido sobre la imagen, sin
          background sólido que los aísle visualmente. Se sienten como
          parte del menú. */}
      <div className="sticky top-0 z-20 px-2 pt-2 pb-1.5 bg-gradient-to-b from-bg via-bg/90 to-transparent">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {data.sections.map((s) => {
            const active = s.id === activeSectionId;
            return (
              <button
                key={s.id}
                onClick={() => goTo(sectionStarts[s.id] ?? 0)}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition flex-none ${
                  active
                    ? 'text-white shadow-sm'
                    : 'bg-white/80 backdrop-blur-sm text-ink/80 hover:bg-white'
                }`}
                style={active ? { background: primary } : undefined}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* Slider horizontal — snap mandatory, swipe nativo, padding lateral
          mínimo para que la imagen sea protagonista. */}
      <div
        ref={scrollerRef}
        onScroll={onScrollerScroll}
        className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth no-scrollbar touch-pan-x overscroll-x-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {allPages.map((p) => (
          <PageSlide
            key={p.id}
            page={p}
            onClick={() => p.popup && setOpenPopup(p.popup)}
          />
        ))}
      </div>

      {/* Controles compactos — flotantes sobre la parte baja del slider.
          Ocultos si solo hay 1 página. */}
      {allPages.length > 1 && (
        <div className="sticky bottom-2 z-20 mx-auto mt-2 flex items-center gap-1 px-1.5 py-1 rounded-full bg-white/90 backdrop-blur-sm shadow-md select-none">
          <button
            onClick={() => goTo(pageIdx - 1)}
            disabled={pageIdx === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            title="Anterior"
          >
            ←
          </button>
          <div className="text-[11px] text-mute font-medium px-2 min-w-[58px] text-center tabular-nums">
            <span className="text-ink font-semibold">{pageIdx + 1}</span>
            <span className="opacity-60"> / {allPages.length}</span>
          </div>
          <button
            onClick={toggleFullscreen}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 text-sm"
            title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? '⤓' : '⤢'}
          </button>
          <button
            onClick={() => goTo(pageIdx + 1)}
            disabled={pageIdx >= allPages.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            title="Siguiente"
          >
            →
          </button>
        </div>
      )}

      {/* Popup overlay */}
      {openPopup && (
        <PopupOverlay popup={openPopup} onClose={() => setOpenPopup(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Slide individual: ocupa todo el ancho del scroller, aspect 3:4 portrait
// ─────────────────────────────────────────────────────────────────────

function PageSlide({
  page,
  onClick,
}: {
  page: Page & { sectionId: string };
  onClick: () => void;
}) {
  // Edge-to-edge real: sin padding lateral. La imagen toma w-full y la
  // altura del slide se adapta al aspect ratio natural (h-auto). Slide
  // con min-h-[60vh] para que imágenes horizontales no queden minúsculas
  // — la imagen se centra cuando no llena el alto.
  return (
    <div className="flex-none w-full snap-start snap-always flex items-center justify-center min-h-[60vh]">
      <button
        type="button"
        onClick={onClick}
        disabled={!page.popup}
        className="relative w-full inline-flex"
        style={{ cursor: page.popup ? 'pointer' : 'default' }}
      >
        <img
          src={page.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="block w-full h-auto"
          draggable={false}
        />
        {page.popup && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/90 shadow-sm text-amber-700">
            🔔 Tocar
          </span>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Overlay del popup
// ─────────────────────────────────────────────────────────────────────

function PopupOverlay({
  popup,
  onClose,
}: {
  popup: Popup;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl"
      >
        {popup.imageUrl && (
          <img
            src={popup.imageUrl}
            alt=""
            className="w-full max-h-[40vh] object-cover rounded-t-2xl"
          />
        )}
        <div className="p-5 space-y-3">
          {popup.title && (
            <h3 className="text-lg font-bold m-0">{popup.title}</h3>
          )}
          {popup.description && (
            <p className="text-sm text-mute whitespace-pre-line leading-relaxed">
              {popup.description}
            </p>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="text-sm px-3 py-2 rounded-md hover:bg-bg2"
            >
              Cerrar
            </button>
            {popup.buttonText && popup.buttonUrl && (
              <a
                href={popup.buttonUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold px-4 py-2 rounded-md text-white shadow-sm"
                style={{ background: popup.buttonColor || '#22c55e' }}
              >
                {popup.buttonText}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
