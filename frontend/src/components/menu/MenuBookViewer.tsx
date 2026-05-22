'use client';

// Storefront público del menú visual tipo libro (FLIPBOOK).
//
// Hace fetch a /public/m/:slug/menu-book (devuelve { sections: [...] }
// con páginas-imagen activas y popup expandido si está enabled). Renderiza
// las páginas como un flipbook con react-pageflip:
//   - Navegación superior por chips de sección con scroll-to.
//   - Swipe móvil (1 página) / libro abierto desktop (2 páginas).
//   - Botones prev/next + indicador "X / Y".
//   - Fullscreen toggle.
//   - Popup overlay cuando una página tiene popup activado.
//
// react-pageflip se carga vía dynamic({ ssr: false }) — depende de DOM
// y mediciones de viewport, no funciona en SSR.

import dynamic from 'next/dynamic';
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

// react-pageflip no es SSR-safe.
const HTMLFlipBook = dynamic(() => import('react-pageflip'), { ssr: false });

export function MenuBookViewer({
  slug,
  primary,
}: {
  slug: string;
  primary: string;
}) {
  const [data, setData] = useState<BookData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [openPopup, setOpenPopup] = useState<Popup | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const flipRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/public/m/${slug}/menu-book`)
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

  // ── Plano de páginas + offset por sección (para chips)
  const { allPages, sectionStarts } = useMemo(() => {
    const pages: Array<Page & { sectionId: string }> = [];
    const starts: Record<string, number> = {};
    if (data) {
      for (const s of data.sections) {
        starts[s.id] = pages.length;
        for (const p of s.pages) pages.push({ ...p, sectionId: s.id });
      }
    }
    return { allPages: pages, sectionStarts: starts };
  }, [data]);

  function goTo(idx: number) {
    if (!flipRef.current) return;
    const total = allPages.length;
    const target = Math.max(0, Math.min(total - 1, idx));
    // pageFlip().flip(idx) hace la animación; .turnToPage(idx) salta directo
    const api = flipRef.current.pageFlip?.();
    if (api?.flip) api.flip(target);
    else if (api?.turnToPage) api.turnToPage(target);
    setPageIdx(target);
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
      <div className="max-w-2xl mx-auto px-5 py-12 text-center text-mute">
        <div className="animate-pulse">Cargando menú…</div>
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

  // Cuál sección corresponde al pageIdx actual
  const activeSectionId = (() => {
    let id = data.sections[0]?.id ?? '';
    for (const s of data.sections) {
      if (sectionStarts[s.id] <= pageIdx) id = s.id;
    }
    return id;
  })();

  return (
    <div
      ref={containerRef}
      className="max-w-5xl mx-auto px-3 sm:px-5 py-3 flex flex-col gap-4"
    >
      {/* Chips de sección — sticky arriba */}
      <div className="sticky top-0 z-20 -mx-3 sm:mx-0 px-3 sm:px-0 py-2 bg-bg/95 backdrop-blur-sm">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {data.sections.map((s) => {
            const active = s.id === activeSectionId;
            return (
              <button
                key={s.id}
                onClick={() => goTo(sectionStarts[s.id] ?? 0)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition border ${
                  active
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-bg2 text-ink border-line2 hover:bg-bg3'
                }`}
                style={active ? { background: primary } : undefined}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* Flipbook */}
      <FlipbookWrap
        flipRef={flipRef}
        pages={allPages}
        onPageChange={setPageIdx}
        onPagePopup={(p) => p.popup && setOpenPopup(p.popup)}
      />

      {/* Controles inferiores */}
      <div className="flex items-center justify-between gap-3 select-none">
        <button
          onClick={() => goTo(pageIdx - 1)}
          disabled={pageIdx === 0}
          className="text-sm font-semibold px-3 py-2 rounded-md bg-bg2 hover:bg-bg3 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Anterior
        </button>
        <div className="text-xs text-mute font-medium">
          Página <strong className="text-ink">{pageIdx + 1}</strong> de{' '}
          {allPages.length}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFullscreen}
            className="text-sm p-2 rounded-md bg-bg2 hover:bg-bg3"
            title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}
          >
            {isFullscreen ? '⤓' : '⤢'}
          </button>
          <button
            onClick={() => goTo(pageIdx + 1)}
            disabled={pageIdx >= allPages.length - 1}
            className="text-sm font-semibold px-3 py-2 rounded-md bg-bg2 hover:bg-bg3 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Siguiente →
          </button>
        </div>
      </div>

      {/* Popup overlay */}
      {openPopup && (
        <PopupOverlay popup={openPopup} onClose={() => setOpenPopup(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Wrap del flipbook (responsive: 1 página mobile, 2 desktop)
// ─────────────────────────────────────────────────────────────────────

function FlipbookWrap({
  flipRef,
  pages,
  onPageChange,
  onPagePopup,
}: {
  flipRef: React.MutableRefObject<any>;
  pages: Array<Page & { sectionId: string }>;
  onPageChange: (idx: number) => void;
  onPagePopup: (p: Page) => void;
}) {
  // Medimos viewport para definir tamaño de página. Mobile: una sola página
  // grande, casi full-width. Desktop: libro abierto centrado.
  const [vw, setVw] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1024,
  );
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Sizing: target ratio 3:4 portrait. En mobile (vw < 768) ocupa ~90% del
  // ancho de la pantalla; en desktop limitamos a 380px por página para
  // dejar margen visual.
  const isMobile = vw < 768;
  const pageWidth = isMobile
    ? Math.min(vw - 32, 480)
    : Math.min(380, (vw - 80) / 2);
  const pageHeight = Math.round(pageWidth * (4 / 3));

  return (
    <div className="flex justify-center">
      <HTMLFlipBook
        ref={flipRef}
        width={pageWidth}
        height={pageHeight}
        size="stretch"
        minWidth={280}
        maxWidth={560}
        minHeight={380}
        maxHeight={780}
        showCover={false}
        usePortrait={isMobile}
        mobileScrollSupport
        flippingTime={650}
        maxShadowOpacity={0.35}
        drawShadow
        useMouseEvents
        clickEventForward
        className="touch-pan-y"
        startPage={0}
        startZIndex={0}
        autoSize={false}
        showPageCorners
        disableFlipByClick={false}
        style={{}}
        swipeDistance={30}
        onFlip={(e: any) => onPageChange(e.data)}
      >
        {pages.map((p) => (
          <PageView key={p.id} page={p} onClick={() => onPagePopup(p)} />
        ))}
      </HTMLFlipBook>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Página individual dentro del flipbook
// ─────────────────────────────────────────────────────────────────────

function PageView({ page, onClick }: { page: Page; onClick: () => void }) {
  return (
    <div className="w-full h-full bg-white shadow-sm">
      <button
        type="button"
        onClick={(e) => {
          // No queremos que el click cuente como "flip"; pasamos la
          // gestión al popup si la página tiene uno. Si no hay popup, el
          // click no hace nada (el flip lo maneja react-pageflip por
          // sus controles internos sobre las esquinas).
          if (page.popup) {
            e.stopPropagation();
            onClick();
          }
        }}
        className="w-full h-full block"
        style={{ cursor: page.popup ? 'pointer' : 'default' }}
        title={page.popup?.title ?? undefined}
      >
        <img
          src={page.imageUrl}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover pointer-events-none"
          draggable={false}
        />
        {page.popup && (
          <span className="absolute top-2 right-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/85 shadow-sm text-amber-700">
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
