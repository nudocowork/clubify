'use client';

// El MODO LIBRO del menú — versión StPageFlip (2026-09-30, segunda pasada).
//
// La primera versión (curl propio en CSS) no convenció: Javier pidió el
// nivel del flipbook de referencia (La Gloriosa en Heyzine) — la hoja que se
// AGARRA de la esquina y se dobla de verdad — y que valga para TODOS los
// menú libros, con páginas verticales u horizontales, limpio y con la
// estética de Clubify. Eso es exactamente lo que da StPageFlip (page-flip),
// la librería del propio prompt de referencia: curl 3D con sombra, arrastre
// de esquina con mouse y dedo, swipe, portada sola y doble página.
//
// LA LECCIÓN DE 2026-06 NO SE OLVIDA: react-pageflip (el WRAPPER de React)
// se quitó del visor porque en móvil apilaba páginas. Aquí NO hay wrapper:
// integramos la librería vanilla nosotros, con el tamaño calculado a mano
// (size 'fixed') y REMONTE limpio en cada cambio de tamaño/orientación — el
// modo stretch+portrait era justo lo que fallaba.
//
// El libro toma la PROPORCIÓN de la primera imagen del negocio: páginas
// horizontales abren un libro apaisado; verticales, retrato.
//
// El armazón (chips de sección, popups automáticos, URL de sección,
// deep-links, contador y flechas del pie) sigue siendo de `MenuBookViewer`,
// que nos controla por `pageIdx`. Aquí viven además las MINIATURAS, la
// LUPA (re-usa la imagen en 2400 px: nítida al ampliar) y el aviso flotante
// de las páginas con popup — el tap directo es de la librería (pasa página).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MARGEN_DE_LA_TIRA,
  REINTENTOS_DE_HOJA,
  desplazamientoDeLaTira,
  hojasVecinas,
  hojasVisibles,
  srcSetDelLibro,
  urlDeHoja,
  urlDeMiniatura,
  urlOptimizada,
} from '@/lib/menu/imagen-del-libro.mjs';

type Popup = Record<string, unknown>;
type Pagina = { id: string; imageUrl: string; popup: Popup | null };
type PageFlipInstancia = {
  loadFromHTML: (hojas: NodeListOf<Element> | HTMLElement[]) => void;
  flipNext: () => void;
  flipPrev: () => void;
  flip: (n: number) => void;
  turnToPage: (n: number) => void;
  getCurrentPageIndex: () => number;
  getPage: (n: number) => { setDensity: (d: 'soft' | 'hard') => void } | undefined;
  on: (ev: string, cb: (e: { data: unknown }) => void) => void;
  destroy: () => void;
};

/** Ancho para la lupa: alta, que el zoom no se pixele. */
const ANCHO_LUPA = 2400;

/** Alto de la miniatura en la tira (puntos CSS). Su ancho sale de la proporción. */
const ALTO_MINIATURA = 40;

/**
 * Una hoja creada a mano para StPageFlip. React no la conoce: su estado de
 * carga vive aquí y se pinta tocando el DOM directamente.
 */
type Hoja = {
  img: HTMLImageElement;
  /** Fondo animado mientras no hay imagen. */
  marcador: HTMLDivElement;
  /** «No se pudo cargar…»: solo visible tras un fallo. */
  aviso: HTMLDivElement;
  url: string;
  estado: 'vacia' | 'cargando' | 'lista' | 'error';
  intentos: number;
  /** Se resuelve al terminar el intento en curso, bien o mal. */
  promesa: Promise<void> | null;
  temporizador: number | null;
};

export function LibroDeHojas({
  pages,
  pageIdx,
  onPageIdx,
  onAbrirPopup,
  registrarPaso,
  textoReintentando = 'No se pudo cargar esta página. Reintentando…',
}: {
  pages: Pagina[];
  pageIdx: number;
  onPageIdx: (idx: number) => void;
  onAbrirPopup: (popup: Popup) => void;
  /** El visor registra aquí su «pasar una hoja» para las flechas del pie. */
  registrarPaso?: (fn: (delta: 1 | -1) => void) => void;
  /** Aviso de una hoja que falló (traducido por el visor). */
  textoReintentando?: string;
}) {
  const marcoRef = useRef<HTMLDivElement>(null);
  const librePorRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlipInstancia | null>(null);
  const [medidas, setMedidas] = useState({ ancho: 0, alto: 0 });
  // Proporción alto/ancho de la PRIMERA imagen: horizontales ⇒ apaisado.
  const [ratio, setRatio] = useState<number | null>(null);
  const [listo, setListo] = useState(false);
  const [lupa, setLupa] = useState(false);
  const pageIdxRef = useRef(pageIdx);
  pageIdxRef.current = pageIdx;
  /** Último pageIdx que CONTÓ el propio libro (su `on('flip')`). */
  const notificadoRef = useRef(-1);
  /** Estado del gesto: user_fold | fold_corner | flipping | read. */
  const estadoLibroRef = useRef('read');
  /** Las hojas del montaje actual, para pedir sus imágenes por cercanía. */
  const hojasRef = useRef<Hoja[]>([]);
  /** Si el montaje actual es a doble página (decide qué hojas se ven). */
  const dobleRef = useRef(false);
  /**
   * Turno de carga. Cada cambio de página abre uno nuevo; las vecinas de un
   * turno viejo ya no se piden (el cliente pasó de largo).
   */
  const turnoRef = useRef(0);
  /**
   * Si la primera página que se mira ya terminó (bien o mal). Hasta entonces
   * las miniaturas no piden nada: en una red móvil hasta 3 KB × 10 le quitan
   * ancho de banda a la única imagen que el cliente está esperando.
   */
  const [primeraLista, setPrimeraLista] = useState(false);
  const reducido = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // ── Medidas del hueco (con debounce: cada cambio REMONTA el libro) ──
  useEffect(() => {
    const el = marcoRef.current;
    if (!el) return;
    // Medida INICIAL síncrona: en una pestaña en segundo plano el
    // ResizeObserver puede no disparar nunca (lección repetida de este
    // visor) y el libro se quedaba esperando medidas para montar.
    setMedidas({ ancho: el.clientWidth, alto: el.clientHeight });
    let t: number | null = null;
    const ro = new ResizeObserver(() => {
      if (t != null) window.clearTimeout(t);
      t = window.setTimeout(() => {
        setMedidas({ ancho: el.clientWidth, alto: el.clientHeight });
      }, 200);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (t != null) window.clearTimeout(t);
    };
  }, []);

  // ── La librería, en paralelo con la proporción ──────────────────
  // Antes se importaba DESPUÉS de medir la proporción: dos esperas en fila
  // antes de crear siquiera la primera hoja. El import se cachea, así que
  // el montaje de abajo la encuentra ya resuelta.
  useEffect(() => {
    import('page-flip').catch(() => {
      /* el montaje lo vuelve a intentar y, si falla, se ve allí */
    });
  }, []);

  // ── Proporción de la primera página ─────────────────────────────
  useEffect(() => {
    if (!pages.length) return;
    let viva = true;
    const img = new Image();
    img.onload = () => {
      if (viva && img.naturalWidth && img.naturalHeight) {
        setRatio(img.naturalHeight / img.naturalWidth);
      }
    };
    img.onerror = () => viva && setRatio(4 / 3);
    // Con la MINIATURA de la portada (3 KB) y no con la página a 640
    // (60 KB): la proporción sale igual —el optimizador conserva el aspecto,
    // con un error de redondeo de un píxel en la hoja— y es la misma URL que
    // pinta la tira, así que esa miniatura ya no se baja dos veces. Esta
    // espera está en el camino de la primera página: todo lo que pese aquí
    // lo paga el cliente antes de ver nada.
    img.src = urlDeMiniatura(pages[0].imageUrl);
    return () => {
      viva = false;
    };
  }, [pages]);

  // ── Montar (y remontar) el libro ────────────────────────────────
  useEffect(() => {
    if (!librePorRef.current || !pages.length || !ratio || !medidas.ancho) return;
    let vivo = true;
    let instancia: PageFlipInstancia | null = null;
    (async () => {
      const { PageFlip } = await import('page-flip');
      if (!vivo || !librePorRef.current) return;

      const esPortrait = medidas.ancho < 720 || pages.length <= 2;
      const anchoDisp = medidas.ancho - 12;
      const altoDisp = medidas.alto - 10;
      const porPagina = Math.min(
        anchoDisp / (esPortrait ? 1 : 2),
        altoDisp / ratio,
      );
      const w = Math.max(180, Math.floor(porPagina));
      const h = Math.floor(w * ratio);

      // HOJAS HTML y no `loadFromImages`: el modo imágenes pinta el libro
      // en un <canvas> al tamaño CSS SIN devicePixelRatio — en cualquier
      // pantalla retina la carta salía borrosa («no se logra leer»,
      // 2026-09-30). Con hojas HTML el navegador pinta cada <img> nítido y
      // elige él la resolución que necesita vía srcset/sizes.
      const cont = librePorRef.current;
      cont.innerHTML = ''; // restos de un remonte anterior
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      dobleRef.current = !esPortrait;
      // Las hojas se crean SIN imagen. Antes las 105 recibían `src` y
      // `srcset` aquí mismo; ahora la imagen la pide el efecto de carga, y
      // solo para las que se ven y sus vecinas (ver `hojasVisibles` y
      // `hojasVecinas`). Una hoja sin pedir pinta su marcador de carga.
      hojasRef.current = pages.map((p, i) => {
        const hoja = document.createElement('div');
        hoja.dataset.density = 'soft';
        hoja.style.background = '#fff';
        hoja.style.overflow = 'hidden';
        // Envoltorio propio: el estilo de posición de la hoja lo maneja
        // StPageFlip, y el marcador y el aviso necesitan uno relativo.
        const caja = document.createElement('div');
        caja.style.position = 'relative';
        caja.style.width = '100%';
        caja.style.height = '100%';
        const marcador = document.createElement('div');
        marcador.className = 'absolute inset-0 animate-pulse';
        marcador.style.background = '#EEF1F4';
        const aviso = document.createElement('div');
        aviso.className =
          'absolute inset-x-3 top-1/2 -translate-y-1/2 text-center text-[12px] font-medium text-mute';
        aviso.style.display = 'none';
        aviso.textContent = textoReintentando;
        const img = document.createElement('img');
        img.decoding = 'async';
        img.alt = `Página ${i + 1}`;
        img.draggable = false;
        img.style.position = 'relative'; // por encima del marcador
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain'; // una carta no se recorta jamás
        img.style.pointerEvents = 'none'; // el gesto es del libro, no del <img>
        caja.appendChild(marcador);
        caja.appendChild(aviso);
        caja.appendChild(img);
        hoja.appendChild(caja);
        cont.appendChild(hoja);
        return {
          img,
          marcador,
          aviso,
          url: urlDeHoja(p.imageUrl, w, dpr),
          estado: 'vacia',
          intentos: 0,
          promesa: null,
          temporizador: null,
        } satisfies Hoja;
      });

      notificadoRef.current = -1;
      estadoLibroRef.current = 'read';
      instancia = new PageFlip(cont, {
        width: w,
        height: h,
        size: 'fixed',
        showCover: true, // la portada va sola y centrada
        usePortrait: esPortrait,
        flippingTime: reducido ? 80 : 600,
        maxShadowOpacity: 0.5,
        drawShadow: true,
        mobileScrollSupport: false,
        swipeDistance: 24,
        showPageCorners: true,
        useMouseEvents: true,
      }) as unknown as PageFlipInstancia;
      instancia.loadFromHTML(cont.querySelectorAll('[data-density]'));
      // TODAS las hojas blandas, también la portada (Javier, 2026-10-01: la
      // tapa dura «no me gusta»). Con `showCover`, StPageFlip ENDURECE por su
      // cuenta la primera página —y la última si queda sola— al armar los
      // pliegos, ignore lo que diga `data-density`. Solo lo hace al cargar,
      // así que basta con devolverlas a blandas justo después; `showCover`
      // se queda porque es lo que deja la portada sola y centrada.
      for (let i = 0; i < pages.length; i++) {
        instancia.getPage(i)?.setDensity('soft');
      }
      instancia.on('flip', (e) => {
        const n = Number(e.data);
        notificadoRef.current = n;
        onPageIdx(n);
      });
      instancia.on('changeState', (e) => {
        const estado = String(e.data);
        estadoLibroRef.current = estado;
        if (estado !== 'read' || !instancia) return;
        // Terminó el gesto o la animación: el libro es la verdad. Si la
        // hoja se soltó a medias y volvió, que el visor refleje dónde
        // quedó de verdad (y no al revés).
        const actual = instancia.getCurrentPageIndex();
        if (actual !== pageIdxRef.current && actual + 1 !== pageIdxRef.current) {
          notificadoRef.current = actual;
          onPageIdx(actual);
        }
      });
      flipRef.current = instancia;
      // Volver a donde estaba (remonte por resize) o al deep-link inicial.
      const inicio = pageIdxRef.current;
      if (inicio > 0) instancia.turnToPage(inicio);
      setListo(true);
    })();
    return () => {
      vivo = false;
      setListo(false);
      flipRef.current = null;
      // Un reintento pendiente de un montaje viejo pediría una imagen que ya
      // nadie va a ver.
      for (const h of hojasRef.current) {
        if (h.temporizador != null) window.clearTimeout(h.temporizador);
      }
      hojasRef.current = [];
      try {
        instancia?.destroy();
      } catch {
        /* StPageFlip destroy con el nodo ya desmontado: sin drama */
      }
      // Las hojas las creamos nosotros a mano: React no las conoce y no
      // las va a limpiar en el remonte.
      if (librePorRef.current) librePorRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, ratio, medidas.ancho, medidas.alto, reducido]);

  // ── El visor manda (chips de sección, deep-links) — sin pisar el gesto ──
  // EL BUG DEL ESTRENO VIVÍA AQUÍ (2026-09-30): al soltar una hoja,
  // `on('flip')` avisa la página nueva ANTES de que la animación termine;
  // este efecto veía `getCurrentPageIndex()` todavía en la vieja y
  // «corregía» con flip() en pleno vuelo — la hoja se cortaba a la mitad o
  // se devolvía. Regla: un pageIdx que nos contó el propio libro jamás
  // vuelve como orden, y con una hoja en vuelo no se toca el libro (al
  // llegar a 'read' él mismo realinea al visor).
  useEffect(() => {
    const flip = flipRef.current;
    if (!flip || !listo) return;
    if (pageIdx === notificadoRef.current) return; // eco del propio libro
    if (estadoLibroRef.current !== 'read') return; // hoja en vuelo
    const actual = flip.getCurrentPageIndex();
    // En doble página el índice del libro es el IZQUIERDO del pliego:
    // pageIdx puede ser la hoja derecha y ya estar a la vista.
    if (actual === pageIdx || actual + 1 === pageIdx) return;
    if (Math.abs(actual - pageIdx) <= 2) flip.flip(pageIdx);
    else flip.turnToPage(pageIdx); // salto largo: directo, sin hojear todo
  }, [pageIdx, listo]);

  // ── Pedir las imágenes: primero lo que se ve, luego las vecinas ──
  //
  // La página que el cliente mira va SOLA y con prioridad alta. Las vecinas
  // (lo que asoma al pasar hoja) se piden cuando las visibles terminan, con
  // prioridad baja. Antes arrancaban siete a la vez y en una conexión móvil
  // la que se veía tardaba lo que tardaban las siete.
  const cargarHoja = useCallback(
    (h: Hoja, prioridad: 'high' | 'low'): Promise<void> => {
      if (h.estado === 'lista') return Promise.resolve();
      if (h.estado === 'cargando' && h.promesa) {
        // Una vecina que pasa a verse sube de prioridad (si el navegador
        // todavía no la empezó a bajar, le sirve).
        if (prioridad === 'high') h.img.fetchPriority = 'high';
        return h.promesa;
      }
      if (h.temporizador != null) {
        window.clearTimeout(h.temporizador);
        h.temporizador = null;
      }
      h.estado = 'cargando';
      h.promesa = new Promise<void>((resolver) => {
        const img = h.img;
        img.onload = () => {
          h.estado = 'lista';
          h.marcador.remove();
          h.aviso.style.display = 'none';
          resolver();
        };
        img.onerror = () => {
          h.estado = 'error';
          h.intentos += 1;
          // El marcador deja de latir: ya no está «cargando», está esperando.
          h.marcador.classList.remove('animate-pulse');
          h.aviso.style.display = '';
          const espera = REINTENTOS_DE_HOJA[h.intentos - 1];
          if (espera != null) {
            h.temporizador = window.setTimeout(() => {
              h.temporizador = null;
              if (h.estado === 'error') void cargarHoja(h, 'high');
            }, espera);
          }
          // Se resuelve igual: una hoja rota no puede dejar a las vecinas
          // esperando para siempre.
          resolver();
        };
        img.fetchPriority = prioridad;
        img.loading = 'eager';
        if (h.intentos > 0) {
          // Reintento: quitar el `src` antes de ponerlo otra vez para que el
          // navegador vuelva a la red y no se quede con el fallo anterior.
          img.removeAttribute('src');
          h.marcador.classList.add('animate-pulse');
        }
        img.src = h.url;
      });
      return h.promesa;
    },
    [],
  );

  useEffect(() => {
    if (!listo) return;
    const hojas = hojasRef.current;
    if (!hojas.length) return;
    const turno = ++turnoRef.current;
    const doble = dobleRef.current;
    const visibles = hojasVisibles(pageIdx, hojas.length, doble);
    // Volver a una página que falló cuenta como «reintentar ya».
    for (const i of visibles) {
      const h = hojas[i];
      if (h.estado === 'error') h.estado = 'vacia';
    }
    Promise.all(visibles.map((i) => cargarHoja(hojas[i], 'high'))).then(() => {
      setPrimeraLista(true);
      if (turno !== turnoRef.current || hojas !== hojasRef.current) return;
      for (const i of hojasVecinas(pageIdx, hojas.length, doble)) {
        if (hojas[i].estado === 'vacia') void cargarHoja(hojas[i], 'low');
      }
    });
  }, [pageIdx, listo, cargarHoja]);

  // Con la red de vuelta, las hojas que se quedaron en error lo intentan otra
  // vez sin esperar a que el cliente pase de página.
  useEffect(() => {
    const alVolver = () => {
      for (const h of hojasRef.current) {
        if (h.estado === 'error') void cargarHoja(h, 'high');
      }
    };
    window.addEventListener('online', alVolver);
    return () => window.removeEventListener('online', alVolver);
  }, [cargarHoja]);

  const pasaHoja = useCallback((delta: 1 | -1) => {
    if (delta > 0) flipRef.current?.flipNext();
    else flipRef.current?.flipPrev();
  }, []);
  useEffect(() => {
    registrarPaso?.(pasaHoja);
  }, [registrarPaso, pasaHoja]);

  // ── El aviso de las páginas visibles (los taps son de la librería) ──
  const popupVisible = useMemo(() => {
    const candidatas = [pages[pageIdx], pages[pageIdx + 1]];
    for (const p of candidatas) if (p?.popup) return p.popup;
    return null;
  }, [pages, pageIdx]);

  // ── Miniaturas ──────────────────────────────────────────────────
  const tiraRef = useRef<HTMLDivElement>(null);
  const tiraIdxRef = useRef(-1);
  useEffect(() => {
    const tira = tiraRef.current;
    const actual = tira?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!tira || !actual) return;
    const rt = tira.getBoundingClientRect();
    const rm = actual.getBoundingClientRect();
    const izquierda = tira.scrollLeft + (rm.left - rt.left) - (rt.width - rm.width) / 2;
    // `scrollTo` de la tira y no `scrollIntoView`: este último mueve también
    // a los ancestros. Y un salto largo, instantáneo: animado pasaría por
    // todas las miniaturas de en medio y cada una pediría su imagen.
    const desde = tiraIdxRef.current < 0 ? pageIdx : tiraIdxRef.current;
    tira.scrollTo({
      left: Math.max(0, izquierda),
      behavior: desplazamientoDeLaTira(desde, pageIdx) as ScrollBehavior,
    });
    tiraIdxRef.current = pageIdx;
  }, [pageIdx]);

  // Qué miniaturas ya pueden pedir su imagen: las que están (o estuvieron)
  // dentro de la tira más un margen. El observador usa la TIRA como raíz: la
  // carga perezosa del navegador mide contra la ventana con un margen de
  // miles de píxeles, y en la tira horizontal se las bajaba todas (105 de
  // 105 en la carta de De Godoy, 72 de ellas fuera de la vista).
  const [cercanas, setCercanas] = useState<ReadonlySet<number>>(() => new Set());
  useEffect(() => {
    const tira = tiraRef.current;
    if (!tira || typeof IntersectionObserver === 'undefined') {
      // Sin observador (navegador muy viejo): todas, como antes.
      setCercanas(new Set(pages.map((_, i) => i)));
      return;
    }
    const io = new IntersectionObserver(
      (entradas) => {
        const nuevas: number[] = [];
        for (const e of entradas) {
          if (!e.isIntersecting) continue;
          const i = Number((e.target as HTMLElement).dataset.indice);
          if (Number.isFinite(i)) nuevas.push(i);
          // Una vez pedida no se suelta: dejar de observarla ahorra trabajo.
          io.unobserve(e.target);
        }
        if (nuevas.length) {
          setCercanas((prev) => {
            const s = new Set(prev);
            for (const i of nuevas) s.add(i);
            return s;
          });
        }
      },
      { root: tira, rootMargin: `0px ${MARGEN_DE_LA_TIRA}px` },
    );
    tira.querySelectorAll('[data-indice]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages]);

  // El ancho de la miniatura se fija desde la proporción para que la tira no
  // salte cuando llegan las imágenes (y el observador mida bien antes).
  const anchoMiniatura = Math.round(ALTO_MINIATURA / (ratio || 4 / 3));

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col">
      <div
        ref={marcoRef}
        className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden"
      >
        {!listo && (
          <div
            className="absolute rounded-lg bg-bg2 animate-pulse shadow-sm"
            style={{ width: 'min(60vw, 340px)', aspectRatio: ratio ? `1 / ${ratio}` : '3 / 4' }}
          />
        )}
        <div ref={librePorRef} />

        {/* El aviso de la página, sin pelear con el gesto de pasar hoja. */}
        {listo && popupVisible && (
          <button
            onClick={() => onAbrirPopup(popupVisible)}
            className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-pill bg-white/95 backdrop-blur-sm border border-line shadow-sm px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-white"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-brand" />
            Ver aviso
          </button>
        )}

        {/* La lupa: la página actual en alta, nítida al ampliar. */}
        {listo && (
          <button
            onClick={() => setLupa(true)}
            aria-label="Ampliar la página"
            className="absolute bottom-2 right-2 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/95 backdrop-blur-sm border border-line shadow-sm text-ink hover:bg-white"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.8-3.8M11 8v6M8 11h6" />
            </svg>
          </button>
        )}
      </div>

      {/* Miniaturas + progreso — discretos, el menú es el protagonista. */}
      {pages.length > 2 && (
        <div className="flex-none px-3 pb-1">
          <div className="h-[3px] rounded-pill bg-line2 overflow-hidden mx-8 mb-1.5">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${(pageIdx / Math.max(1, pages.length - 1)) * 100}%` }}
            />
          </div>
          <div
            ref={tiraRef}
            data-tira-miniaturas=""
            className="flex gap-1.5 overflow-x-auto no-scrollbar justify-start sm:justify-center py-0.5"
          >
            {pages.map((p, i) => (
              <button
                key={p.id}
                data-indice={i}
                aria-current={i === pageIdx}
                aria-label={`Ir a la página ${i + 1}`}
                onClick={() => onPageIdx(i)}
                className={`flex-none rounded-md overflow-hidden border-2 transition bg-bg2 ${
                  i === pageIdx ? 'border-brand' : 'border-transparent opacity-70 hover:opacity-100'
                }`}
              >
                {/* Sin `src` hasta que la tira la acerca: ni el navegador ni
                    la carga perezosa del navegador la piden antes. A 128 px (3 KB) y no
                    a 640 (60 KB): ver `urlDeMiniatura`. */}
                <img
                  src={primeraLista && cercanas.has(i) ? urlDeMiniatura(p.imageUrl) : undefined}
                  alt=""
                  decoding="async"
                  className="block object-cover"
                  style={{ height: ALTO_MINIATURA, width: anchoMiniatura }}
                  draggable={false}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {lupa && (
        <Lupa
          imageUrl={pages[Math.min(pageIdx, pages.length - 1)]?.imageUrl}
          onCerrar={() => setLupa(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// La lupa: pan con un dedo, pellizco con dos, rueda, doble toque.
// Mientras está abierta no hay libro que pasar: el overlay lo cubre todo.
// ─────────────────────────────────────────────────────────────────────
function Lupa({
  imageUrl,
  onCerrar,
}: {
  imageUrl?: string;
  onCerrar: () => void;
}) {
  const zonaRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const estadoRef = useRef({ escala: 1, base: 1, x: 0, y: 0 });
  const dedosRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef({ d0: 0, escala0: 1 });
  const toqueRef = useRef(0);
  const [pct, setPct] = useState(100);

  const pinta = useCallback(() => {
    const z = estadoRef.current;
    z.escala = Math.max(z.base * 0.6, Math.min(z.base * 6, z.escala));
    if (imgRef.current) {
      imgRef.current.style.transform = `translate(calc(-50% + ${z.x}px), calc(-50% + ${z.y}px)) scale(${z.escala})`;
    }
    setPct(Math.round((z.escala / z.base) * 100));
  }, []);

  const encaja = useCallback(() => {
    const img = imgRef.current;
    const zona = zonaRef.current;
    if (!img || !zona || !img.naturalWidth) return;
    const z = estadoRef.current;
    z.base = Math.min(
      zona.clientWidth / img.naturalWidth,
      zona.clientHeight / img.naturalHeight,
    ) * 0.98;
    z.escala = z.base;
    z.x = 0;
    z.y = 0;
    pinta();
  }, [pinta]);

  useEffect(() => {
    const alTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    addEventListener('keydown', alTecla);
    return () => removeEventListener('keydown', alTecla);
  }, [onCerrar]);

  if (!imageUrl) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95" role="dialog" aria-modal="true" aria-label="Página ampliada">
      <div
        ref={zonaRef}
        className="flex-1 min-h-0 relative overflow-hidden touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          dedosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          if (dedosRef.current.size === 2) {
            const [a, b] = [...dedosRef.current.values()];
            pinchRef.current = {
              d0: Math.hypot(a.x - b.x, a.y - b.y),
              escala0: estadoRef.current.escala,
            };
          } else {
            const ahora = Date.now();
            if (ahora - toqueRef.current < 300) {
              const z = estadoRef.current;
              z.escala = z.escala > z.base * 1.4 ? z.base : z.base * 2.4;
              if (z.escala === z.base) {
                z.x = 0;
                z.y = 0;
              }
              pinta();
            }
            toqueRef.current = ahora;
          }
        }}
        onPointerMove={(e) => {
          const previo = dedosRef.current.get(e.pointerId);
          if (!previo) return;
          dedosRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (dedosRef.current.size === 2) {
            const [a, b] = [...dedosRef.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchRef.current.d0 > 0) {
              estadoRef.current.escala =
                pinchRef.current.escala0 * (d / pinchRef.current.d0);
              pinta();
            }
          } else {
            estadoRef.current.x += e.clientX - previo.x;
            estadoRef.current.y += e.clientY - previo.y;
            pinta();
          }
        }}
        onPointerUp={(e) => dedosRef.current.delete(e.pointerId)}
        onPointerCancel={(e) => dedosRef.current.delete(e.pointerId)}
        onWheel={(e) => {
          estadoRef.current.escala *= e.deltaY < 0 ? 1.12 : 0.9;
          pinta();
        }}
      >
        {/* Alta resolución a propósito: el zoom no se pixela. */}
        <img
          ref={imgRef}
          src={urlOptimizada(imageUrl, ANCHO_LUPA)}
          {...(srcSetDelLibro(imageUrl)
            ? { srcSet: srcSetDelLibro(imageUrl)!, sizes: '200vw' }
            : {})}
          alt=""
          draggable={false}
          onLoad={encaja}
          className="absolute left-1/2 top-1/2 max-w-none select-none"
        />
      </div>
      <div className="flex-none flex items-center justify-center gap-2 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5">
        <button
          onClick={() => {
            estadoRef.current.escala /= 1.3;
            pinta();
          }}
          aria-label="Alejar"
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white text-lg"
        >
          −
        </button>
        <span className="text-white/80 text-[13px] min-w-[56px] text-center tabular-nums">
          {pct}%
        </span>
        <button
          onClick={() => {
            estadoRef.current.escala *= 1.3;
            pinta();
          }}
          aria-label="Acercar"
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white text-lg"
        >
          +
        </button>
        <button
          onClick={encaja}
          aria-label="Tamaño original"
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white text-base"
        >
          ⟳
        </button>
        <button
          onClick={onCerrar}
          aria-label="Cerrar"
          className="w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white text-base"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
