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
// ARQUITECTURA QUE NO SE NEGOCIA: plano en reposo, 3D solo en vuelo.
// La primera versión montaba TODAS las hojas visibles como pilas 3D
// (columnas anidadas con preserve-3d + doble cara). El compositor quedaba
// con una docena de capas 3D de imágenes grandes y el raster se arrastraba
// —medido contra Degodoy (105 páginas) el mismo día del estreno—. Ahora en
// reposo cada página visible es UNA imagen plana, como el modo deslizar, y
// solo la hoja que está girando se convierte en la pila 3D mientras dura el
// vuelo (<1 s).
//
// Este componente SOLO pinta el libro. El armazón (chips de sección, popups,
// URL de sección, pantalla completa, contador) sigue siendo de
// `MenuBookViewer`, que nos controla por `pageIdx`. Las flechas del visor
// pasan POR HOJA vía `registrarPaso` (en doble página una flecha son dos
// páginas; el visor no tiene por qué saberlo).
//
// A propósito NO usa react-pageflip: ya estuvo en el visor y se quitó porque
// en móvil apilaba las páginas en vez de paginar. Todo esto es CSS 3D + la
// matemática de `lib/menu/hoja-del-libro.mjs`, probada desde node
// (`scripts/pruebas-libro-hoja.mjs`).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

/** Columnas de curvatura de la hoja EN VUELO. */
const COLS = 3;
/** A partir de este ancho el libro se abre a doble página. */
const ANCHO_SPREAD = 720;
/** Ancho que se le pide al optimizador para cada cara. */
const ANCHO_IMG = 828;

const suaviza = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** La imagen de una página, plana. La misma pieza sirve en reposo y dentro
 *  de las columnas del vuelo. */
function ImagenDePagina({
  pagina,
  prioritaria,
  spread,
  onProporcion,
}: {
  pagina: Pagina | null;
  prioritaria: boolean;
  spread: boolean;
  onProporcion?: (p: number) => void;
}) {
  if (!pagina) return <div className="absolute inset-0 bg-[#F4F0E6]" />;
  const srcSet = srcSetDelLibro(pagina.imageUrl);
  return (
    <img
      src={urlOptimizada(pagina.imageUrl, ANCHO_IMG)}
      {...(srcSet ? { srcSet, sizes: spread ? '50vw' : '100vw' } : {})}
      alt=""
      draggable={false}
      loading={prioritaria ? 'eager' : 'lazy'}
      fetchPriority={prioritaria ? 'high' : 'auto'}
      decoding="async"
      className="absolute inset-0 w-full h-full object-contain select-none"
      onLoad={
        onProporcion
          ? (e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                onProporcion(img.naturalWidth / img.naturalHeight);
              }
            }
          : undefined
      }
    />
  );
}

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
  const vueloRef = useRef<HTMLDivElement>(null);
  const [medidas, setMedidas] = useState({ ancho: 0, alto: 0 });
  // Proporción de página: la de la PRIMERA imagen. Un menú de páginas
  // HORIZONTALES abre un libro apaisado — el libro toma el estilo de la
  // imagen que el negocio subió.
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
  // Refs siempre-actuales: `termina` puede dispararse desde un temporizador
  // viejo (la red del vuelo) y con un closure de `hojas`/`spread` de otro
  // render reportaba una página equivocada — así se atascó el contador
  // probando contra Degodoy con la pestaña oculta.
  const hojasRef = useRef(hojas);
  hojasRef.current = hojas;
  const spreadRef = useRef(spread);
  spreadRef.current = spread;
  // La hoja en vuelo: índice + hacia dónde va. null = todo plano.
  const [vuelo, setVuelo] = useState<{
    idxHoja: number;
    /** El vuelo arranca solo (toque/flecha) o lo lleva el dedo. */
    animar: { haciaPasada: boolean; desdeAngulo: number } | null;
  } | null>(null);
  const girandoRef = useRef<number | null>(null);

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

  const pintaHoja = useCallback((el: HTMLElement, angulo: number) => {
    const arco = curvaturaEnAngulo(angulo, COLS);
    el.style.transform = `rotateY(${angulo}deg)`;
    el.querySelectorAll<HTMLElement>('.seg-curva').forEach((seg) => {
      seg.style.transform = `rotateY(${arco}deg)`;
    });
    const enVuelo = Math.sin((Math.min(Math.abs(angulo), 180) / 180) * Math.PI);
    el.querySelectorAll<HTMLElement>('.velo-f').forEach((v) => {
      v.style.background = `linear-gradient(90deg, rgba(0,0,0,${0.22 * enVuelo}), transparent 55%)`;
    });
    el.querySelectorAll<HTMLElement>('.velo-d').forEach((v) => {
      v.style.background = `linear-gradient(270deg, rgba(0,0,0,${0.18 * enVuelo}), transparent 55%)`;
    });
    el.style.filter =
      enVuelo > 0.03
        ? `drop-shadow(${-10 * enVuelo}px ${14 * enVuelo}px ${11 * enVuelo}px rgba(0,0,0,${0.22 * enVuelo}))`
        : 'none';
  }, []);

  const topeRef = useRef<number | null>(null);
  const termina = useCallback(
    (nuevasPasadas: number) => {
      if (girandoRef.current != null) cancelAnimationFrame(girandoRef.current);
      girandoRef.current = null;
      if (topeRef.current != null) window.clearTimeout(topeRef.current);
      topeRef.current = null;
      setVuelo(null);
      setPasadas(nuevasPasadas);
      onPageIdx(
        paginaActiva(hojasRef.current, nuevasPasadas, spreadRef.current),
      );
    },
    [onPageIdx],
  );

  const anima = useCallback(
    (idxHoja: number, haciaPasada: boolean, desdeAngulo: number) => {
      const el = vueloRef.current;
      const destino = haciaPasada ? -180 : 0;
      const nuevas = haciaPasada ? idxHoja + 1 : idxHoja;
      if (!el || reducido) {
        termina(nuevas);
        return;
      }
      const dur = duracionDelVuelo(desdeAngulo, destino);
      const t0 = performance.now();
      const paso = (ahora: number) => {
        const t = Math.min(1, (ahora - t0) / dur);
        pintaHoja(el, desdeAngulo + (destino - desdeAngulo) * suaviza(t));
        if (t < 1) girandoRef.current = requestAnimationFrame(paso);
        else termina(nuevas);
      };
      girandoRef.current = requestAnimationFrame(paso);
      // Red del vuelo: en una pestaña oculta el navegador PAUSA los frames y
      // la hoja quedaría a medio girar para siempre (pasó probándolo con el
      // tab en segundo plano). Si los frames no llegan, el temporizador
      // asienta la hoja igual — los timers sí corren en background.
      topeRef.current = window.setTimeout(() => {
        if (girandoRef.current != null) termina(nuevas);
      }, dur + 600);
    },
    [reducido, termina, pintaHoja],
  );

  // El vuelo automático arranca cuando la pila 3D ya está montada. SIN
  // requestAnimationFrame: en una pestaña oculta no corre y el vuelo se
  // quedaba armado para siempre bloqueando todos los pases siguientes.
  useLayoutEffect(() => {
    if (!vuelo?.animar) return;
    const { haciaPasada, desdeAngulo } = vuelo.animar;
    anima(vuelo.idxHoja, haciaPasada, desdeAngulo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vuelo?.animar]);

  /** Una hoja adelante o atrás (flechas del visor, toque seco). */
  const pasaHoja = useCallback(
    (delta: 1 | -1) => {
      if (girandoRef.current != null || vuelo) return;
      const k = pasadasRef.current;
      const idxHoja = delta > 0 ? k : k - 1;
      if (idxHoja < 0 || idxHoja >= hojas.length) return;
      // Pestaña oculta: nadie ve la animación y el navegador ni la corre.
      // Se salta directo al estado final.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        const nuevas = delta > 0 ? idxHoja + 1 : idxHoja;
        setPasadas(nuevas);
        onPageIdx(paginaActiva(hojasRef.current, nuevas, spreadRef.current));
        return;
      }
      setVuelo({
        idxHoja,
        animar: { haciaPasada: delta > 0, desdeAngulo: delta > 0 ? 0 : -180 },
      });
    },
    [hojas.length, vuelo, onPageIdx],
  );

  useEffect(() => {
    registrarPaso?.(pasaHoja);
  }, [registrarPaso, pasaHoja]);

  // ── El visor pide otra página (chips de sección, deep-link) ──────
  useEffect(() => {
    if (girandoRef.current != null || vuelo) return;
    const objetivo = pasadasParaVer(hojas, pageIdx, spread);
    if (objetivo === pasadas) return;
    if (
      Math.abs(objetivo - pasadas) === 1 &&
      (typeof document === 'undefined' || document.visibilityState !== 'hidden')
    ) {
      const haciaPasada = objetivo > pasadas;
      setVuelo({
        idxHoja: haciaPasada ? pasadas : pasadas - 1,
        animar: { haciaPasada, desdeAngulo: haciaPasada ? 0 : -180 },
      });
    } else {
      // Salto largo: directo, como el 'instant' del modo deslizar.
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
    if (girandoRef.current != null || vuelo || !pages.length) return;
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
    if (!a.movio) {
      if (Math.abs(e.clientX - a.inicioX) < 6) return;
      a.movio = true;
      // Recién aquí se monta la pila 3D: un toque seco nunca la necesita.
      setVuelo({ idxHoja: a.idxHoja, animar: null });
    }
    const el = vueloRef.current;
    if (!el) return;
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
    anima(a.idxHoja, decideAlSoltar(a.angulo, a.velocidad), a.angulo);
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

  // ── Qué se pinta en REPOSO (todo plano) ──────────────────────────
  // Izquierda: el dorso de la última hoja pasada. Derecha: el frente de la
  // hoja siguiente. Debajo de cada una, la que aparecería al pasarla (para
  // que el vuelo revele algo ya cargado y no un hueco blanco).
  const hojaIzq = pasadas > 0 ? hojas[pasadas - 1] : null;
  const hojaDer = pasadas < hojas.length ? hojas[pasadas] : null;
  const hojaIzqPrev = pasadas > 1 ? hojas[pasadas - 2] : null;
  const hojaDerSig = pasadas + 1 < hojas.length ? hojas[pasadas + 1] : null;

  // Durante un vuelo, la hoja que gira sale del reposo y se pinta como pila
  // 3D; lo que queda debajo ya está en estas capas planas.
  const enVueloIdx = vuelo?.idxHoja ?? null;

  const despl = desplazamientoDelLibro(hojas, pasadas, spread) * W;
  const defVuelo = enVueloIdx != null ? hojas[enVueloIdx] : null;
  const colW = W / COLS;

  // La pila 3D de la hoja en vuelo, construida de adentro hacia afuera: la
  // columna k vive DENTRO de la k−1, así girar una arrastra a las siguientes
  // y el papel se curva.
  let pila: JSX.Element | null = null;
  if (defVuelo) {
    for (let k = COLS - 1; k >= 0; k--) {
      pila = (
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
              <ImagenDePagina
                pagina={pages[defVuelo.frente] ?? null}
                prioritaria
                spread={spread}
              />
              <div className="velo-f absolute inset-0 pointer-events-none" />
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
              <ImagenDePagina
                pagina={defVuelo.dorso != null ? (pages[defVuelo.dorso] ?? null) : null}
                prioritaria
                spread={spread}
              />
              <div className="velo-d absolute inset-0 pointer-events-none" />
            </div>
          </div>
          {pila}
        </div>
      );
    }
  }

  /** Una página plana de reposo, posicionada por lado. */
  function plana(
    def: DefHoja | null,
    lado: 'izq' | 'der',
    cara: 'frente' | 'dorso',
    z: number,
    prioritaria: boolean,
  ) {
    if (!def) return null;
    const idx = cara === 'frente' ? def.frente : def.dorso;
    return (
      <div
        className="absolute top-0 overflow-hidden bg-white"
        style={{
          left: lado === 'der' && spread ? W : 0,
          width: W,
          height: H,
          zIndex: z,
        }}
      >
        <ImagenDePagina
          pagina={idx != null ? (pages[idx] ?? null) : null}
          prioritaria={prioritaria}
          spread={spread}
          onProporcion={idx === 0 ? setProporcion : undefined}
        />
      </div>
    );
  }

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
          // La perspectiva solo existe mientras hay una hoja en vuelo: dejarla
          // fija promueve TODAS las páginas planas a capas 3D y el compositor
          // vuelve a arrastrarse (la lección de Degodoy, dos veces).
          ...(vuelo ? { perspective: 1600 } : {}),
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

        {/* Reposo, todo plano. La hoja en vuelo se excluye de su lado:
            su imagen la lleva la pila 3D. */}
        {spread && enVueloIdx !== (pasadas > 1 ? pasadas - 2 : -1) &&
          plana(hojaIzqPrev, 'izq', 'dorso', 4, false)}
        {spread && enVueloIdx !== (pasadas > 0 ? pasadas - 1 : -1) &&
          plana(hojaIzq, 'izq', 'dorso', 6, true)}
        {enVueloIdx !== (pasadas + 1 < hojas.length ? pasadas + 1 : -1) &&
          plana(hojaDerSig, 'der', 'frente', 4, false)}
        {enVueloIdx !== (pasadas < hojas.length ? pasadas : -1) &&
          plana(hojaDer, 'der', 'frente', 6, true)}

        {/* La hoja en vuelo: la única pila 3D, y solo mientras vuela. */}
        {defVuelo && (
          <div
            ref={vueloRef}
            className="absolute top-0"
            style={{
              left: spread ? W : 0,
              width: W,
              height: H,
              zIndex: 60,
              transformStyle: 'preserve-3d',
              transformOrigin: 'left center',
              transform:
                vuelo?.animar == null && enVueloIdx != null && enVueloIdx < pasadas
                  ? 'rotateY(-180deg)'
                  : vuelo?.animar
                    ? `rotateY(${vuelo.animar.desdeAngulo}deg)`
                    : 'rotateY(0deg)',
            }}
          >
            {pila}
          </div>
        )}
      </div>
    </div>
  );
}
