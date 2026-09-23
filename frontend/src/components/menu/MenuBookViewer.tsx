'use client';

// Storefront público del menú visual tipo libro (FLIPBOOK).
//
// Hace fetch a /api/public/m/:slug/menu-book (devuelve { sections: [...] }
// con páginas-imagen activas y popup expandido si está enabled). Renderiza
// las páginas como un slider CSS-snap horizontal:
//   - Una página visible a la vez ocupando casi todo el ancho.
//   - Swipe horizontal nativo (touch en mobile, drag en desktop).
//   - Snap mandatory entre páginas — la imagen siempre queda centrada.
//   - Chips sticky superiores que saltan a la primera página de su sección.
//   - Botones prev/next + indicador "X / Y" + zoom + fullscreen.
//   - Popup overlay al tap en página con popup activado.
//
// Decisión técnica: se removió react-pageflip (versión anterior) porque
// en mobile con usePortrait+stretch el comportamiento de page-flip 3D no
// era confiable — a veces apilaba las páginas verticalmente en lugar de
// paginar. El CSS snap nativo es más robusto cross-device y se siente
// premium con scroll-smooth + snap-mandatory.
//
// Las dos cuentas que no viven aquí, para poder probarlas desde node sin
// montar React (`scripts/pruebas-libro-imagenes.mjs` y
// `scripts/pruebas-libro-zoom.mjs`):
//   - `imagen-del-libro.mjs` → cómo se pide cada página.
//   - `zoom-del-libro.mjs`   → las cuentas del zoom.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { safeUrlOrNull } from '@/lib/safe-url';
import {
  TAMANOS_DEL_LIBRO,
  cargaDeLaPagina,
  desplazamientoDelSalto,
  srcSetDelLibro,
  urlOptimizada,
} from '@/lib/menu/imagen-del-libro.mjs';
import {
  PASO_DE_ZOOM,
  ZOOM_MAXIMO,
  distanciaEntreDedos,
  escalaDelPellizco,
  laRuedaAmplia,
  limitarDesplazamiento,
  limitarZoom,
  pasaPagina,
  pasoDeLaRueda,
  puntoMedio,
  zoomDelDobleToque,
  zoomHaciaUnPunto,
  zoomInicial,
} from '@/lib/menu/zoom-del-libro.mjs';
import { urlDelLibro } from '@/lib/api-publica.mjs';

// Ancho de partida del `src` mientras el navegador elige del srcset. 1080
// cubre un teléfono grande sin bajarse el original.
const ANCHO_POR_DEFECTO = 1080;

// Un doble toque son dos toques dentro de esta ventana. El popup de la
// página espera un pelín más que eso antes de abrirse: si no, el primer
// toque del gesto de ampliar abriría el popup y el zoom nunca llegaría.
const VENTANA_DOBLE_TOQUE = 300;
const ESPERA_DEL_POPUP = 320;

// ─────────────────────────────────────────────────────────────────────
// Tipos espejo del endpoint público
// ─────────────────────────────────────────────────────────────────────

// M9 (2026-06-06): discriminator del popup. NULL del API = EXTERNAL_LINK
// por back compat con popups creados antes de M9.
type PopupType = 'EXTERNAL_LINK' | 'CARD' | 'IMAGE';

type Popup = {
  // M9: tipo de popup. El API ya defaultea a EXTERNAL_LINK pero el viewer
  // también lo trata defensivamente para evitar undefined si algo viejo
  // llega cacheado.
  type?: PopupType | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  buttonColor: string | null;
  // M9: payload de CARD/IMAGE. Pueden venir null cuando no aplican.
  cardId?: string | null;
  cardCtaLabel?: string | null;
  imageCaption?: string | null;
};

type Page = {
  id: string;
  imageUrl: string;
  popup: Popup | null;
};

type Section = {
  id: string;
  title: string;
  // M3: popup que dispara al entrar a la sección. Misma shape que Page.popup.
  popup: Popup | null;
  pages: Page[];
};

type BookPopup = Popup & { delaySeconds: number };

type BookData = {
  sections: Section[];
  /** Popup global del libro (dispara al cargar el viewer). M3 2026-06-04. */
  bookPopup: BookPopup | null;
  /** #29 (2026-06-16): orientación del swipe. Default HORIZONTAL. */
  direction?: 'HORIZONTAL' | 'VERTICAL';
};

/** Estado del zoom de la página que se está mirando. */
type Zoom = { escala: number; desplazamiento: { x: number; y: number } };

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
  const t = useTranslations('menu_book_viewer');
  const [data, setData] = useState<BookData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [openPopup, setOpenPopup] = useState<Popup | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Zoom de la página actual. Vive en el padre —y no dentro del slide— por
  // dos razones: al cambiar de página tiene que volver a su sitio, y el
  // slider deja de pasar hoja mientras esté ampliada.
  const [zoom, setZoom] = useState<Zoom>(zoomInicial());
  // Los gestos mueven la imagen sin animación (si no, se siente pegajoso);
  // los botones y el doble toque sí animan.
  const [animarZoom, setAnimarZoom] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Para no pisar la URL durante el primer render (sino al refrescar
  // /m/x/seccion-y sin haber scrolleado quedaría /m/x).
  const initialUrlSetRef = useRef(false);
  // M3: secciones cuyo popup ya se mostró en esta visita (set para no
  // repetir al hacer back-and-forth). El popup global del libro también
  // se trackea con bookPopupShownRef.
  const sectionsShownRef = useRef<Set<string>>(new Set());
  const bookPopupShownRef = useRef(false);
  // #29 (2026-06-16): orientación del swipe (vertical = arriba↕abajo).
  const vertical = data?.direction === 'VERTICAL';
  const ampliado = !pasaPagina(zoom.escala);

  // ── Fetch
  useEffect(() => {
    let cancelled = false;
    // Ruta relativa y no `${API}`: el backend cachea el libro 180 s en el
    // borde, y directo a la API esa caché no existe (ver `api-publica.mjs`).
    fetch(urlDelLibro(slug))
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
        const baseSlug = sectionSlugify(s.title) || s.id.slice(0, 8);
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
      // `'instant'` y no `'auto'`: el scroller lleva `scroll-smooth`, y `auto`
      // quiere decir «usa el scroll-behavior del CSS». Con `auto`, entrar por
      // el enlace directo a una sección del final animaba el salto y arrastraba
      // la ventana por todas las páginas de en medio, cargándolas.
      if (vertical) {
        el.scrollTo({ top: targetIdx * el.clientHeight, behavior: 'instant' });
      } else {
        el.scrollTo({ left: targetIdx * el.clientWidth, behavior: 'instant' });
      }
      setPageIdx(targetIdx);
      initialUrlSetRef.current = true;
    }, 50);
  }, [data, initialSectionSlug, sectionSlugs, sectionStarts, vertical]);

  // ── Navegación: scrollTo página por índice
  function goTo(idx: number) {
    const total = allPages.length;
    if (total === 0) return;
    const target = Math.max(0, Math.min(total - 1, idx));
    const el = scrollerRef.current;
    if (!el) return;
    // Un salto largo va INSTANTÁNEO a propósito: animarlo arrastra la ventana
    // por todas las páginas de en medio y cada una dispara su imagen. En la
    // carta de 105 páginas, tocar el chip de la última sección se bajaba el
    // libro entero.
    const behavior = desplazamientoDelSalto(pageIdx, target) as ScrollBehavior;
    if (vertical) {
      el.scrollTo({ top: target * el.clientHeight, behavior });
    } else {
      el.scrollTo({ left: target * el.clientWidth, behavior });
    }
    setPageIdx(target);
  }

  // ── Detecta página actual mientras el user hace swipe / scroll
  function onScrollerScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = vertical
      ? Math.round(el.scrollTop / el.clientHeight)
      : Math.round(el.scrollLeft / el.clientWidth);
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

  // ── Al cambiar de página el zoom vuelve a su sitio. Sin esto se pasa
  //    hoja y la siguiente aparece ampliada por una esquina.
  useEffect(() => {
    setZoom(zoomInicial());
    setAnimarZoom(false);
  }, [pageIdx]);

  // ── Zoom desde los botones (siempre hacia el centro de la página).
  function ajustarZoom(paso: number) {
    setAnimarZoom(true);
    setZoom((z) =>
      zoomHaciaUnPunto({
        escala: z.escala,
        nuevaEscala: limitarZoom(z.escala + paso),
        desplazamiento: z.desplazamiento,
        punto: { x: 0, y: 0 },
        medidas: medidasDelSlide(scrollerRef.current, pageIdx),
      }),
    );
  }

  function restablecerZoom() {
    setAnimarZoom(true);
    setZoom(zoomInicial());
  }

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
    // Conservar la query, igual que en el storefront: sin esto, pasar de
    // pagina borraba `?sede=` y el menu del libro perdia la sede del QR.
    window.history.replaceState({}, '', `${targetPath}${window.location.search}`);
  }, [activeSectionId, slugBySectionId, slug, urlPrefix]);

  // ── M3: trigger del popup GLOBAL del libro al cargar (con delay
  // configurado). Se dispara 1 vez por visita — si el cliente lo cierra
  // y refresca sí vuelve, pero swipe entre páginas no lo reabre.
  //
  // HOTFIX 2026-06-05: marcamos `bookPopupShownRef = true` SOLO si
  // efectivamente abrimos el popup. Si durante el delay otro popup ya
  // se abrió (ej: popup de página por tap rápido del cliente), bookPopup
  // queda "consumido" pero nunca se mostró. La marca debe quedar atada
  // al evento real de apertura. Mismo patrón para sección.
  useEffect(() => {
    if (!data?.bookPopup) return;
    if (bookPopupShownRef.current) return;
    const delay = Math.max(0, data.bookPopup.delaySeconds ?? 5) * 1000;
    const t = setTimeout(() => {
      setOpenPopup((curr) => {
        if (curr) return curr; // otro popup ya abierto, no pisamos ni marcamos.
        bookPopupShownRef.current = true;
        return data.bookPopup;
      });
    }, delay);
    return () => clearTimeout(t);
  }, [data]);

  // ── M3: trigger del popup por SECCIÓN al entrar — solo 1 vez por
  // sección por visita. No dispara si ya hay otro popup abierto.
  // Cuando el popup actual se cierre (openPopup → null), el effect
  // re-evalúa con la sección activa y abre el popup pendiente si lo hay.
  useEffect(() => {
    if (!data) return;
    if (!activeSectionId) return;
    if (sectionsShownRef.current.has(activeSectionId)) return;
    if (openPopup) return; // esperamos a que se cierre el popup actual.
    const section = data.sections.find((s) => s.id === activeSectionId);
    if (!section?.popup) return;
    sectionsShownRef.current.add(activeSectionId);
    setOpenPopup(section.popup);
  }, [activeSectionId, data, openPopup]);

  // ── Loading / error / empty
  if (loadErr) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-12 text-center">
        <div className="text-3xl mb-2">📖</div>
        <div className="font-semibold">{t('loadError')}</div>
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
        <div className="text-xs text-mute">{t('loading')}</div>
      </div>
    );
  }
  if (allPages.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-12 text-center">
        <div className="text-3xl mb-2">📖</div>
        <div className="font-semibold">{t('preparing')}</div>
        <div className="text-xs text-mute mt-1">{t('comeBack')}</div>
      </div>
    );
  }

  // activeSectionId + useEffect de URL sync ya fueron movidos ARRIBA
  // de los early returns (~líneas 214-238) para no violar las reglas
  // de hooks. Aquí solo usamos el valor ya computado.

  return (
    <div
      ref={containerRef}
      className="w-full flex flex-col alto-de-la-pantalla overflow-hidden"
    >
      {/* Chips de sección — overlay translúcido sobre la imagen, sin
          background sólido que los aísle visualmente. Se sienten como
          parte del menú. */}
      {/* Sin degradado: ahora la página va centrada y ese gris de la paleta
          quedaba como una banda clara sobre el fondo que eligió el negocio.
          Los chips ya llevan su propio fondo translúcido. */}
      <div className="sticky top-0 z-20 px-2 pt-2 pb-1.5">
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

      {/* #29: slider con snap mandatory. HORIZONTAL (izq↔der, default) o
          VERTICAL (arriba↕abajo). En vertical el scroller tiene alto fijo
          para que el snap sea por página.

          Con una página ampliada se le quita el snap: el arrastre de esa
          página es para moverla, no para pasar hoja. */}
      <div
        ref={scrollerRef}
        onScroll={onScrollerScroll}
        className={`${
          vertical
            ? 'flex flex-col overflow-y-auto scroll-smooth no-scrollbar touch-pan-y overscroll-y-contain flex-1 min-h-0'
            : 'flex items-stretch overflow-x-auto scroll-smooth no-scrollbar touch-pan-x overscroll-x-contain flex-1 min-h-0'
        } ${
          ampliado
            ? ''
            : vertical
              ? 'snap-y snap-mandatory'
              : 'snap-x snap-mandatory'
        }`}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {allPages.map((p, i) => (
          <PaginaDelLibro
            key={p.id}
            page={p}
            indice={i}
            indiceActivo={pageIdx}
            vertical={vertical}
            activa={i === pageIdx}
            zoom={zoom}
            animar={animarZoom}
            onZoom={(z, animar) => {
              setAnimarZoom(animar);
              setZoom(z);
            }}
            onAbrirPopup={(popup) => setOpenPopup(popup)}
          />
        ))}
      </div>

      {/* Controles compactos — flotantes sobre la parte baja del slider.
          Ocultos si solo hay 1 página y no se puede ampliar. */}
      <div className="sticky bottom-2 z-20 mx-auto mt-2 flex items-center gap-1 px-1.5 py-1 rounded-full bg-white/90 backdrop-blur-sm shadow-md select-none">
        {allPages.length > 1 && (
          <button
            onClick={() => goTo(pageIdx - 1)}
            disabled={pageIdx === 0}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            title="Anterior"
          >
            ←
          </button>
        )}

        {ampliado ? (
          /* Ampliado: mandan los controles de zoom, y el porcentaje es el
             botón de volver — el cliente nunca se queda atrapado dentro
             de una imagen ampliada sin salida visible. */
          <>
            <button
              onClick={() => ajustarZoom(-PASO_DE_ZOOM)}
              className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 text-base"
              title={t('zoomOut')}
              aria-label={t('zoomOut')}
            >
              −
            </button>
            <button
              onClick={restablecerZoom}
              className="text-[11px] font-semibold px-2 min-w-[52px] text-center tabular-nums rounded-full py-1 hover:bg-bg2"
              title={t('zoomReset')}
              aria-label={t('zoomReset')}
            >
              {Math.round(zoom.escala * 100)}%
            </button>
            <button
              onClick={() => ajustarZoom(PASO_DE_ZOOM)}
              disabled={zoom.escala >= ZOOM_MAXIMO}
              className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 disabled:opacity-30 disabled:cursor-not-allowed text-base"
              title={t('zoomIn')}
              aria-label={t('zoomIn')}
            >
              +
            </button>
          </>
        ) : (
          <>
            {allPages.length > 1 && (
              <div className="text-[11px] text-mute font-medium px-2 min-w-[58px] text-center tabular-nums">
                <span className="text-ink font-semibold">{pageIdx + 1}</span>
                <span className="opacity-60"> / {allPages.length}</span>
              </div>
            )}
            <button
              onClick={() => ajustarZoom(PASO_DE_ZOOM)}
              className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 text-base"
              title={t('zoomIn')}
              aria-label={t('zoomIn')}
            >
              +
            </button>
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 text-sm"
              title={isFullscreen ? 'Salir pantalla completa' : 'Pantalla completa'}
            >
              {isFullscreen ? '⤓' : '⤢'}
            </button>
          </>
        )}

        {allPages.length > 1 && (
          <button
            onClick={() => goTo(pageIdx + 1)}
            disabled={pageIdx >= allPages.length - 1}
            className="w-8 h-8 flex items-center justify-center rounded-full text-ink hover:bg-bg2 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
            title="Siguiente"
          >
            →
          </button>
        )}
      </div>

      {/* Popup overlay */}
      {openPopup && (
        <PopupOverlay popup={openPopup} onClose={() => setOpenPopup(null)} />
      )}
    </div>
  );
}

/** Medidas de la página que se está mirando, para cuando el zoom sale de un
 *  botón y no de un gesto. La página CONCRETA y no la primera del scroller:
 *  cada carta mezcla tamaños y con la equivocada el arrastre se limitaría
 *  mal. */
function medidasDelSlide(scroller: HTMLDivElement | null, indice: number) {
  const vacio = { ancho: 0, alto: 0, anchoVisible: 0, altoVisible: 0 };
  if (!scroller) return vacio;
  const slide = scroller.children[indice] as HTMLElement | undefined;
  if (!slide) return vacio;
  const img = slide.querySelector('img');
  return {
    ancho: img instanceof HTMLImageElement ? img.offsetWidth : slide.clientWidth,
    alto: img instanceof HTMLImageElement ? img.offsetHeight : slide.clientHeight,
    anchoVisible: slide.clientWidth,
    altoVisible: slide.clientHeight,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Slide individual: ocupa todo el ancho del scroller, aspect 3:4 portrait
// ─────────────────────────────────────────────────────────────────────

function PaginaDelLibro({
  page,
  indice,
  indiceActivo,
  activa,
  vertical = false,
  zoom,
  animar,
  onZoom,
  onAbrirPopup,
}: {
  page: Page & { sectionId: string };
  indice: number;
  indiceActivo: number;
  activa: boolean;
  vertical?: boolean;
  zoom: Zoom;
  animar: boolean;
  onZoom: (z: Zoom, animar: boolean) => void;
  onAbrirPopup: (popup: Popup) => void;
}) {
  const slideRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Espejo del zoom para los listeners nativos: se registran una vez por
  // página activa y leerían un valor viejo si dependieran del closure.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Mismo motivo para el callback: si el efecto dependiera de él, los
  // listeners se volverían a registrar en cada movimiento del pellizco.
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;
  const gesto = useRef<{
    pellizco: { d0: number; escala0: number } | null;
    arrastre: { x0: number; y0: number; d0: { x: number; y: number }; movido: boolean } | null;
    ultimoToque: { t: number; x: number; y: number } | null;
    ultimoGesto: number;
    temporizadorPopup: number | null;
  }>({
    pellizco: null,
    arrastre: null,
    ultimoToque: null,
    ultimoGesto: 0,
    temporizadorPopup: null,
  });

  // Solo la página que se está mirando escucha gestos. Las demás no tienen
  // por qué: están fuera de pantalla y sus listeners solo estorbarían.
  useEffect(() => {
    const el = slideRef.current;
    if (!el || !activa) return;
    const g = gesto.current;
    const emitirZoom = (z: Zoom, animar: boolean) => onZoomRef.current(z, animar);

    function medidas() {
      const img = imgRef.current;
      const hueco = slideRef.current;
      if (!img || !hueco) return { ancho: 0, alto: 0, anchoVisible: 0, altoVisible: 0 };
      // offsetWidth/Height son el tamaño ANTES del transform — justo lo que
      // necesitan las cuentas del zoom.
      return {
        ancho: img.offsetWidth,
        alto: img.offsetHeight,
        anchoVisible: hueco.clientWidth,
        altoVisible: hueco.clientHeight,
      };
    }

    /** Punto medido desde el centro del hueco visible. */
    function puntoRelativo(clientX: number, clientY: number) {
      const r = el!.getBoundingClientRect();
      return {
        x: clientX - (r.left + r.width / 2),
        y: clientY - (r.top + r.height / 2),
      };
    }

    function marcarGesto() {
      g.ultimoGesto = Date.now();
    }

    function cancelarPopup() {
      if (g.temporizadorPopup != null) {
        window.clearTimeout(g.temporizadorPopup);
        g.temporizadorPopup = null;
      }
    }

    function dedo(tc: Touch) {
      return { x: tc.clientX, y: tc.clientY };
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        g.pellizco = {
          d0: distanciaEntreDedos(dedo(e.touches[0]), dedo(e.touches[1])),
          escala0: zoomRef.current.escala,
        };
        g.arrastre = null;
        cancelarPopup();
        e.preventDefault();
      } else if (e.touches.length === 1) {
        g.pellizco = null;
        g.arrastre = {
          x0: e.touches[0].clientX,
          y0: e.touches[0].clientY,
          d0: zoomRef.current.desplazamiento,
          movido: false,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      const z = zoomRef.current;
      if (e.touches.length === 2 && g.pellizco) {
        const a = dedo(e.touches[0]);
        const b = dedo(e.touches[1]);
        const nueva = escalaDelPellizco(
          g.pellizco.escala0,
          g.pellizco.d0,
          distanciaEntreDedos(a, b),
        );
        const centro = puntoMedio(a, b);
        emitirZoom(
          zoomHaciaUnPunto({
            escala: z.escala,
            nuevaEscala: nueva,
            desplazamiento: z.desplazamiento,
            punto: puntoRelativo(centro.x, centro.y),
            medidas: medidas(),
          }),
          false,
        );
        marcarGesto();
        e.preventDefault();
        return;
      }
      // Un dedo: solo lo tomamos cuando la página está ampliada. Si no, el
      // arrastre es del slider y tiene que pasar hoja como siempre.
      if (e.touches.length === 1 && g.arrastre && !pasaPagina(z.escala)) {
        const dx = e.touches[0].clientX - g.arrastre.x0;
        const dy = e.touches[0].clientY - g.arrastre.y0;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          g.arrastre.movido = true;
          cancelarPopup();
        }
        emitirZoom(
          {
            escala: z.escala,
            desplazamiento: limitarDesplazamiento(
              { x: g.arrastre.d0.x + dx, y: g.arrastre.d0.y + dy },
              z.escala,
              medidas(),
            ),
          },
          false,
        );
        marcarGesto();
        e.preventDefault();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      const huboPellizco = !!g.pellizco;
      g.pellizco = null;
      if (e.touches.length > 0) return;
      const arrastre = g.arrastre;
      g.arrastre = null;
      if (huboPellizco || arrastre?.movido) {
        marcarGesto();
        return;
      }
      const tc = e.changedTouches[0];
      if (!tc) return;
      const ahora = Date.now();
      const previo = g.ultimoToque;
      const esDoble =
        previo != null &&
        ahora - previo.t < VENTANA_DOBLE_TOQUE &&
        Math.hypot(tc.clientX - previo.x, tc.clientY - previo.y) < 40;
      if (esDoble) {
        g.ultimoToque = null;
        cancelarPopup();
        const z = zoomRef.current;
        emitirZoom(
          zoomHaciaUnPunto({
            escala: z.escala,
            nuevaEscala: zoomDelDobleToque(z.escala),
            desplazamiento: z.desplazamiento,
            punto: puntoRelativo(tc.clientX, tc.clientY),
            medidas: medidas(),
          }),
          true,
        );
        marcarGesto();
        e.preventDefault();
      } else {
        g.ultimoToque = { t: ahora, x: tc.clientX, y: tc.clientY };
      }
    }

    function onWheel(e: WheelEvent) {
      const z = zoomRef.current;
      // Sin Ctrl y sin ampliar, la rueda es de la página: nadie se queda
      // atrapado sin poder seguir bajando.
      if (!laRuedaAmplia(z.escala, e.ctrlKey || e.metaKey)) return;
      // El deslizamiento LATERAL del trackpad manda deltaY=0. Eso no es
      // «reducir», es que no hay gesto vertical: sin este corte, deslizar de
      // lado con la página ampliada la iba encogiendo sola.
      const paso = pasoDeLaRueda(e.deltaY);
      if (paso === 0) return;
      e.preventDefault();
      emitirZoom(
        zoomHaciaUnPunto({
          escala: z.escala,
          nuevaEscala: limitarZoom(z.escala + paso),
          desplazamiento: z.desplazamiento,
          punto: puntoRelativo(e.clientX, e.clientY),
          medidas: medidas(),
        }),
        true,
      );
      marcarGesto();
    }

    // passive:false porque TODOS estos preventDefault son el mecanismo: sin
    // ellos el navegador se queda el gesto y el arrastre acaba pasando hoja.
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: false });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('wheel', onWheel);
      cancelarPopup();
    };
  }, [activa]);

  const ampliadaEsta = activa && !pasaPagina(zoom.escala);
  const carga = cargaDeLaPagina(indice, indiceActivo);
  const srcSet = srcSetDelLibro(page.imageUrl);

  /** Un toque limpio abre el popup — pero espera por si es un doble toque
   *  (ampliar), que no debe abrirlo. */
  function alTocar() {
    if (!page.popup) return;
    if (ampliadaEsta) return; // ampliada, el toque es para moverla
    if (Date.now() - gesto.current.ultimoGesto < 400) return; // venía de un gesto
    const popup = page.popup;
    gesto.current.temporizadorPopup = window.setTimeout(() => {
      gesto.current.temporizadorPopup = null;
      onAbrirPopup(popup);
    }, ESPERA_DEL_POPUP);
  }

  // La página se ajusta a la PANTALLA, no solo a su ancho.
  //
  // Antes la imagen era `w-full h-auto`: se escalaba por ancho y el alto salía
  // del aspect ratio. Con una página alta se salía de la pantalla y se veía
  // cortada; con una baja quedaba un hueco blanco debajo (De Godoy, reportado
  // por Javier el 2026-09-22). Ahora el slide llena el hueco del scroller y la
  // imagen se contiene dentro: se ve entera, centrada y sin bandas, sea cual
  // sea la proporción de la página y el tamaño del teléfono.
  return (
    <div
      ref={slideRef}
      className={`flex-none w-full h-full snap-start snap-always flex items-center justify-center ${
        ampliadaEsta ? 'overflow-hidden' : ''
      }`}
      style={{
        // Mientras está ampliada el gesto es NUESTRO; si no, se lo dejamos
        // al slider para que pase hoja como siempre.
        touchAction: ampliadaEsta ? 'none' : vertical ? 'pan-y' : 'pan-x',
      }}
    >
      <button
        type="button"
        onClick={alTocar}
        onDoubleClick={(e) => {
          // Escritorio: doble clic amplía igual que el doble toque.
          e.preventDefault();
          // El PRIMER clic del doble ya dejó armado el temporizador del popup.
          // Sin cancelarlo, el doble clic ampliaba Y abría el popup encima de
          // una página al 250 %, y al cerrarlo seguía ampliada.
          if (gesto.current.temporizadorPopup != null) {
            window.clearTimeout(gesto.current.temporizadorPopup);
            gesto.current.temporizadorPopup = null;
          }
          gesto.current.ultimoGesto = Date.now();
          const r = slideRef.current?.getBoundingClientRect();
          const punto = r
            ? { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) }
            : { x: 0, y: 0 };
          const img = imgRef.current;
          onZoom(
            zoomHaciaUnPunto({
              escala: zoom.escala,
              nuevaEscala: zoomDelDobleToque(zoom.escala),
              desplazamiento: zoom.desplazamiento,
              punto,
              medidas: {
                ancho: img?.offsetWidth ?? 0,
                alto: img?.offsetHeight ?? 0,
                anchoVisible: slideRef.current?.clientWidth ?? 0,
                altoVisible: slideRef.current?.clientHeight ?? 0,
              },
            }),
            true,
          );
        }}
        aria-label={page.popup ? 'Abrir el aviso de esta página' : 'Ampliar la página'}
        className="relative inline-flex h-full w-full items-center justify-center"
        style={{ cursor: ampliadaEsta ? 'grab' : page.popup ? 'pointer' : 'zoom-in' }}
      >
        <img
          ref={imgRef}
          // El `src` va también por el optimizador: si el navegador no
          // entiende `srcset` (o la URL no se puede optimizar) igual recibe
          // algo del tamaño correcto y no el original de varios MB.
          src={urlOptimizada(page.imageUrl, ANCHO_POR_DEFECTO)}
          {...(srcSet ? { srcSet, sizes: TAMANOS_DEL_LIBRO } : {})}
          alt=""
          loading={carga.loading as 'eager' | 'lazy'}
          fetchPriority={carga.fetchPriority as 'high' | 'low' | 'auto'}
          decoding="async"
          className="block max-h-full max-w-full w-auto h-auto object-contain"
          draggable={false}
          style={
            ampliadaEsta
              ? {
                  transform: `translate(${zoom.desplazamiento.x}px, ${zoom.desplazamiento.y}px) scale(${zoom.escala})`,
                  transformOrigin: 'center center',
                  transition: animar ? 'transform 140ms ease-out' : 'none',
                  willChange: 'transform',
                }
              : undefined
          }
        />
        {page.popup && !ampliadaEsta && (
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
  // M9: NULL/missing del API → EXTERNAL_LINK por back compat. Toda la
  // lógica de render se ramifica acá.
  const effectiveType: PopupType = popup.type ?? 'EXTERNAL_LINK';
  const isImageOnly = effectiveType === 'IMAGE';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-xl relative"
      >
        {/* Botón cerrar siempre presente — único modo de salir cuando type=IMAGE. */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-2 right-2 z-10 w-9 h-9 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-sm shadow text-ink hover:bg-white text-xl leading-none"
        >
          ×
        </button>

        {/* IMAGE: full-bleed sin recortar + caption + sin CTA. */}
        {isImageOnly ? (
          <>
            {popup.imageUrl ? (
              <img
                src={popup.imageUrl}
                alt={popup.title ?? ''}
                className="w-full max-h-[70vh] object-contain rounded-t-2xl bg-black/5"
              />
            ) : (
              <div className="w-full aspect-[3/4] bg-bg2 rounded-t-2xl flex items-center justify-center text-mute text-sm">
                Sin imagen
              </div>
            )}
            {(popup.title || popup.imageCaption || popup.description) && (
              <div className="p-5 space-y-2">
                {popup.title && (
                  <h3 className="text-lg font-bold m-0">{popup.title}</h3>
                )}
                {popup.imageCaption && (
                  <p className="text-sm font-medium m-0">
                    {popup.imageCaption}
                  </p>
                )}
                {popup.description && (
                  <p className="text-sm text-mute whitespace-pre-line leading-relaxed m-0">
                    {popup.description}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <>
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
                {effectiveType === 'CARD' && popup.cardId ? (
                  <a
                    href={`/c/${popup.cardId}`}
                    onClick={() => {
                      // Cerramos antes de la navegación para que al volver
                      // (back) no quede el popup encima.
                      onClose();
                    }}
                    className="text-sm font-semibold px-4 py-2 rounded-md text-white shadow-sm"
                    style={{ background: popup.buttonColor || '#22c55e' }}
                  >
                    {popup.cardCtaLabel?.trim() || 'Reclamar mi tarjeta'}
                  </a>
                ) : null}
                {effectiveType === 'CARD' && !popup.cardId ? (
                  // El popup tipo CARD perdió su FK (Card eliminada con
                  // ON DELETE SET NULL). Mostramos un fallback discreto en
                  // lugar de dejar el popup sin CTA.
                  <span className="text-xs italic text-mute self-center">
                    Tarjeta no disponible
                  </span>
                ) : null}
                {effectiveType === 'EXTERNAL_LINK'
                  ? (() => {
                      const safeHref = popup.buttonUrl
                        ? safeUrlOrNull(popup.buttonUrl)
                        : null;
                      if (!popup.buttonText || !safeHref) return null;
                      return (
                        <a
                          href={safeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold px-4 py-2 rounded-md text-white shadow-sm"
                          style={{ background: popup.buttonColor || '#22c55e' }}
                        >
                          {popup.buttonText}
                        </a>
                      );
                    })()
                  : null}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
