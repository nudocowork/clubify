'use client';

// El MODO LIBRO del menú (efecto de hoja, 2026-09-30).
//
// Javier eligió el estilo del flipbook de referencia (La Gloriosa en
// Heyzine): portada sola y centrada, interior a DOBLE PÁGINA con la página
// siguiente en el dorso de la hoja, y el pase que SIGUE EL DEDO — se agarra
// la hoja por el borde, se arquea en el vuelo con su sombra, y al soltarla
// decide sola si cae o se devuelve. En el teléfono, una página a la vez con
// la misma hoja.
//
// Este componente SOLO pinta el libro. El armazón (chips de sección, popups,
// URL de sección, pantalla completa, contador) sigue siendo de
// `MenuBookViewer`, que nos controla por `pageIdx` — así los deep-links y
// los popups funcionan idéntico en los dos modos. Las flechas del visor
// avanzan POR HOJA a través de `registrarPaso` (en doble página una flecha
// son dos páginas; el visor no tiene por qué saberlo).
//
// A propósito NO usa react-pageflip: ya estuvo en el visor y se quitó porque
// en móvil apilaba las páginas en vez de paginar. Todo esto es CSS 3D + la
// matemática de `lib/menu/hoja-del-libro.mjs`, probada desde node
// (`scripts/pruebas-libro-hoja.mjs`).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { srcSetDelLibro, urlOptimizada } from '@/lib/menu/imagen-del-libro.mjs';
import {
  anguloDesdePuntero,
  curvaturaEnAngulo,
  decideAlSoltar,
  desplazamientoDelLibro,
  duracionDelVuelo,
  hojasDelLibro,
  paginaActiva,
  pasadasParaVer,
} from '@/lib/menu/hoja-del-libro.mjs';

type Popup = Record<string, unknown>;
type Pagina = { id: string; imageUrl: string; popup: Popup | null };
type DefHoja = { frente: number; dorso: number | null };

/** Columnas de curvatura por hoja: 3 bastan para que el papel se arquee sin
 *  multiplicar por mucho las imágenes montadas. */
const COLS = 3;
/** A partir de este ancho el libro se abre a doble página. */
const ANCHO_SPREAD = 720;
/** Ancho que se le pide al optimizador para cada cara. */
const ANCHO_IMG = 828;

const suaviza = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

// ─────────────────────────────────────────────────────────────────────
// Una cara de hoja (fuera del componente padre a propósito: definirlos
// adentro les cambia la identidad en cada render y React desmonta y
// remonta las imágenes — el libro parpadearía con cada pase).
// ─────────────────────────────────────────────────────────────────────
function CaraDeHoja({
  pagina,
  dorso,
  activa,
  spread,
  esPrimera,
  onProporcion,
}: {
  pagina: Pagina | null;
  dorso: boolean;
  activa: boolean;
  spread: boolean;
  esPrimera: boolean;
  onProporcion: (p: number) => void;
}) {
  const srcSet = pagina ? srcSetDelLibro(pagina.imageUrl) : null;
  if (!pagina) {
    // Dorso de papel (móvil, o última hoja de un total impar).
    return <div className="absolute inset-0 bg-[#F4F0E6]" />;
  }
  return (
    <>
      <img
        src={urlOptimizada(pagina.imageUrl, ANCHO_IMG)}
        {...(srcSet ? { srcSet, sizes: spread ? '50vw' : '100vw' } : {})}
        alt=""
        draggable={false}
        // La ventana de hojas ya limita cuánto se monta; dentro de ella, la
        // cara que se mira va con prioridad y el resto en lazy.
        loading={activa ? 'eager' : 'lazy'}
        fetchPriority={activa ? 'high' : 'auto'}
        decoding="async"
        className="absolute inset-0 w-full h-full object-contain select-none"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (esPrimera && img.naturalWidth && img.naturalHeight) {
            onProporcion(img.naturalWidth / img.naturalHeight);
          }
        }}
      />
      <div
        className={`${dorso ? 'velo-d' : 'velo-f'} absolute inset-0 pointer-events-none`}
      />
    </>
  );
}

function HojaDelLibro({
  def,
  idxHoja,
  pasada,
  totalHojas,
  pages,
  W,
  H,
  spread,
  registraRef,
  onProporcion,
}: {
  def: DefHoja;
  idxHoja: number;
  pasada: boolean;
  totalHojas: number;
  pages: Pagina[];
  W: number;
  H: number;
  spread: boolean;
  registraRef: (idx: number, el: HTMLDivElement | null) => void;
  onProporcion: (p: number) => void;
}) {
  const colW = W / COLS;
  // Se construye de adentro hacia afuera: la columna k vive DENTRO de la
  // k−1, así girar una arrastra a las siguientes y el papel se curva.
  let interior: JSX.Element | null = null;
  for (let k = COLS - 1; k >= 0; k--) {
    interior = (
      <div
        className={k === 0 ? 'seg-raiz' : 'seg-curva'}
        style={{
          position: 'absolute',
          top: 0,
          left: k === 0 ? 0 : colW,
          width: colW + 0.7,
          height: H,
          transformStyle: 'preserve-3d',
          transformOrigin: 'left center',
        }}
      >
        <div
          className="absolute inset-0 overflow-hidden bg-white"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div
            className="absolute top-0"
            style={{ width: W, height: H, transform: `translateX(${-k * colW}px)` }}
          >
            <CaraDeHoja
              pagina={pages[def.frente] ?? null}
              dorso={false}
              activa={!pasada}
              spread={spread}
              esPrimera={def.frente === 0}
              onProporcion={onProporcion}
            />
          </div>
        </div>
        <div
          className="absolute inset-0 overflow-hidden bg-white"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        >
          <div
            className="absolute top-0"
            style={{
              width: W,
              height: H,
              transform: `translateX(${-(COLS - 1 - k) * colW}px)`,
            }}
          >
            <CaraDeHoja
              pagina={def.dorso != null ? (pages[def.dorso] ?? null) : null}
              dorso
              activa={pasada}
              spread={spread}
              esPrimera={false}
              onProporcion={onProporcion}
            />
          </div>
        </div>
        {interior}
      </div>
    );
  }
  return (
    <div
      ref={(el) => registraRef(idxHoja, el)}
      className="absolute top-0"
      style={{
        left: spread ? W : 0,
        width: W,
        height: H,
        transformStyle: 'preserve-3d',
        transformOrigin: 'left center',
        transform: pasada ? 'rotateY(-180deg)' : 'rotateY(0deg)',
        zIndex: pasada ? 10 + idxHoja : 30 + (totalHojas - idxHoja),
      }}
    >
      {interior}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// El libro
// ─────────────────────────────────────────────────────────────────────
export function LibroDeHojas({
  pages,
  pageIdx,
  onPageIdx,
  onAbrirPopup,
  registrarPaso,
}: {
  pages: Pagina[];
  pageIdx: number;
  onPageIdx: (idx: number) => void;
  onAbrirPopup: (popup: Popup) => void;
  /** El visor registra aquí su «pasar una hoja» para las flechas. */
  registrarPaso?: (fn: (delta: 1 | -1) => void) => void;
}) {
  const marcoRef = useRef<HTMLDivElement>(null);
  const [medidas, setMedidas] = useState({ ancho: 0, alto: 0 });
  // Proporción de página: la de la PRIMERA imagen que cargue. Así un menú de
  // páginas HORIZONTALES abre un libro apaisado — el libro toma el estilo de
  // la imagen que el negocio subió.
  const [proporcion, setProporcion] = useState(3 / 4);
  const reducido = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const spread = medidas.ancho >= ANCHO_SPREAD && pages.length > 2;
  const hojas = useMemo(
    () => hojasDelLibro(pages.length, spread) as DefHoja[],
    [pages.length, spread],
  );

  const [pasadas, setPasadas] = useState(0);
  const pasadasRef = useRef(0);
  pasadasRef.current = pasadas;
  const girandoRef = useRef<number | null>(null);
  const hojaRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const registraRef = useCallback((idx: number, el: HTMLDivElement | null) => {
    if (el) hojaRefs.current.set(idx, el);
    else hojaRefs.current.delete(idx);
  }, []);

  useEffect(() => {
    const el = marcoRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setMedidas({ ancho: el.clientWidth, alto: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Página: encaja en el hueco respetando la proporción de las imágenes.
  const H = Math.max(120, medidas.alto - 34);
  const W = Math.max(
    90,
    Math.min(H * proporcion, (medidas.ancho - 16) / (spread ? 2 : 1)),
  );

  function pintaHoja(el: HTMLElement, angulo: number) {
    const arco = curvaturaEnAngulo(angulo, COLS);
    el.style.transform = `rotateY(${angulo}deg)`;
    el.querySelectorAll<HTMLElement>('.seg-curva').forEach((seg) => {
      seg.style.transform = `rotateY(${arco}deg)`;
    });
    const vuelo = Math.sin((Math.min(Math.abs(angulo), 180) / 180) * Math.PI);
    el.querySelectorAll<HTMLElement>('.velo-f').forEach((v) => {
      v.style.background = `linear-gradient(90deg, rgba(0,0,0,${0.22 * vuelo}), transparent 55%)`;
    });
    el.querySelectorAll<HTMLElement>('.velo-d').forEach((v) => {
      v.style.background = `linear-gradient(270deg, rgba(0,0,0,${0.18 * vuelo}), transparent 55%)`;
    });
    el.style.filter =
      vuelo > 0.03
        ? `drop-shadow(${-10 * vuelo}px ${14 * vuelo}px ${11 * vuelo}px rgba(0,0,0,${0.22 * vuelo}))`
        : 'none';
  }

  const termina = useCallback(
    (nuevasPasadas: number) => {
      girandoRef.current = null;
      setPasadas(nuevasPasadas);
      onPageIdx(paginaActiva(hojas, nuevasPasadas, spread));
    },
    [hojas, spread, onPageIdx],
  );

  const vuela = useCallback(
    (idxHoja: number, haciaPasada: boolean, desdeAngulo?: number) => {
      const el = hojaRefs.current.get(idxHoja);
      const destino = haciaPasada ? -180 : 0;
      const origen = desdeAngulo ?? (haciaPasada ? 0 : -180);
      const nuevas = haciaPasada ? idxHoja + 1 : idxHoja;
      if (!el || reducido) {
        termina(nuevas);
        return;
      }
      el.style.zIndex = '60';
      const dur = duracionDelVuelo(origen, destino);
      const t0 = performance.now();
      const paso = (ahora: number) => {
        const t = Math.min(1, (ahora - t0) / dur);
        pintaHoja(el, origen + (destino - origen) * suaviza(t));
        if (t < 1) girandoRef.current = requestAnimationFrame(paso);
        else termina(nuevas);
      };
      girandoRef.current = requestAnimationFrame(paso);
    },
    [reducido, termina],
  );

  /** Una hoja adelante o atrás (flechas del visor, toque seco). */
  const pasaHoja = useCallback(
    (delta: 1 | -1) => {
      if (girandoRef.current != null) return;
      const k = pasadasRef.current;
      const idxHoja = delta > 0 ? k : k - 1;
      if (idxHoja < 0 || idxHoja >= hojas.length) return;
      if (delta > 0 && k === hojas.length) return;
      vuela(idxHoja, delta > 0);
    },
    [hojas.length, vuela],
  );

  useEffect(() => {
    registrarPaso?.(pasaHoja);
  }, [registrarPaso, pasaHoja]);

  // ── El visor pide otra página (chips de sección, deep-link) ──────
  useEffect(() => {
    if (girandoRef.current != null) return;
    const objetivo = pasadasParaVer(hojas, pageIdx, spread);
    if (objetivo === pasadas) return;
    if (Math.abs(objetivo - pasadas) === 1) {
      vuela(objetivo > pasadas ? pasadas : pasadas - 1, objetivo > pasadas);
    } else {
      // Salto largo: directo, como el 'instant' del modo deslizar — animarlo
      // arrastraría todas las hojas de en medio con sus imágenes.
      setPasadas(objetivo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx, spread, hojas]);

  // ── El dedo: agarrar, seguir, soltar ─────────────────────────────
  const arrastreRef = useRef<{
    idxHoja: number;
    haciaPasada: boolean;
    movio: boolean;
    inicioX: number;
    ultimoX: number;
    t: number;
    velocidad: number;
    angulo: number;
  } | null>(null);

  function lomoX() {
    const el = marcoRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const centro = r.left + r.width / 2;
    const despl = desplazamientoDelLibro(hojas, pasadas, spread) * W;
    // En una página el «lomo» es el borde izquierdo de la página.
    return spread ? centro + despl : centro - W / 2;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (girandoRef.current != null || !pages.length) return;
    const delDerecho = spread ? e.clientX >= lomoX() : true;
    const idxHoja = delDerecho ? pasadas : pasadas - 1;
    if (idxHoja < 0 || idxHoja >= hojas.length) return;
    arrastreRef.current = {
      idxHoja,
      haciaPasada: delDerecho,
      movio: false,
      inicioX: e.clientX,
      ultimoX: e.clientX,
      t: performance.now(),
      velocidad: 0,
      angulo: delDerecho ? 0 : -180,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = arrastreRef.current;
    if (!a) return;
    const ahora = performance.now();
    a.velocidad = (e.clientX - a.ultimoX) / Math.max(1, ahora - a.t);
    a.ultimoX = e.clientX;
    a.t = ahora;
    if (!a.movio && Math.abs(e.clientX - a.inicioX) < 6) return;
    a.movio = true;
    const el = hojaRefs.current.get(a.idxHoja);
    if (!el) return;
    el.style.zIndex = '60';
    a.angulo = anguloDesdePuntero(e.clientX, lomoX(), W);
    pintaHoja(el, a.angulo);
  }

  function onPointerUp(e: React.PointerEvent) {
    const a = arrastreRef.current;
    if (!a) return;
    arrastreRef.current = null;
    if (!a.movio) {
      // Toque seco. Si la página tocada tiene popup, el toque es SUYO —
      // igual que en el modo deslizar.
      const visible = paginaTocada(e.clientX);
      const popup = visible != null ? pages[visible]?.popup : null;
      if (popup) {
        onAbrirPopup(popup);
        return;
      }
      pasaHoja(a.haciaPasada ? 1 : -1);
      return;
    }
    vuela(a.idxHoja, decideAlSoltar(a.angulo, a.velocidad), a.angulo);
  }

  /** Qué página (índice global) hay bajo un toque, para sus popups. */
  function paginaTocada(clientX: number): number | null {
    if (!spread) {
      return hojas[Math.min(pasadas, hojas.length - 1)]?.frente ?? null;
    }
    const izquierda = clientX < lomoX();
    const h = izquierda ? hojas[pasadas - 1] : hojas[pasadas];
    return izquierda ? (h?.dorso ?? null) : (h?.frente ?? null);
  }

  // Solo se montan las hojas cercanas: en una carta de 105 páginas, montar
  // las 53 hojas con sus imágenes sería bajarse el libro entero.
  const ventana: number[] = [];
  for (
    let i = Math.max(0, pasadas - 2);
    i <= Math.min(hojas.length - 1, pasadas + 1);
    i++
  ) {
    ventana.push(i);
  }

  const despl = desplazamientoDelLibro(hojas, pasadas, spread) * W;

  return (
    <div
      ref={marcoRef}
      className="flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden select-none touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="region"
      aria-label="Menú en modo libro; arrastra o toca para pasar la página"
    >
      <div
        className="relative"
        style={{
          width: spread ? W * 2 : W,
          height: H,
          perspective: 1600,
          transform: `translateX(${spread ? despl : 0}px)`,
          transition: 'transform .5s cubic-bezier(.4,.1,.2,1)',
        }}
      >
        {/* Sombra de mesa */}
        <div
          className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
          style={{
            bottom: -20,
            width: '84%',
            height: 26,
            borderRadius: '50%',
            background:
              'radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,.20), transparent 70%)',
          }}
        />
        {ventana.map((i) => (
          <HojaDelLibro
            key={hojas[i].frente}
            def={hojas[i]}
            idxHoja={i}
            pasada={i < pasadas}
            totalHojas={hojas.length}
            pages={pages}
            W={W}
            H={H}
            spread={spread}
            registraRef={registraRef}
            onProporcion={setProporcion}
          />
        ))}
      </div>
    </div>
  );
}
