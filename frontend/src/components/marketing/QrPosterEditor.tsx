'use client';
/**
 * Editor visual de carteles QR — Konva-based, solo client.
 *
 * Features (Phase 1):
 * - Drag&drop universal con smart guides + snapping (centro, bordes,
 *   alineación entre layers)
 * - Fondos: sólido / gradiente / imagen (con zoom, posición, blur,
 *   overlay color + opacidad)
 * - Generador de patrones con emojis (tamaño, gap, opacidad, rotación,
 *   densidad)
 * - Biblioteca de emojis tipo WhatsApp con buscador ES/EN
 * - Upload libre de imágenes (PNG/SVG/JPG/WebP) — reemplaza la sección
 *   "Forma" anterior (los shapes viejos siguen renderizando para
 *   backward-compat con configs en DB)
 * - Tamaño de lienzo custom + DPI configurable (150/300/450/600)
 * - Biblioteca de tipografías expandida con categorías
 * - Undo/redo con history (cap 50) + ⌘Z / ⌘⇧Z
 * - Export PNG/JPG/PDF al DPI configurado
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import {
  Stage,
  Layer,
  Rect,
  Circle,
  Group,
  Text,
  Image as KonvaImage,
  Line,
  Star,
  Path,
} from 'react-konva';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { api } from '@/lib/api';
import {
  type QrPosterConfig,
  type QrPosterType,
  type TextLayer,
  type CustomTextLayer,
  type BgConfig,
  type ShapeLayer,
  type ShapeType,
  type IconLayer,
  type ImageLayer,
  type PatternLayer,
  type LayerId,
  type FontOption,
  FONT_OPTIONS,
  FONT_CATEGORY_LABELS,
  googleFontsUrl,
  CANVAS_PRESETS,
  defaultConfig,
  normalizeConfig,
  effectiveLayerOrder,
  rescaleForCanvas,
  pixelRatioForDpi,
  estimateTextBox,
} from '@/lib/marketing/qr-poster-config';
import { QR_TEMPLATES, applyTemplate } from '@/lib/marketing/qr-templates';
import {
  EMOJI_DATA,
  CATEGORY_LABELS as EMOJI_CATEGORY_LABELS,
  CATEGORY_ICONS as EMOJI_CATEGORY_ICONS,
  searchEmojis,
  type EmojiCategory,
  type EmojiEntry,
} from '@/lib/marketing/emoji-library';
import {
  WALLET_BADGES,
  loadBadgeAsDataUrl,
  type WalletBadge,
} from '@/lib/marketing/wallet-badges';

type Props = {
  type: QrPosterType;
  /** Si está presente, el editor opera en modo "id" — carga/guarda
   *  contra `/qr-posters/:id` en lugar de `/qr-posters/by-type/:type`.
   *  Permite tener múltiples carteles del mismo tipo (cada uno con su
   *  propio diseño). El modo legacy "by-type" sigue existiendo para
   *  los flows /app/marketing/qr-* y para compat hacia atrás. */
  posterId?: string;
  /** URL destino del QR. String fijo o función que recibe el `meta`
   *  type-specific (cardId, promoCode, etc) y construye la URL. */
  qrUrl: string | ((meta: Record<string, any>) => string);
  /** Nombre del negocio — se usa como default del layer "brand". */
  brandName: string;
  /** URL del logo del tenant (logoUrl o walletLogoUrl). Si presente,
   *  permite activar la capa "Logo" en el editor. */
  logoUrl?: string | null;
  /** Slot para UI type-specific en el sidebar (selector de card para
   *  QR Mostrador, input de código para QR Descuento, etc). */
  metaSlot?: (
    meta: Record<string, any>,
    setMeta: (m: Record<string, any>) => void,
  ) => React.ReactNode;
};

const STAGE_MAX_DISPLAY_W = 540; // px en pantalla; el canvas interno es 1080+
const SNAP_THRESHOLD = 8; // px en coords de canvas — distancia para snapear
const HISTORY_MAX = 50;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

// Las fuentes ahora vienen cargadas globalmente desde el root layout
// (frontend/src/app/layout.tsx) — esta función queda como no-op de
// retrocompatibilidad. Se puede eliminar cuando todos los callers se
// actualicen.
function ensureFontsLoaded() {}

function useImageFromDataUrl(dataUrl: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!dataUrl) {
      setImg(null);
      return;
    }
    const i = new window.Image();
    i.onload = () => setImg(i);
    i.src = dataUrl;
  }, [dataUrl]);
  return img;
}

/** Carga una imagen HTTP/HTTPS o data URL. crossOrigin=anonymous para
 *  que Konva pueda exportarla sin tainting el canvas. Las data URLs
 *  ignoran crossOrigin pero setearlo no rompe nada. */
function useImageFromUrl(url: string | null | undefined) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) {
      setImg(null);
      return;
    }
    const i = new window.Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => setImg(i);
    i.onerror = () => setImg(null);
    i.src = url;
  }, [url]);
  return img;
}

function newId() {
  return Math.random().toString(36).slice(2, 9);
}

/** PRNG determinístico (mulberry32) — para que el density del pattern
 *  produzca el mismo layout entre renders. Sin esto, cada drag del
 *  Stage re-randomizaría qué celdas se pintan. */
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decide si un backup de localStorage parece corrupto comparándolo
 * contra el cfg que llegó del server. Devuelve string con la razón si
 * descartamos, null si parece OK para ofrecer restaurar.
 *
 * Heurística defensiva pensada para frenar el bug histórico donde el
 * cliente aceptaba "¿Restaurar cambios sin guardar?" sin pensar, el
 * cfg local tenía elementos en (0,0) por sesión rota anterior, y el
 * autosave persistía esa basura al server pisando el cfg bueno.
 *
 * Reglas:
 * - Si el local tiene MENOS elementos totales que el server → sospechoso
 *   (restaurar un backup nunca pierde contenido, lo agrega).
 * - Si los textos title/subtitle/cta/brand en local están todos en x=0/y=0
 *   pero en server NO → sospechoso (el render por defecto los pone bien).
 * - Si los shapes/icons/images/customTexts del local tienen TODOS x=0,y=0
 *   y el server no → sospechoso (raro que el usuario apile todo en
 *   esquina).
 */
function backupLooksCorrupt(local: any, server: any): string | null {
  if (!local || !server) return null;
  const countLayers = (c: any) =>
    (c?.shapes?.length ?? 0) +
    (c?.icons?.length ?? 0) +
    (c?.images?.length ?? 0) +
    (c?.customTexts?.length ?? 0) +
    (c?.logo ? 1 : 0);
  const localCount = countLayers(local);
  const serverCount = countLayers(server);
  if (serverCount > 0 && localCount < serverCount) {
    return `local tiene ${localCount} capas vs server ${serverCount} — restaurar perdería contenido`;
  }
  // ¿Todos los textos fijos del local en (0,0)? Sospechoso si server no
  const textKeys = ['title', 'subtitle', 'cta', 'brand'] as const;
  const localTextsAt00 = textKeys.every(
    (k) => local?.texts?.[k]?.x === 0 && local?.texts?.[k]?.y === 0,
  );
  const serverTextsAt00 = textKeys.every(
    (k) => server?.texts?.[k]?.x === 0 && server?.texts?.[k]?.y === 0,
  );
  if (localTextsAt00 && !serverTextsAt00) {
    return 'todos los textos del local en (0,0) pero el server tiene posiciones reales';
  }
  // ¿Todas las capas extra del local en (0,0)? Sospechoso si server no
  const allLayersAt00 = (c: any) => {
    const arr = [
      ...(c?.shapes ?? []),
      ...(c?.icons ?? []),
      ...(c?.images ?? []),
      ...(c?.customTexts ?? []),
    ];
    if (arr.length === 0) return false;
    return arr.every((l: any) => l?.x === 0 && l?.y === 0);
  };
  if (allLayersAt00(local) && !allLayersAt00(server) && serverCount > 0) {
    return 'todas las capas del local en (0,0) — corrupción típica';
  }
  return null;
}

/** Convierte el BgConfig sólido o gradient a props de fill para el Rect
 *  base. Para imagen, el Rect base queda con un color neutro y la
 *  imagen se pinta como KonvaImage separada arriba. */
function rectFillProps(bg: BgConfig, w: number, h: number) {
  if (bg.type === 'solid') {
    return { fill: bg.color1, opacity: bg.opacity ?? 1 };
  }
  if (bg.type === 'gradient') {
    const subtype = bg.subtype ?? 'linear';
    if (subtype === 'radial') {
      // Radial gradient: center → outer. Konva acepta
      // fillRadialGradientStartPoint/EndPoint con radius.
      // Radio = diagonal/2 para garantizar que el gradiente cubre HASTA
      // las esquinas del rect. Si usamos max(w,h)/2 (radio del lado
      // mayor), en canvas no cuadrados quedan esquinas del color2
      // visibles porque el gradiente no llega a la diagonal.
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.sqrt(w * w + h * h) / 2;
      return {
        fillRadialGradientStartPoint: { x: cx, y: cy },
        fillRadialGradientStartRadius: 0,
        fillRadialGradientEndPoint: { x: cx, y: cy },
        fillRadialGradientEndRadius: r,
        fillRadialGradientColorStops: [0, bg.color1, 1, bg.color2],
        opacity: bg.opacity ?? 1,
      };
    }
    // Linear o diagonal (diagonal = linear con ángulo preset)
    const angle = subtype === 'diagonal' ? 135 : bg.angle ?? 135;
    const rad = (angle * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const len = Math.max(w, h);
    const dx = (Math.cos(rad) * len) / 2;
    const dy = (Math.sin(rad) * len) / 2;
    return {
      fillLinearGradientStartPoint: { x: cx - dx, y: cy - dy },
      fillLinearGradientEndPoint: { x: cx + dx, y: cy + dy },
      fillLinearGradientColorStops: [0, bg.color1, 1, bg.color2],
      opacity: bg.opacity ?? 1,
    };
  }
  // Image: el Rect base queda neutro (blanco), la imagen va arriba como
  // capa separada para soportar blur via filter.
  return { fill: '#FFFFFF' };
}

/** Calcula el rect de dibujo "cover" para una imagen de fondo, dado
 *  zoom + offsets. Mantiene el aspecto de la imagen original. */
function bgImageRect(
  imgW: number,
  imgH: number,
  canvasW: number,
  canvasH: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
) {
  // Cover: la imagen llena el canvas (al menos un lado).
  const baseScale = Math.max(canvasW / imgW, canvasH / imgH);
  const scale = baseScale * Math.max(0.5, zoom);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  // Centrado + offset del usuario
  const x = (canvasW - drawW) / 2 + offsetX;
  const y = (canvasH - drawH) / 2 + offsetY;
  return { x, y, w: drawW, h: drawH };
}

// ─────────────────────────── Smart guides ─────────────────────────── //

type Guide = {
  type: 'v' | 'h';
  value: number;
  /** Tipo de match para diferenciar visualmente: center del canvas,
   *  alineación con otro elemento, o equidistancia. */
  kind?: 'canvasCenter' | 'canvasEdge' | 'elementAlign' | 'spacing';
  /** Label opcional (ej "120 px" para guides de spacing). */
  label?: string;
};

/** Calcula líneas guía visibles + valor de snap para una posición dada.
 *  Compara contra:
 *  - centros y bordes del canvas
 *  - centros y bordes de los demás layers
 *  El elemento bajo drag se identifica por su id (skipId) para no
 *  snapear contra sí mismo. */
function computeSnap(
  draggedBox: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number; id: string }[],
  canvasW: number,
  canvasH: number,
  skipId: string,
): { x: number; y: number; guides: Guide[] } {
  const guides: Guide[] = [];
  let newX = draggedBox.x;
  let newY = draggedBox.y;

  const draggedCx = draggedBox.x + draggedBox.w / 2;
  const draggedCy = draggedBox.y + draggedBox.h / 2;
  const draggedRight = draggedBox.x + draggedBox.w;
  const draggedBottom = draggedBox.y + draggedBox.h;

  // Targets verticales (líneas | a snapear en X) con metadata kind
  type VTarget = { value: number; kind: Guide['kind'] };
  type HTarget = { value: number; kind: Guide['kind'] };
  const vTargets: VTarget[] = [
    { value: 0, kind: 'canvasEdge' },
    { value: canvasW / 2, kind: 'canvasCenter' },
    { value: canvasW, kind: 'canvasEdge' },
  ];
  const hTargets: HTarget[] = [
    { value: 0, kind: 'canvasEdge' },
    { value: canvasH / 2, kind: 'canvasCenter' },
    { value: canvasH, kind: 'canvasEdge' },
  ];

  for (const o of others) {
    if (o.id === skipId) continue;
    vTargets.push({ value: o.x, kind: 'elementAlign' });
    vTargets.push({ value: o.x + o.w / 2, kind: 'elementAlign' });
    vTargets.push({ value: o.x + o.w, kind: 'elementAlign' });
    hTargets.push({ value: o.y, kind: 'elementAlign' });
    hTargets.push({ value: o.y + o.h / 2, kind: 'elementAlign' });
    hTargets.push({ value: o.y + o.h, kind: 'elementAlign' });
  }

  // Snap X — probar alinear left/center/right del dragged contra cada target
  let bestVDelta = Infinity;
  let bestV: { newX: number; lineValue: number; kind: Guide['kind'] } | null = null;
  for (const t of vTargets) {
    for (const align of [
      { ref: draggedBox.x, delta: t.value - draggedBox.x },
      { ref: draggedCx, delta: t.value - draggedCx },
      { ref: draggedRight, delta: t.value - draggedRight },
    ]) {
      if (Math.abs(align.delta) < SNAP_THRESHOLD && Math.abs(align.delta) < bestVDelta) {
        bestVDelta = Math.abs(align.delta);
        bestV = {
          newX: draggedBox.x + align.delta,
          lineValue: t.value,
          kind: t.kind,
        };
      }
    }
  }
  if (bestV) {
    newX = bestV.newX;
    guides.push({ type: 'v', value: bestV.lineValue, kind: bestV.kind });
  }

  // Snap Y
  let bestHDelta = Infinity;
  let bestH: { newY: number; lineValue: number; kind: Guide['kind'] } | null = null;
  for (const t of hTargets) {
    for (const align of [
      { ref: draggedBox.y, delta: t.value - draggedBox.y },
      { ref: draggedCy, delta: t.value - draggedCy },
      { ref: draggedBottom, delta: t.value - draggedBottom },
    ]) {
      if (Math.abs(align.delta) < SNAP_THRESHOLD && Math.abs(align.delta) < bestHDelta) {
        bestHDelta = Math.abs(align.delta);
        bestH = {
          newY: draggedBox.y + align.delta,
          lineValue: t.value,
          kind: t.kind,
        };
      }
    }
  }
  if (bestH) {
    newY = bestH.newY;
    guides.push({ type: 'h', value: bestH.lineValue, kind: bestH.kind });
  }

  // Detección de spacing uniforme. La heurística busca pares de
  // elementos en la misma fila (horizontalmente alineados → snap de
  // espaciado horizontal) o en la misma columna (verticalmente
  // alineados → snap de espaciado vertical). Cuando el dragged está
  // cerca del punto equidistante entre 2 peers, mueve newX/newY al
  // punto exacto Y muestra una guía visual.
  const draggedFinalCx = newX + draggedBox.w / 2;
  const draggedFinalCy = newY + draggedBox.h / 2;

  // Horizontal spacing: elementos en la misma fila (Y similar)
  const peersInRow = others.filter(
    (o) =>
      o.id !== skipId &&
      Math.abs(o.y + o.h / 2 - draggedFinalCy) < SNAP_THRESHOLD * 4,
  );
  for (let i = 0; i < peersInRow.length; i++) {
    for (let j = i + 1; j < peersInRow.length; j++) {
      const a = peersInRow[i];
      const b = peersInRow[j];
      const aCx = a.x + a.w / 2;
      const bCx = b.x + b.w / 2;
      const midX = (aCx + bCx) / 2;
      // Si dragged está cerca del punto medio (centro equidistante)
      if (
        Math.abs(draggedFinalCx - midX) < SNAP_THRESHOLD * 2 &&
        Math.abs(aCx - bCx) > 60
      ) {
        // SNAP — mueve el elemento al centro equidistante
        newX = midX - draggedBox.w / 2;
        const dist = Math.abs(midX - aCx);
        // Guía VERTICAL (línea | que cruza por draggedFinalCx) para
        // indicar "alineado al centro entre A y B"
        guides.push({
          type: 'v',
          value: midX,
          kind: 'spacing',
          label: `${Math.round(dist)} px`,
        });
        i = peersInRow.length;
        break;
      }
    }
  }

  // Vertical spacing: elementos en la misma columna (X similar)
  const peersInCol = others.filter(
    (o) =>
      o.id !== skipId &&
      Math.abs(o.x + o.w / 2 - draggedFinalCx) < SNAP_THRESHOLD * 4,
  );
  for (let i = 0; i < peersInCol.length; i++) {
    for (let j = i + 1; j < peersInCol.length; j++) {
      const a = peersInCol[i];
      const b = peersInCol[j];
      const aCy = a.y + a.h / 2;
      const bCy = b.y + b.h / 2;
      const midY = (aCy + bCy) / 2;
      if (
        Math.abs(draggedFinalCy - midY) < SNAP_THRESHOLD * 2 &&
        Math.abs(aCy - bCy) > 60
      ) {
        newY = midY - draggedBox.h / 2;
        const dist = Math.abs(midY - aCy);
        guides.push({
          type: 'h',
          value: midY,
          kind: 'spacing',
          label: `${Math.round(dist)} px`,
        });
        i = peersInCol.length;
        break;
      }
    }
  }

  return { x: newX, y: newY, guides };
}

/** Bounding boxes aproximados de TODOS los layers para usar como
 *  targets de snap. Usa ids prefijados que matchean los LayerId
 *  ('text.title', 'qr', 'shape.<id>', etc). */
function gatherSnapTargets(cfg: QrPosterConfig) {
  const out: { x: number; y: number; w: number; h: number; id: string }[] = [];
  // QR bbox INCLUYE el padding del marco — sino el snap del QR (que
  // usa totalW = size + 2*pad en su drag handler) queda desfasado vs
  // los smart guides de los otros elementos que apuntan al QR como
  // target.
  const qrPad = cfg.qr.padding ?? 0;
  const qrTotal = cfg.qr.size + qrPad * 2;
  out.push({
    x: cfg.qr.x,
    y: cfg.qr.y,
    w: qrTotal,
    h: qrTotal,
    id: 'qr',
  });
  if (cfg.logo) {
    out.push({
      x: cfg.logo.x,
      y: cfg.logo.y,
      w: cfg.logo.size,
      h: cfg.logo.size,
      id: 'logo',
    });
  }
  for (const k of ['title', 'subtitle', 'cta', 'brand'] as const) {
    const t = cfg.texts[k];
    // Usamos estimateTextBox que maneja multilínea + alineación
    // correctamente — devuelve el bbox VISUAL real del texto (no la caja
    // contenedora), para que los smart guides snapean al centro óptico.
    const box = estimateTextBox(t, cfg.canvas.w);
    out.push({ ...box, id: `text.${k}` });
  }
  for (const s of cfg.shapes ?? []) {
    // Para circle/star/burst, el bbox VISUAL real es cuadrado de
    // min(w,h) (porque outerRadius = min/2). Si el cliente cambió uno
    // solo de los lados, el snap apuntaría al rect lógico (s.w × s.h)
    // pero la forma dibujada es más chica → guides desfasadas.
    if (s.type === 'circle' || s.type === 'star' || s.type === 'burst') {
      const d = Math.min(s.w, s.h);
      out.push({
        x: s.x + (s.w - d) / 2,
        y: s.y + (s.h - d) / 2,
        w: d,
        h: d,
        id: `shape.${s.id}`,
      });
    } else {
      out.push({ x: s.x, y: s.y, w: s.w, h: s.h, id: `shape.${s.id}` });
    }
  }
  for (const i of cfg.icons ?? []) {
    out.push({ x: i.x, y: i.y, w: i.size, h: i.size, id: `icon.${i.id}` });
  }
  for (const im of cfg.images ?? []) {
    out.push({ x: im.x, y: im.y, w: im.w, h: im.h, id: `image.${im.id}` });
  }
  for (const t of cfg.customTexts ?? []) {
    if (t.hidden) continue;
    const box = estimateTextBox(t, cfg.canvas.w);
    out.push({ ...box, id: `customText.${t.id}` });
  }
  return out;
}

// ─────────────────────────── Componente ─────────────────────────── //

type HistoryState = { history: QrPosterConfig[]; idx: number };

export default function QrPosterEditor({
  type,
  posterId: posterIdProp,
  qrUrl,
  brandName,
  logoUrl,
  metaSlot,
}: Props) {
  // Si hay posterIdProp, el editor opera contra /qr-posters/:id (modo
  // multi-QR). Sino, contra /qr-posters/by-type/:type (modo legacy).
  const idMode = !!posterIdProp;
  const [{ history, idx }, setHist] = useState<HistoryState>(() => ({
    history: [defaultConfig(brandName)],
    idx: 0,
  }));
  const cfg = history[idx];

  function setCfg(
    updater: ((c: QrPosterConfig) => QrPosterConfig) | QrPosterConfig,
  ) {
    setHist((s) => {
      const current = s.history[s.idx];
      const next =
        typeof updater === 'function'
          ? (updater as (c: QrPosterConfig) => QrPosterConfig)(current)
          : updater;
      if (next === current) return s;
      const truncated = s.history.slice(0, s.idx + 1);
      const appended = [...truncated, next];
      const trimmed =
        appended.length > HISTORY_MAX
          ? appended.slice(appended.length - HISTORY_MAX)
          : appended;
      return { history: trimmed, idx: trimmed.length - 1 };
    });
  }

  function replaceHistory(newCfg: QrPosterConfig) {
    setHist({ history: [newCfg], idx: 0 });
  }

  function undo() {
    setHist((s) => (s.idx > 0 ? { ...s, idx: s.idx - 1 } : s));
  }
  function redo() {
    setHist((s) =>
      s.idx < s.history.length - 1 ? { ...s, idx: s.idx + 1 } : s,
    );
  }
  const canUndo = idx > 0;
  const canRedo = idx < history.length - 1;

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [posterId, setPosterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editorLoadError, setEditorLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | 'png' | 'jpg' | 'pdf'>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [stageWidth, setStageWidth] = useState(STAGE_MAX_DISPLAY_W);

  useEffect(() => {
    ensureFontsLoaded();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditorLoadError(null);
    // Bloquear cualquier autosave hasta que este load termine. Sin esto,
    // si el cliente cambia de variante (posterIdProp distinto) sin
    // re-montar, el cfg del cartel anterior podría persistirse contra
    // el endpoint del cartel nuevo durante la ventana entre el cambio
    // de dep y el .then() del fetch.
    hasLoadedRef.current = false;
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    // En modo id, el draft local se indexa por id (no por type) para que
    // editar dos variantes del mismo type no sobrescriba mutuamente sus
    // backups locales.
    const key = idMode
      ? `clubify:qr-poster-draft:id:${posterIdProp}`
      : `clubify:qr-poster-draft:${type}`;
    const loadUrl = idMode
      ? `/qr-posters/${posterIdProp}`
      : `/qr-posters/by-type/${type}`;
    api<any>(loadUrl)
      .then((row) => {
        if (cancelled) return;
        const serverCfg = row?.config
          ? normalizeConfig(row.config, brandName)
          : null;
        const serverJson = serverCfg ? JSON.stringify(serverCfg) : '';

        // Recuperación de backup local: si la última sesión quedó con
        // cambios sin guardar (refresh / cierre accidental), preguntamos
        // si restaurar. ANTES de ofrecer restaurar VALIDAMOS que el backup
        // local no parezca corrupto — sino el cliente acepta sin pensar y
        // el autosave persiste la basura local pisando el server bueno
        // (bug histórico: todos los elementos terminaban en 0,0 o tamaños
        // por defecto). Si el backup parece corrupto vs el server, lo
        // descartamos silencioso y usamos el server.
        let restored = false;
        try {
          const localJson = localStorage.getItem(key);
          if (localJson && localJson !== serverJson) {
            const localCfgRaw = JSON.parse(localJson);
            const looksCorrupt = backupLooksCorrupt(localCfgRaw, serverCfg);
            if (looksCorrupt) {
              // eslint-disable-next-line no-console
              console.warn(
                '[QrPosterEditor] backup localStorage descartado (parece corrupto vs server)',
                {
                  reason: looksCorrupt,
                  type,
                  posterIdProp,
                },
              );
              localStorage.removeItem(key);
            } else {
              const yes = window.confirm(
                'Tenés cambios sin guardar de la sesión anterior. ¿Restaurar ahora?\n\n(Cancelar = descartar el backup local)',
              );
              if (yes) {
                replaceHistory(normalizeConfig(localCfgRaw, brandName));
                // El backend NO tiene esta versión todavía — queda dirty,
                // el autosave se va a disparar enseguida.
                lastSavedJsonRef.current = serverJson;
                setAutosaveState('dirty');
                restored = true;
              } else {
                localStorage.removeItem(key);
              }
            }
          }
        } catch {}

        if (!restored && serverCfg) {
          replaceHistory(serverCfg);
          lastSavedJsonRef.current = serverJson;
          setAutosaveState('idle');
        }
        if (row?.id) setPosterId(row.id);
        // Habilitamos el autosave ÚNICAMENTE si el load fue exitoso.
        // En el catch lo dejamos en false para que ningún autosave ni el
        // cleanup unmount pisen el server con el defaultConfig en memoria
        // si la red falla o el JWT expiró — bug histórico que dejaba el
        // cartel guardado en (0,0) tras un error transitorio de carga.
        if (!cancelled) hasLoadedRef.current = true;
      })
      .catch((e: any) => {
        if (cancelled) return;
        setEditorLoadError(
          e?.message?.toString() ||
            'No se pudo cargar el diseño guardado. Revisá tu conexión y recargá la página.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // posterIdProp incluido para que al cambiar de variante (modo
    // multi-QR — /app/marketing/edit/[id]) sin re-montar el componente,
    // se recargue el cartel correcto. Sin esto, el editor mostraba el
    // cartel viejo + el autosave podía pisar el cartel nuevo con el cfg
    // del anterior.
  }, [type, brandName, idMode, posterIdProp]);

  const meta = cfg.meta ?? {};
  const staticUrl = typeof qrUrl === 'function' ? qrUrl(meta) : qrUrl;
  // Una vez que el poster tiene id (cargado del server o recién creado por
  // autosave), el QR codifica /q/<id> en vez de la URL directa. Esto activa
  // el redirect dinámico backend (loguea visita + permite cambiar destino
  // sin reimprimir). Si todavía no hay id (creación inicial), cae al
  // staticUrl como fallback. El usuario no necesita ver el URL en pantalla
  // — el QR igual escanea bien una vez guardado.
  const effectiveUrl =
    posterId && typeof window !== 'undefined'
      ? `${window.location.origin}/q/${posterId}`
      : staticUrl;

  useEffect(() => {
    let cancelled = false;
    if (!effectiveUrl) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(effectiveUrl, {
      width: cfg.qr.size,
      margin: 1,
      color: { dark: cfg.qr.fg, light: cfg.qr.bg },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [effectiveUrl, cfg.qr.fg, cfg.qr.bg, cfg.qr.size]);

  useEffect(() => {
    function updateSize() {
      const el = containerRef.current;
      if (!el) return;
      const w = Math.min(el.clientWidth - 32, STAGE_MAX_DISPLAY_W);
      setStageWidth(Math.max(280, w));
    }
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const scale = stageWidth / cfg.canvas.w;
  const stageHeight = cfg.canvas.h * scale;

  const qrImage = useImageFromDataUrl(qrDataUrl);
  const logoImage = useImageFromUrl(cfg.logo?.url ?? null);
  const bgImage = useImageFromUrl(cfg.bg.type === 'image' ? cfg.bg.url : null);

  // ───────── Auto-save (item 8 + 11 del spec) ───────── //
  // Indicador del estado del autosave para mostrar al cliente.
  const [autosaveState, setAutosaveState] = useState<
    'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  >('idle');
  // Banner cuando el backup local falla por quota (típico con imágenes
  // grandes en data URL). El autosave server sigue funcionando.
  const [localBackupFailed, setLocalBackupFailed] = useState(false);
  // Última cfg serializada que efectivamente se persistió en el backend.
  // Sirve para detectar dirty (cfg actual != lastSavedJson) y evitar
  // saves redundantes.
  const lastSavedJsonRef = useRef<string>('');
  const autosaveTimerRef = useRef<number | null>(null);
  // Flag para evitar que el autosave dispare ANTES de que el load
  // server-side termine — sino podría pisar el server con un cfg
  // default si la red está lenta (>2.5s al cargar). Se setea a true
  // en el finally del load effect.
  const hasLoadedRef = useRef(false);
  // Counter monotónico para offset escalonado al agregar shapes.
  // No usar shapes.length porque decrementa al borrar (shape nueva
  // colisiona con otra existente).
  const addShapeCounterRef = useRef(0);

  // Auto-clamp del padding QR si el cliente agranda el QR y deja el
  // padding actual fuera de lo que cabe en el canvas. Sin esto, el
  // slider muestra max=0 mientras value=20 sigue persistido → input
  // bloqueado y el cliente cree que "el padding está bugeado".
  useEffect(() => {
    const maxPad = Math.max(
      0,
      Math.floor((Math.min(cfg.canvas.w, cfg.canvas.h) - cfg.qr.size) / 2),
    );
    const cur = cfg.qr.padding ?? 0;
    if (cur > maxPad) {
      setCfg((c) => ({ ...c, qr: { ...c.qr, padding: maxPad } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.canvas.w, cfg.canvas.h, cfg.qr.size]);
  // Ref del último cfg para el cleanup de unmount + el save closure.
  // Sin esto, el save dentro del setTimeout captura el cfg del render
  // que lo agendó — puede estar desactualizado.
  const cfgRef = useRef(cfg);
  useEffect(() => {
    cfgRef.current = cfg;
  }, [cfg]);
  const localKey = idMode
    ? `clubify:qr-poster-draft:id:${posterIdProp}`
    : `clubify:qr-poster-draft:${type}`;

  /** Save efectivo al backend. Lee siempre el cfg ACTUAL via cfgRef
   *  (no del closure del render). Idempotente — si no hay cambios
   *  (cfg === lastSavedJson) skipea. */
  async function save({ silent = false }: { silent?: boolean } = {}) {
    // Defensa: si el load inicial todavía no terminó, NO guardamos —
    // sino podríamos pisar el server con el defaultConfig en memoria
    // antes de haber leído lo que el cliente tenía guardado. Ver el
    // comentario del cleanup unmount más abajo para el contexto del bug.
    if (!hasLoadedRef.current) {
      if (!silent) setAutosaveState('idle');
      return;
    }
    const currentCfg = cfgRef.current;
    const json = JSON.stringify(currentCfg);
    if (json === lastSavedJsonRef.current && !saveError) {
      if (!silent) setAutosaveState('saved');
      return;
    }
    if (!silent) setSaving(true);
    setSaveError(null);
    setAutosaveState('saving');
    // Log diagnóstico — útil cuando el cliente reporta "todo a 0,0":
    // miramos console y vemos qué cfg se está mandando. Si los textos o
    // capas están en (0,0) acá, sabemos que el bug está ANTES del save
    // (no en el server). Solo en dev / cuando el usuario active debug.
    if (typeof window !== 'undefined' && (window as any).__QR_DEBUG__) {
      // eslint-disable-next-line no-console
      console.log('[QrPosterEditor] save →', {
        type,
        posterIdProp,
        texts: {
          title: { x: currentCfg.texts?.title?.x, y: currentCfg.texts?.title?.y },
          subtitle: { x: currentCfg.texts?.subtitle?.x, y: currentCfg.texts?.subtitle?.y },
          cta: { x: currentCfg.texts?.cta?.x, y: currentCfg.texts?.cta?.y },
          brand: { x: currentCfg.texts?.brand?.x, y: currentCfg.texts?.brand?.y },
        },
        qr: { x: currentCfg.qr?.x, y: currentCfg.qr?.y },
        logo: currentCfg.logo ? { x: currentCfg.logo.x, y: currentCfg.logo.y } : null,
        counts: {
          shapes: currentCfg.shapes?.length ?? 0,
          icons: currentCfg.icons?.length ?? 0,
          images: currentCfg.images?.length ?? 0,
          customTexts: currentCfg.customTexts?.length ?? 0,
        },
      });
    }
    try {
      const row = idMode
        ? await api<any>(`/qr-posters/${posterIdProp}`, {
            method: 'PATCH',
            body: JSON.stringify({ config: currentCfg }),
          })
        : await api<any>(`/qr-posters/by-type/${type}`, {
            method: 'PUT',
            body: JSON.stringify({ name: '', config: currentCfg }),
          });
      setPosterId(row.id);
      lastSavedJsonRef.current = json;
      setSavedAt(Date.now());
      setAutosaveState('saved');
      if (!silent) window.setTimeout(() => setSavedAt(null), 2500);
      try {
        localStorage.removeItem(localKey);
      } catch {}
    } catch (e: any) {
      setSaveError(
        e?.message?.toString() ||
          'No se pudo guardar. Revisá tu conexión y volvé a intentar.',
      );
      setAutosaveState('error');
    } finally {
      if (!silent) setSaving(false);
    }
  }

  // Escribir copia local en cada cambio + agendar autosave debounced.
  // CRÍTICO: no hacer nada hasta que hasLoadedRef sea true. Sino el
  // primer render dispara el effect con cfg=defaultConfig y si el
  // load tarda >2.5s el autosave PISA el server con el default.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    const json = JSON.stringify(cfg);
    if (lastSavedJsonRef.current && json === lastSavedJsonRef.current) {
      return;
    }
    try {
      localStorage.setItem(localKey, json);
    } catch (e: any) {
      // QuotaExceeded — típico con varias imágenes en dataURL (~5MB
      // cap por origin). Aviso visible para que el cliente sepa que NO
      // hay backup local. El autosave al server sigue funcionando.
      if (e?.name === 'QuotaExceededError' || e?.code === 22) {
        console.warn('localStorage lleno — backup local desactivado');
        // CRÍTICO: si la escritura nueva falla por quota, el
        // localStorage QUEDA con la versión vieja del cfg. En la
        // próxima carga, el prompt "Restaurar cambios sin guardar"
        // restauraría una versión obsoleta (imágenes en posiciones
        // viejas, sin assets recientes). Eliminamos el backup local
        // para forzar que el siguiente boot use el server cfg, que
        // sí está al día via autosave.
        try {
          localStorage.removeItem(localKey);
        } catch {}
        // Marcar dirty igual para que el autosave server-side dispare,
        // y avisar via banner que no hay backup local.
        setLocalBackupFailed(true);
      }
    }
    setAutosaveState('dirty');
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      save({ silent: true }).catch(() => null);
    }, 2500);
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  // Al desmontar el editor, hacer un save final si quedó algo pending.
  // Usa cfgRef (no cfg del closure inicial) para leer el cfg ACTUAL.
  //
  // CRÍTICO: solo enviar si hasLoadedRef.current === true. Sino el unmount
  // pisaría el server con el defaultConfig inicial — bug histórico que
  // tiraba todo el diseño guardado a la esquina superior izquierda al
  // re-loguear / refrescar / navegar entre rutas. Con StrictMode en dev
  // (next.config.js reactStrictMode: true), React hace mount → unmount →
  // mount; el unmount intermedio se disparaba ANTES del load, enviaba el
  // defaultConfig al server, y el segundo mount cargaba ese default
  // sobreescrito → todos los layers en (0,0) / posiciones de fábrica.
  // En prod sin StrictMode pasaba también si el usuario cerraba la pestaña
  // o navegaba muy rápido antes del primer load.
  useEffect(() => {
    return () => {
      if (!hasLoadedRef.current) return;
      const currentCfg = cfgRef.current;
      const json = JSON.stringify(currentCfg);
      if (json !== lastSavedJsonRef.current) {
        if (idMode) {
          api(`/qr-posters/${posterIdProp}`, {
            method: 'PATCH',
            body: JSON.stringify({ config: currentCfg }),
            keepalive: true as any,
          }).catch(() => null);
        } else {
          api(`/qr-posters/by-type/${type}`, {
            method: 'PUT',
            body: JSON.stringify({ name: '', config: currentCfg }),
            keepalive: true as any,
          }).catch(() => null);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reset() {
    if (!confirm('¿Descartar cambios y volver al diseño por defecto?')) return;
    // En modo id NO borramos el cartel del backend (sería destructivo
    // sin warning explícito) — solo reseteamos el config en memoria. La
    // próxima edición vuelve a guardarlo. Para borrar realmente la
    // variante, el usuario usa el botón "Eliminar" en /app/marketing.
    if (!idMode && posterId) {
      try {
        await api(`/qr-posters/by-type/${type}`, { method: 'DELETE' });
      } catch {}
    }
    replaceHistory(defaultConfig(brandName));
    if (!idMode) setPosterId(null);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function doExport(kind: 'png' | 'jpg' | 'pdf') {
    const stage = stageRef.current;
    if (!stage) return;
    setExporting(kind);
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    // PNG → transparente: oculta el grupo "bg" durante el export para que
    // el alpha channel del PNG quede limpio (sin la hoja blanca/color/imagen
    // de fondo). El cliente lo pidió explícitamente para usarlo en flyers /
    // mockups / RRSS sin tener que recortar el fondo a mano. JPG y PDF NO
    // hacen esto — ahí sí se conserva el fondo (JPG no soporta alpha; PDF
    // típicamente se imprime, conviene fondo). Restauramos visibilidad en
    // el finally por las dudas (si algo crashea queda visible igual).
    const bgNode =
      kind === 'png' ? (stage.findOne('.bg') as any) : null;
    const bgWasVisible = bgNode?.visible() ?? true;

    try {
      if (bgNode) {
        bgNode.visible(false);
        stage.batchDraw();
      }

      const pixelRatio = pixelRatioForDpi(cfg.canvas);
      const mm = cfg.canvas.mm ?? { w: 210, h: 297 };

      const mimeType = kind === 'jpg' ? 'image/jpeg' : 'image/png';
      const dataUrl = stage.toDataURL({
        mimeType,
        quality: kind === 'jpg' ? 0.95 : 1,
        pixelRatio,
      });

      const baseName = `clubify-${type.toLowerCase()}-${Date.now()}`;

      if (kind === 'pdf') {
        const pdf = new jsPDF({
          unit: 'mm',
          format: [mm.w, mm.h],
          orientation: mm.w >= mm.h ? 'landscape' : 'portrait',
          compress: true,
        });
        pdf.addImage(dataUrl, 'PNG', 0, 0, mm.w, mm.h, undefined, 'FAST');
        pdf.save(`${baseName}.pdf`);
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${baseName}.${kind}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } finally {
      if (bgNode) {
        bgNode.visible(bgWasVisible);
        stage.batchDraw();
      }
      setExporting(null);
    }
  }

  // ───────── Patches & ops ───────── //

  /** Helper: agrega un id nuevo al layerOrder en su posición default
   *  esperada (antes de footer + iconos + customTexts según el grupo).
   *  Si layerOrder no existía, lo construye desde defaultLayerOrder + el
   *  id nuevo. Esto persiste el orden visual de la capa nueva en cfg —
   *  sin esto, addX dejaba layerOrder sin el id nuevo y el guardado/
   *  recarga podía mostrar la capa en una posición distinta a la que el
   *  usuario veía mientras editaba. */
  function appendToLayerOrder(c: QrPosterConfig, newId: LayerId): LayerId[] {
    // Computar el cfg post-add hipotético para que defaultLayerOrder
    // incluya al newId. Inyectamos un placeholder en el array correcto
    // según el prefijo del id.
    const cWithNew: QrPosterConfig = (() => {
      if (newId.startsWith('shape.')) {
        const sid = newId.slice(6);
        return {
          ...c,
          shapes: [...(c.shapes ?? []), { id: sid } as any],
        };
      }
      if (newId.startsWith('icon.')) {
        const iid = newId.slice(5);
        return { ...c, icons: [...(c.icons ?? []), { id: iid } as any] };
      }
      if (newId.startsWith('image.')) {
        const iid = newId.slice(6);
        return { ...c, images: [...(c.images ?? []), { id: iid } as any] };
      }
      if (newId.startsWith('pattern.')) {
        const pid = newId.slice(8);
        return {
          ...c,
          patterns: [...(c.patterns ?? []), { id: pid } as any],
        };
      }
      if (newId.startsWith('customText.')) {
        const tid = newId.slice('customText.'.length);
        return {
          ...c,
          customTexts: [...(c.customTexts ?? []), { id: tid } as any],
        };
      }
      return c;
    })();
    // effectiveLayerOrder ya hace el trabajo de mergear el layerOrder
    // existente con los ids nuevos respetando posición default. Lo
    // reusamos para no duplicar lógica.
    return effectiveLayerOrder(cWithNew);
  }

  function patchText(layer: keyof QrPosterConfig['texts'], patch: Partial<TextLayer>) {
    setCfg((c) => ({
      ...c,
      texts: { ...c.texts, [layer]: { ...c.texts[layer], ...patch } },
    }));
  }
  function patchShape(id: string, patch: Partial<ShapeLayer>) {
    setCfg((c) => ({
      ...c,
      shapes: (c.shapes ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  }
  /** Crea una shape nueva del tipo elegido con defaults sensatos
   *  según el tipo (un burst arranca con "10% OFF" innerText, un blob
   *  con seed random, una capsule con aspect 3:1, etc). */
  function addShape(type: ShapeType, seed?: Partial<ShapeLayer>) {
    const id = newId();
    // Offset escalonado: usamos un counter MONOTÓNICO (ref) que no
    // decrementa al borrar shapes. Sino el cliente borra una shape y
    // la próxima vuelve a la posición previa, encimándose con otra.
    // El counter se resetea solo cuando el editor se desmonta.
    const idx = addShapeCounterRef.current++;
    const stackOffset = (idx % 8) * 24;
    // Clamp para canvas chicos: el offset no debe sacar la shape del
    // canvas. Caso edge: canvas 480 + shape 300 + offset 168 → x=258,
    // se sale. Recortamos el offset al espacio disponible menos 20px.
    const maxOffset = Math.max(
      0,
      cfg.canvas.w / 2 - (seed?.w ?? 200) / 2 - 20,
    );
    const safeOffset = Math.min(stackOffset, maxOffset);
    const cx = cfg.canvas.w / 2 + safeOffset;
    const cy = cfg.canvas.h / 2 + safeOffset;
    const presets: Record<ShapeType, Partial<ShapeLayer>> = {
      rect: { w: 300, h: 200 },
      circle: { w: 240, h: 240 },
      roundedRect: { w: 360, h: 200, borderRadius: 32 },
      capsule: { w: 360, h: 120 },
      star: { w: 240, h: 240, points: 5, innerRadiusFactor: 0.5 },
      burst: {
        w: 280,
        h: 280,
        points: 16,
        innerRadiusFactor: 0.85,
        fill: '#A78A6C',
        innerText: {
          text: '10%\noff',
          color: '#FFFFFF',
          size: 56,
          font: 'Inter, system-ui, sans-serif',
          weight: 900,
          lineHeight: 1,
        },
      },
      blob: { w: 280, h: 280, seed: Math.floor(Math.random() * 100000) },
    };
    const preset = presets[type] ?? {};
    const newShape: ShapeLayer = {
      id,
      type,
      x: preset.x ?? cx - (preset.w ?? 200) / 2,
      y: preset.y ?? cy - (preset.h ?? 200) / 2,
      w: preset.w ?? 200,
      h: preset.h ?? 200,
      fill: preset.fill ?? '#6366F1',
      opacity: 1,
      borderRadius: preset.borderRadius,
      stroke: undefined,
      strokeWidth: 0,
      rotation: 0,
      innerText: preset.innerText ?? null,
      points: preset.points,
      innerRadiusFactor: preset.innerRadiusFactor,
      seed: preset.seed,
      gradientFill: null,
      ...seed,
    };
    setCfg((c) => ({
      ...c,
      shapes: [...(c.shapes ?? []), newShape],
      // Persistir el ID en layerOrder ya en el momento de creación. Si
      // no, queda a merced de la auto-inserción de effectiveLayerOrder
      // y al guardar+refrescar puede quedar en una posición distinta a
      // la que el usuario veía mientras editaba.
      layerOrder: appendToLayerOrder(c, `shape.${id}` as LayerId),
    }));
    return id;
  }
  function removeShape(id: string) {
    setCfg((c) => ({
      ...c,
      shapes: (c.shapes ?? []).filter((s) => s.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `shape.${id}`),
    }));
  }
  function duplicateShape(id: string) {
    const src = (cfg.shapes ?? []).find((s) => s.id === id);
    if (!src) return;
    // Lógica de offset escalonada:
    // 1. +24 a la derecha + abajo si entra
    // 2. -24 a la izq/arriba si no
    // 3. Si NINGUNO da offset visible (caso: shape ocupa casi todo el
    //    canvas), achicar la copia 5% para que sea distinguible visualmente
    const wouldFitRight = src.x + 24 + src.w <= cfg.canvas.w;
    const wouldFitBelow = src.y + 24 + src.h <= cfg.canvas.h;
    const nx = wouldFitRight ? src.x + 24 : Math.max(8, src.x - 24);
    const ny = wouldFitBelow ? src.y + 24 : Math.max(8, src.y - 24);
    const offsetTooSmall =
      Math.abs(nx - src.x) < 12 && Math.abs(ny - src.y) < 12;
    const scale = offsetTooSmall ? 0.92 : 1;
    const newDup: ShapeLayer = {
      ...src,
      id: newId(),
      x: nx,
      y: ny,
      w: Math.round(src.w * scale),
      h: Math.round(src.h * scale),
      innerText: src.innerText ? { ...src.innerText } : null,
      gradientFill: src.gradientFill ? { ...src.gradientFill } : null,
    };
    setCfg((c) => ({
      ...c,
      shapes: [...(c.shapes ?? []), newDup],
      layerOrder: appendToLayerOrder(c, `shape.${newDup.id}` as LayerId),
    }));
  }
  function patchIcon(id: string, patch: Partial<IconLayer>) {
    setCfg((c) => ({
      ...c,
      icons: (c.icons ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  }
  function patchImage(id: string, patch: Partial<ImageLayer>) {
    setCfg((c) => ({
      ...c,
      images: (c.images ?? []).map((im) => (im.id === id ? { ...im, ...patch } : im)),
    }));
  }
  function patchCustomText(id: string, patch: Partial<CustomTextLayer>) {
    setCfg((c) => ({
      ...c,
      customTexts: (c.customTexts ?? []).map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }));
  }
  function addCustomText(seed?: Partial<CustomTextLayer>) {
    const id = newId();
    // Safe boxWidth: clamp para que el texto quepa SIEMPRE dentro del
    // canvas — incluso en lienzos chicos (stickers, circulares
    // 1080×1080). Sin esto, addCustomText con boxWidth=400 en un canvas
    // de 320px dejaba la caja desbordada o invisible.
    const targetBoxW = seed?.boxWidth ?? Math.min(400, cfg.canvas.w - 40);
    const cx = cfg.canvas.w / 2;
    const cy = cfg.canvas.h / 2;
    const newText: CustomTextLayer = {
      id,
      text: seed?.text ?? 'Texto nuevo',
      x: seed?.x ?? Math.max(20, cx - targetBoxW / 2),
      y: seed?.y ?? cy,
      font: seed?.font ?? 'Inter, system-ui, sans-serif',
      fontLabel: seed?.fontLabel ?? 'Inter',
      size: seed?.size ?? 48,
      color: seed?.color ?? '#0A0A0A',
      weight: seed?.weight ?? 700,
      align: seed?.align ?? 'center',
      opacity: seed?.opacity ?? 1,
      rotation: seed?.rotation ?? 0,
      lineHeight: seed?.lineHeight ?? 1.2,
      letterSpacing: seed?.letterSpacing ?? 0,
      boxWidth: targetBoxW,
      shadow: seed?.shadow ?? null,
      locked: false,
      hidden: false,
    };
    setCfg((c) => ({
      ...c,
      customTexts: [...(c.customTexts ?? []), newText],
      layerOrder: appendToLayerOrder(c, `customText.${id}` as LayerId),
    }));
    return id;
  }
  function duplicateCustomText(id: string) {
    const src = (cfg.customTexts ?? []).find((t) => t.id === id);
    if (!src) return;
    // Offset diagonal pero clampeado al canvas — si la caja original
    // estaba en el borde, +24 la sacaba afuera y el cliente "no veía"
    // la copia.
    const boxW = src.boxWidth ?? cfg.canvas.w;
    const maxX = Math.max(0, cfg.canvas.w - boxW - 8);
    const maxY = Math.max(0, cfg.canvas.h - src.size - 8);
    const nx = Math.min(src.x + 24, maxX);
    const ny = Math.min(src.y + 24, maxY);
    const newDup = {
      ...src,
      // Clonado profundo del shadow (sino la copia y el original
      // comparten el objeto shadow y editar uno muta el otro).
      shadow: src.shadow ? { ...src.shadow } : null,
      id: newId(),
      x: nx,
      y: ny,
      locked: false,
    };
    setCfg((c) => ({
      ...c,
      customTexts: [...(c.customTexts ?? []), newDup],
      layerOrder: appendToLayerOrder(c, `customText.${newDup.id}` as LayerId),
    }));
  }
  function removeCustomText(id: string) {
    setCfg((c) => ({
      ...c,
      customTexts: (c.customTexts ?? []).filter((t) => t.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `customText.${id}`),
    }));
  }

  function patchPattern(id: string, patch: Partial<PatternLayer>) {
    setCfg((c) => ({
      ...c,
      patterns: (c.patterns ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }
  function patchLogo(patch: Partial<NonNullable<QrPosterConfig['logo']>>) {
    setCfg((c) => ({
      ...c,
      logo: c.logo ? { ...c.logo, ...patch } : c.logo,
    }));
  }
  function patchBg(patch: Partial<BgConfig>) {
    setCfg((c) => ({ ...c, bg: { ...c.bg, ...patch } as BgConfig }));
  }
  function addIcon(emoji: string) {
    const id = newId();
    const newIcon: IconLayer = {
      id,
      emoji,
      x: cfg.canvas.w / 2 - 50,
      y: cfg.canvas.h / 2 - 50,
      size: 100,
      opacity: 1,
    };
    setCfg((c) => ({
      ...c,
      icons: [...(c.icons ?? []), newIcon],
      layerOrder: appendToLayerOrder(c, `icon.${id}` as LayerId),
    }));
  }
  function removeIcon(id: string) {
    setCfg((c) => ({
      ...c,
      icons: (c.icons ?? []).filter((i) => i.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `icon.${id}`),
    }));
  }
  function addImageFromDataUrl(dataUrl: string, naturalW: number, naturalH: number) {
    const id = newId();
    // Encuadrar al 50% del canvas manteniendo aspect
    const aspect = naturalW / naturalH;
    const targetW = Math.min(cfg.canvas.w * 0.5, naturalW);
    const targetH = targetW / aspect;
    const newImg: ImageLayer = {
      id,
      url: dataUrl,
      x: (cfg.canvas.w - targetW) / 2,
      y: (cfg.canvas.h - targetH) / 2,
      w: targetW,
      h: targetH,
      opacity: 1,
      rotation: 0,
      keepAspect: true,
    };
    setCfg((c) => ({
      ...c,
      images: [...(c.images ?? []), newImg],
      layerOrder: appendToLayerOrder(c, `image.${id}` as LayerId),
    }));
  }
  function removeImage(id: string) {
    setCfg((c) => ({
      ...c,
      images: (c.images ?? []).filter((im) => im.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `image.${id}`),
    }));
  }
  function addPattern(opts: { emojis?: string[]; imageUrl?: string }) {
    const id = newId();
    const newPat: PatternLayer = {
      id,
      emojis: opts.emojis && opts.emojis.length ? opts.emojis : ['✨'],
      imageUrl: opts.imageUrl ?? null,
      size: 64,
      gap: 32,
      opacity: 0.5,
      rotation: 0,
      density: 1,
      fullCanvas: true,
      seed: Math.floor(Math.random() * 100000),
    };
    setCfg((c) => ({
      ...c,
      patterns: [...(c.patterns ?? []), newPat],
      layerOrder: appendToLayerOrder(c, `pattern.${id}` as LayerId),
    }));
  }
  function removePattern(id: string) {
    setCfg((c) => ({
      ...c,
      patterns: (c.patterns ?? []).filter((p) => p.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `pattern.${id}`),
    }));
  }
  function toggleLogo() {
    setCfg((c) => {
      if (c.logo) return { ...c, logo: null };
      if (!logoUrl) return c;
      return {
        ...c,
        logo: {
          url: logoUrl,
          x: c.canvas.w / 2 - 150,
          y: 200,
          size: 300,
          opacity: 1,
        },
      };
    });
  }
  function moveLayer(id: LayerId, direction: 'up' | 'down') {
    setCfg((c) => {
      const order = effectiveLayerOrder(c).slice();
      const idx = order.indexOf(id);
      if (idx < 0) return c;
      const target = direction === 'up' ? idx + 1 : idx - 1;
      if (target < 0 || target >= order.length) return c;
      [order[idx], order[target]] = [order[target], order[idx]];
      return { ...c, layerOrder: order };
    });
  }

  // Drag helpers — devuelven el dragBoundFunc + onDragEnd que aplican
  // snapping y limpian guías. Cada layer pasa su id + bbox actual.
  function makeDragHandlers<T extends { x: number; y: number }>(
    layerId: string,
    box: { x: number; y: number; w: number; h: number },
    onUpdate: (x: number, y: number) => void,
  ) {
    return {
      onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        const newBox = { x: node.x(), y: node.y(), w: box.w, h: box.h };
        const others = gatherSnapTargets(cfg);
        const snap = computeSnap(newBox, others, cfg.canvas.w, cfg.canvas.h, layerId);
        if (snap.x !== newBox.x) node.x(snap.x);
        if (snap.y !== newBox.y) node.y(snap.y);
        setGuides(snap.guides);
      },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onUpdate(node.x(), node.y());
        setGuides([]);
      },
    };
  }

  // Mientras carga: NO renderizamos el editor — sino el primer paint
  // con cfg=defaultConfig podría disparar autosave si la guard fallara, o
  // el usuario podría empezar a editar sobre datos viejos. El skeleton
  // mantiene la página estable y comunica al usuario que está esperando.
  if (editorLoadError) {
    return (
      <div className="py-16 text-center">
        <div className="text-bad text-sm mb-2">⚠ {editorLoadError}</div>
        <button
          onClick={() => window.location.reload()}
          className="btn-ghost text-xs"
        >
          Recargar
        </button>
      </div>
    );
  }
  if (loading || !hasLoadedRef.current) {
    return (
      <div className="py-16 text-center">
        <div className="inline-flex items-center gap-2 text-mute text-sm">
          <span className="inline-block w-4 h-4 border-2 border-mute/30 border-t-mute rounded-full animate-spin" />
          Cargando diseño guardado…
        </div>
        <div className="text-[11px] text-mute/70 mt-2">
          No edites hasta que termine de cargar.
        </div>
      </div>
    );
  }

  const bgFill = rectFillProps(cfg.bg, cfg.canvas.w, cfg.canvas.h);
  const layerOrder = effectiveLayerOrder(cfg);

  // bbox del bg image para render (depende del image natural size)
  const bgImageDraw =
    cfg.bg.type === 'image' && bgImage
      ? bgImageRect(
          bgImage.naturalWidth,
          bgImage.naturalHeight,
          cfg.canvas.w,
          cfg.canvas.h,
          cfg.bg.zoom ?? 1,
          cfg.bg.offsetX ?? 0,
          cfg.bg.offsetY ?? 0,
        )
      : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
      {/* ─────────────────────── Sidebar ─────────────────────── */}
      <div className="space-y-3 lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto lg:pr-2">
        {/* Slot type-specific (selector de card, código promo, etc) */}
        {metaSlot &&
          metaSlot(meta, (m) => setCfg((c) => ({ ...c, meta: m })))}

        {/* Banner QR dinámico */}
        <div className="card card-pad bg-emerald-50/60 border-emerald-200">
          <div className="flex items-start gap-2">
            <span className="text-base">🔗</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-800">
                QR dinámico
              </div>
              <div className="text-xs text-emerald-900 break-all mt-1 font-mono">
                {effectiveUrl.replace(/^https?:\/\//, '')}
              </div>
              <div className="text-[11px] text-emerald-800/80 mt-1.5 leading-relaxed">
                Aunque cambies tu menú, wallet o promociones, el cartel
                impreso sigue funcionando.
              </div>
            </div>
          </div>
        </div>

        {/* Acciones */}
        <div className="card card-pad space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => save()}
              disabled={saving}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {saving ? 'Guardando…' : 'Guardar diseño'}
            </button>
            <button onClick={reset} className="btn-ghost text-xs" title="Restablecer">
              ↺
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={undo}
              disabled={!canUndo}
              className="btn-ghost flex-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              title="Deshacer (⌘Z)"
            >
              ← Deshacer
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              className="btn-ghost flex-1 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              title="Rehacer (⌘⇧Z)"
            >
              Rehacer →
            </button>
          </div>
          <AutosaveStatus
            state={autosaveState}
            savedAt={savedAt}
            error={saveError}
          />
          {localBackupFailed && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 leading-relaxed">
              ⚠ El backup local está lleno (imágenes grandes). Tu auto-save
              al servidor sigue funcionando pero <strong>no</strong> hay
              respaldo local — si refrescás antes del próximo guardado,
              podrías perder cambios. Subí imágenes más livianas.
            </div>
          )}
          <div className="text-[11px] text-mute leading-relaxed">
            Arrastrá cualquier elemento en el canvas — guías rosa/verde
            te ayudan a centrar. Auto-save cada 2.5s + backup local
            por refresh accidental. ⌘Z para deshacer.
          </div>
        </div>

        {/* Export */}
        <ExportPanel
          exporting={exporting}
          onExport={doExport}
          mm={cfg.canvas.mm}
          dpi={cfg.canvas.dpi ?? 300}
        />

        {/* Templates */}
        <Section title="Templates" icon="🎨">
          <div className="grid grid-cols-2 gap-2">
            {QR_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => {
                  // Confirmar antes de pisar trabajo custom (shapes
                  // libres + textos libres del cliente) o cambiar el
                  // canvas. Si AMBOS aplican, el mensaje los menciona
                  // juntos para que el cliente entienda completo.
                  const hasCustomWork =
                    (cfg.shapes?.length ?? 0) > 0 ||
                    (cfg.customTexts?.length ?? 0) > 0;
                  const willChangeCanvas =
                    !!tpl.overrides.canvas &&
                    (tpl.overrides.canvas.w !== cfg.canvas.w ||
                      tpl.overrides.canvas.h !== cfg.canvas.h);
                  if (hasCustomWork || willChangeCanvas) {
                    const parts: string[] = [];
                    if (hasCustomWork) {
                      parts.push('reemplazará tus formas y textos libres');
                    }
                    if (willChangeCanvas) {
                      parts.push(
                        `cambiará el lienzo a ${tpl.overrides.canvas!.w}×${tpl.overrides.canvas!.h}`,
                      );
                    }
                    const msg = `Aplicar "${tpl.name}" ${parts.join(
                      ' y ',
                    )}. ¿Continuar?`;
                    if (!confirm(msg)) return;
                  }
                  setCfg((c) => applyTemplate(c, tpl));
                }}
                className="text-left rounded-lg overflow-hidden border-2 border-line hover:border-brand transition group"
                title={`Aplicar template ${tpl.name}`}
              >
                <div
                  className="h-14 flex items-center justify-center text-lg font-bold"
                  style={{
                    background: tpl.swatch.to
                      ? `linear-gradient(135deg, ${tpl.swatch.from}, ${tpl.swatch.to})`
                      : tpl.swatch.from,
                    color: tpl.swatch.text,
                  }}
                >
                  Aa
                </div>
                <div className="px-2 py-1.5 text-[11px] font-semibold text-ink leading-tight">
                  {tpl.name}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {/* Fondo (con imagen) */}
        <BackgroundSection bg={cfg.bg} onChange={patchBg} setCfg={setCfg} />

        {/* QR */}
        <Section title="Código QR" icon="🔳">
          <NumberRow
            label="Tamaño"
            value={cfg.qr.size}
            min={200}
            max={900}
            step={10}
            onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, size: v } }))}
          />
          <PositionRow
            x={cfg.qr.x}
            y={cfg.qr.y}
            onChange={(x, y) => setCfg((c) => ({ ...c, qr: { ...c.qr, x, y } }))}
          />
          {/* Botones de centrado matemáticamente preciso. Sin esto el
           *  cliente tiene que calcular x = (canvasW - qrSize) / 2 a
           *  mano y suele dejarlo aproximado. */}
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() =>
                setCfg((c) => ({
                  ...c,
                  qr: { ...c.qr, x: (c.canvas.w - c.qr.size) / 2 },
                }))
              }
              className="btn-ghost text-[10px] py-1.5"
              title="Centrar horizontalmente"
            >
              ↔ Centro H
            </button>
            <button
              type="button"
              onClick={() =>
                setCfg((c) => ({
                  ...c,
                  qr: { ...c.qr, y: (c.canvas.h - c.qr.size) / 2 },
                }))
              }
              className="btn-ghost text-[10px] py-1.5"
              title="Centrar verticalmente"
            >
              ↕ Centro V
            </button>
            <button
              type="button"
              onClick={() =>
                setCfg((c) => ({
                  ...c,
                  qr: {
                    ...c.qr,
                    x: (c.canvas.w - c.qr.size) / 2,
                    y: (c.canvas.h - c.qr.size) / 2,
                  },
                }))
              }
              className="btn-ghost text-[10px] py-1.5"
              title="Centrar en el canvas"
            >
              ⊕ Centro
            </button>
          </div>
          <ColorRow
            label="Color"
            value={cfg.qr.fg}
            onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, fg: v } }))}
          />
          <ColorRow
            label="Fondo"
            value={cfg.qr.bg}
            onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, bg: v } }))}
          />
          <OpacityRow
            value={cfg.qr.opacity ?? 1}
            onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, opacity: v } }))}
          />
          {/* Marco/padding/sombra del bloque QR — útil para layouts
              donde el QR está sobre un fondo de color y se quiere un
              "papel" con borde redondeado tipo sticker. */}
          <div className="pt-2 border-t border-line2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
              Marco del QR
            </div>
            <NumberRow
              label="Padding"
              value={cfg.qr.padding ?? 0}
              min={0}
              // Cap dinámico: el padding + el QR no debe exceder el
              // canvas. Sino el sticker entero se sale visualmente.
              max={Math.max(
                0,
                Math.floor((Math.min(cfg.canvas.w, cfg.canvas.h) - cfg.qr.size) / 2),
              )}
              step={2}
              onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, padding: v } }))}
            />
            <NumberRow
              label="Esquinas"
              value={cfg.qr.cornerRadius ?? 0}
              min={0}
              max={80}
              step={2}
              onChange={(v) =>
                setCfg((c) => ({ ...c, qr: { ...c.qr, cornerRadius: v } }))
              }
            />
            <NumberRow
              label="Borde px"
              value={cfg.qr.borderWidth ?? 0}
              min={0}
              max={20}
              step={1}
              onChange={(v) =>
                setCfg((c) => ({ ...c, qr: { ...c.qr, borderWidth: v } }))
              }
            />
            {(cfg.qr.borderWidth ?? 0) > 0 && (
              <ColorRow
                label="Color borde"
                value={cfg.qr.borderColor ?? '#000000'}
                onChange={(v) =>
                  setCfg((c) => ({ ...c, qr: { ...c.qr, borderColor: v } }))
                }
              />
            )}
            {(cfg.qr.padding ?? 0) > 0 && (
              <ColorRow
                label="Color marco"
                value={cfg.qr.paddingColor ?? cfg.qr.bg ?? '#FFFFFF'}
                onChange={(v) =>
                  setCfg((c) => ({ ...c, qr: { ...c.qr, paddingColor: v } }))
                }
              />
            )}
            {/* Sombra del bloque QR — útil para look "sticker" elevado */}
            {!cfg.qr.shadow ? (
              <button
                type="button"
                onClick={() =>
                  setCfg((c) => ({
                    ...c,
                    qr: {
                      ...c.qr,
                      shadow: {
                        color: '#000000',
                        blur: 12,
                        offsetX: 4,
                        offsetY: 6,
                        opacity: 0.3,
                      },
                    },
                  }))
                }
                className="w-full text-[11px] text-mute hover:text-ink border border-dashed border-line rounded py-1.5"
              >
                + Agregar sombra
              </button>
            ) : (
              <div className="border border-line rounded p-2 bg-bg2/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold">Sombra</span>
                  <button
                    type="button"
                    onClick={() =>
                      setCfg((c) => ({ ...c, qr: { ...c.qr, shadow: null } }))
                    }
                    className="text-mute hover:text-red-500 text-xs"
                  >
                    ✕
                  </button>
                </div>
                <ColorRow
                  label="Color"
                  value={cfg.qr.shadow.color}
                  onChange={(v) =>
                    setCfg((c) => ({
                      ...c,
                      qr: { ...c.qr, shadow: { ...c.qr.shadow!, color: v } },
                    }))
                  }
                />
                <NumberRow
                  label="Blur"
                  value={cfg.qr.shadow.blur}
                  min={0}
                  max={50}
                  step={1}
                  onChange={(v) =>
                    setCfg((c) => ({
                      ...c,
                      qr: { ...c.qr, shadow: { ...c.qr.shadow!, blur: v } },
                    }))
                  }
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <NumberRow
                    label="Off X"
                    value={cfg.qr.shadow.offsetX}
                    min={-30}
                    max={30}
                    step={1}
                    onChange={(v) =>
                      setCfg((c) => ({
                        ...c,
                        qr: { ...c.qr, shadow: { ...c.qr.shadow!, offsetX: v } },
                      }))
                    }
                  />
                  <NumberRow
                    label="Off Y"
                    value={cfg.qr.shadow.offsetY}
                    min={-30}
                    max={30}
                    step={1}
                    onChange={(v) =>
                      setCfg((c) => ({
                        ...c,
                        qr: { ...c.qr, shadow: { ...c.qr.shadow!, offsetY: v } },
                      }))
                    }
                  />
                </div>
                <OpacityRow
                  value={cfg.qr.shadow.opacity ?? 1}
                  onChange={(v) =>
                    setCfg((c) => ({
                      ...c,
                      qr: { ...c.qr, shadow: { ...c.qr.shadow!, opacity: v } },
                    }))
                  }
                />
              </div>
            )}
          </div>
        </Section>

        {/* Textos */}
        {(['title', 'subtitle', 'cta', 'brand'] as const).map((key) => (
          <Section key={key} title={LAYER_LABELS[key]} icon="🅣">
            <LockRow
              locked={cfg.texts[key].locked === true}
              onToggle={() =>
                patchText(key, { locked: !cfg.texts[key].locked })
              }
            />
            <AutoResizeTextarea
              value={cfg.texts[key].text}
              onChange={(v) => patchText(key, { text: v })}
              placeholder={LAYER_LABELS[key]}
            />
            <FontPicker
              value={cfg.texts[key].font}
              onChange={(v) => {
                const opt = FONT_OPTIONS.find((o) => o.value === v);
                patchText(key, {
                  font: v,
                  fontLabel: opt?.label ?? cfg.texts[key].fontLabel,
                });
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberRow
                label="Tamaño"
                value={cfg.texts[key].size}
                min={16}
                max={200}
                step={2}
                onChange={(v) => patchText(key, { size: v })}
              />
              <SelectRow
                label="Peso"
                value={String(cfg.texts[key].weight)}
                options={[
                  { label: 'Regular', value: '400' },
                  { label: 'Semibold', value: '600' },
                  { label: 'Bold', value: '700' },
                  { label: 'Black', value: '900' },
                ]}
                onChange={(v) => patchText(key, { weight: Number(v) })}
              />
            </div>
            <ColorRow
              label="Color"
              value={cfg.texts[key].color}
              onChange={(v) => patchText(key, { color: v })}
            />
            <PositionRow
              x={cfg.texts[key].x}
              y={cfg.texts[key].y}
              onChange={(x, y) => patchText(key, { x, y })}
            />
            <TextAlignButtons
              value={cfg.texts[key].align}
              onChange={(v) => patchText(key, { align: v })}
            />
            <PageAlignButtons
              layer={cfg.texts[key]}
              canvasW={cfg.canvas.w}
              canvasH={cfg.canvas.h}
              onPatch={(p) => patchText(key, p)}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberRow
                label="Línea"
                value={cfg.texts[key].lineHeight ?? 1.2}
                min={0.8}
                max={3}
                step={0.1}
                onChange={(v) => patchText(key, { lineHeight: v })}
              />
              <NumberRow
                label="Letra"
                value={cfg.texts[key].letterSpacing ?? 0}
                min={-10}
                max={50}
                step={1}
                onChange={(v) => patchText(key, { letterSpacing: v })}
              />
            </div>
            <NumberRow
              label="Rotación"
              value={cfg.texts[key].rotation ?? 0}
              min={-180}
              max={180}
              step={5}
              onChange={(v) => patchText(key, { rotation: v })}
            />
            <OpacityRow
              value={cfg.texts[key].opacity ?? 1}
              onChange={(v) => patchText(key, { opacity: v })}
            />
            <TextShadowEditor
              shadow={cfg.texts[key].shadow ?? null}
              onChange={(s) => patchText(key, { shadow: s })}
            />
          </Section>
        ))}

        {/* Textos libres adicionales */}
        <CustomTextsSection
          texts={cfg.customTexts ?? []}
          canvasW={cfg.canvas.w}
          canvasH={cfg.canvas.h}
          onAdd={() => addCustomText()}
          onPatch={patchCustomText}
          onDuplicate={duplicateCustomText}
          onRemove={removeCustomText}
        />

        {/* Tamaño de lienzo + DPI */}
        <CanvasSection cfg={cfg} setCfg={setCfg} />

        {/* Sección "Logo del negocio" removida — la imagen del logo se
         *  sube ahora vía la sección "Imágenes" (Section ImagesSection)
         *  con todos los controles de tamaño/rotación/opacidad/lock.
         *  El renderer todavía dibuja `cfg.logo` si está seteado en una
         *  config antigua, manteniendo compat hacia atrás. */}

        {/* Formas — re-introducida con tipos extendidos (roundedRect,
            capsule, star, burst, blob) + sticker promocional con texto
            adentro. Útil para composiciones tipo Canva/Adobe Express. */}
        <ShapesSection
          shapes={cfg.shapes ?? []}
          onAdd={addShape}
          onPatch={patchShape}
          onDuplicate={duplicateShape}
          onRemove={removeShape}
        />

        {/* Imágenes (PNG/SVG/JPG/WebP libres) */}
        <ImagesSection
          images={cfg.images ?? []}
          onAdd={addImageFromDataUrl}
          onPatch={patchImage}
          onRemove={removeImage}
          canvasW={cfg.canvas.w}
          canvasH={cfg.canvas.h}
        />

        {/* Patrones (emojis) */}
        <PatternsSection
          patterns={cfg.patterns ?? []}
          onAdd={addPattern}
          onPatch={patchPattern}
          onRemove={removePattern}
        />

        {/* Emojis / iconos */}
        <EmojisSection
          icons={cfg.icons ?? []}
          onAdd={addIcon}
          onPatch={patchIcon}
          onRemove={removeIcon}
        />

        {/* Capas */}
        <Section title="Capas" icon="📚">
          <div className="text-[10px] text-mute mb-1.5">
            Las capas de arriba se ven sobre las de abajo (frente → atrás).
          </div>
          <div className="space-y-1">
            {[...layerOrder].reverse().map((id, displayIdx) => {
              const total = layerOrder.length;
              const realIdx = total - 1 - displayIdx;
              const label = layerLabel(id, cfg);
              if (!label) return null;
              return (
                <div
                  key={id}
                  className="flex items-center gap-1 bg-bg2/40 rounded p-1.5 text-xs"
                >
                  <span className="flex-1 truncate" title={label}>
                    {label}
                  </span>
                  <button
                    onClick={() => moveLayer(id, 'up')}
                    disabled={realIdx === total - 1}
                    className="text-mute hover:text-ink disabled:opacity-20 px-1"
                    title="Subir (al frente)"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveLayer(id, 'down')}
                    disabled={realIdx === 0}
                    className="text-mute hover:text-ink disabled:opacity-20 px-1"
                    title="Bajar (al fondo)"
                  >
                    ↓
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* ─────────────────────── Canvas ─────────────────────── */}
      <div ref={containerRef} className="flex items-start justify-center">
        <div className="bg-bg2/40 p-4 rounded-2xl shadow-card">
          <div
            style={{
              width: stageWidth,
              height: stageHeight,
              background: '#fff',
            }}
          >
            <Stage
              ref={stageRef}
              width={stageWidth}
              height={stageHeight}
              scaleX={scale}
              scaleY={scale}
            >
              <Layer>
                <Group
                  clipFunc={
                    cfg.clipShape === 'circle'
                      ? (ctx) => {
                          ctx.beginPath();
                          const r = Math.min(cfg.canvas.w, cfg.canvas.h) / 2;
                          ctx.arc(
                            cfg.canvas.w / 2,
                            cfg.canvas.h / 2,
                            r,
                            0,
                            Math.PI * 2,
                          );
                          ctx.closePath();
                        }
                      : undefined
                  }
                >
                  {layerOrder.map((id) => {
                    if (id === 'bg') {
                      return (
                        // name="bg" → permite que doExport lo encuentre
                        // por findOne('.bg') y lo oculte cuando el cliente
                        // exporta como PNG (transparente). En JPG/PDF se
                        // queda visible normalmente.
                        <Group key="bg" name="bg" listening={false}>
                          {/* Base color/gradient. Para imagen, deja blanco
                              que luego se cubre con el KonvaImage. */}
                          <Rect
                            x={0}
                            y={0}
                            width={cfg.canvas.w}
                            height={cfg.canvas.h}
                            {...bgFill}
                          />
                          {cfg.bg.type === 'image' && bgImage && bgImageDraw && (
                            <BgImageView
                              image={bgImage}
                              x={bgImageDraw.x}
                              y={bgImageDraw.y}
                              w={bgImageDraw.w}
                              h={bgImageDraw.h}
                              opacity={cfg.bg.opacity ?? 1}
                              blur={cfg.bg.blur ?? 0}
                            />
                          )}
                          {cfg.bg.type === 'image' && cfg.bg.overlayColor && (
                            <Rect
                              x={0}
                              y={0}
                              width={cfg.canvas.w}
                              height={cfg.canvas.h}
                              fill={cfg.bg.overlayColor}
                              opacity={cfg.bg.overlayOpacity ?? 0.3}
                            />
                          )}
                        </Group>
                      );
                    }
                    if (id === 'qr') {
                      if (!qrImage) return null;
                      // Bounding box del QR INCLUYE el padding — sirve
                      // para drag + snap. El QR puro se dibuja adentro.
                      const pad = cfg.qr.padding ?? 0;
                      const totalW = cfg.qr.size + pad * 2;
                      const handlers = makeDragHandlers(
                        'qr',
                        { x: cfg.qr.x, y: cfg.qr.y, w: totalW, h: totalW },
                        (x, y) =>
                          setCfg((c) => ({ ...c, qr: { ...c.qr, x, y } })),
                      );
                      const cornerR = cfg.qr.cornerRadius ?? 0;
                      // Default al BG del QR para preservar el render
                      // de posters viejos (donde el "marco" era una
                      // extensión visual del fondo del QR). Si el cliente
                      // quiere un marco diferente, lo cambia desde
                      // ColorRow "Color marco" (visible cuando padding>0).
                      const padColor =
                        cfg.qr.paddingColor ?? cfg.qr.bg ?? '#FFFFFF';
                      const borderW = cfg.qr.borderWidth ?? 0;
                      const borderColor = cfg.qr.borderColor ?? '#000000';
                      const sh = cfg.qr.shadow;
                      return (
                        <Group
                          key="qr"
                          x={cfg.qr.x}
                          y={cfg.qr.y}
                          opacity={cfg.qr.opacity ?? 1}
                          draggable
                          {...handlers}
                        >
                          {/* Padding/marco + sombra + borde + cornerRadius
                              renderizados como Rect detrás del QR */}
                          {(pad > 0 || cornerR > 0 || borderW > 0 || sh) && (
                            <Rect
                              x={0}
                              y={0}
                              width={totalW}
                              height={totalW}
                              fill={padColor}
                              cornerRadius={cornerR}
                              stroke={borderW > 0 ? borderColor : undefined}
                              strokeWidth={borderW}
                              shadowColor={sh?.color}
                              shadowBlur={sh?.blur ?? 0}
                              shadowOffsetX={sh?.offsetX ?? 0}
                              shadowOffsetY={sh?.offsetY ?? 0}
                              shadowOpacity={sh?.opacity ?? (sh ? 1 : 0)}
                            />
                          )}
                          {/* KonvaImage DEBE escuchar eventos sino el
                              Group no se puede draggear cuando no hay
                              marco (Rect del padding renderea solo si
                              padding/border/shadow/cornerRadius > 0).
                              Sin un child hittable, el Group queda sin
                              hit area y el drag no funciona. */}
                          <KonvaImage
                            image={qrImage}
                            x={pad}
                            y={pad}
                            width={cfg.qr.size}
                            height={cfg.qr.size}
                          />
                        </Group>
                      );
                    }
                    if (id === 'logo') {
                      if (!cfg.logo || !logoImage) return null;
                      const locked = cfg.logo.locked === true;
                      const handlers = locked
                        ? { onDragMove: undefined, onDragEnd: undefined }
                        : makeDragHandlers(
                            'logo',
                            { x: cfg.logo.x, y: cfg.logo.y, w: cfg.logo.size, h: cfg.logo.size },
                            (x, y) => patchLogo({ x, y }),
                          );
                      return (
                        <KonvaImage
                          key="logo"
                          image={logoImage}
                          x={cfg.logo.x}
                          y={cfg.logo.y}
                          width={cfg.logo.size}
                          height={cfg.logo.size}
                          opacity={cfg.logo.opacity ?? 1}
                          rotation={cfg.logo.rotation ?? 0}
                          draggable={!locked}
                          listening={!locked}
                          {...(handlers as any)}
                        />
                      );
                    }
                    if (id.startsWith('text.')) {
                      const key = id.slice(5) as keyof QrPosterConfig['texts'];
                      const t = cfg.texts[key];
                      if (!t) return null;
                      // El contenedor de Konva.Text define el área para
                      // alineación interna. boxWidth seteado = caja propia
                      // anclada en (x,y); sino, todo el ancho del canvas
                      // anclado en x=0.
                      const renderWidth = t.boxWidth ?? cfg.canvas.w;
                      const renderX = t.boxWidth != null ? t.x : 0;
                      // Para drag usamos el bbox VISUAL (estimateTextBox)
                      // no el contenedor — sino los smart guides snapean
                      // al borde de la caja invisible y no al centro
                      // óptico del texto.
                      const visualBox = estimateTextBox(t, cfg.canvas.w);
                      const handlers = t.locked
                        ? { onDragMove: undefined, onDragEnd: undefined }
                        : makeDragHandlers(
                            `text.${key}`,
                            visualBox,
                            (newVisualX, newVisualY) => {
                              // Convertimos delta visual → delta del anclaje
                              // (t.x). Si la alineación es center/right
                              // sin boxWidth, el render X queda fijo en 0
                              // pero el visualX dependía del texto — solo
                              // movemos Y. Si tiene boxWidth, el render X
                              // sí cambia con el drag.
                              const deltaX = newVisualX - visualBox.x;
                              const deltaY = newVisualY - visualBox.y;
                              const canMoveX =
                                t.boxWidth != null || t.align === 'left';
                              patchText(key, {
                                x: canMoveX ? t.x + deltaX : t.x,
                                y: t.y + deltaY,
                              });
                            },
                          );
                      return (
                        <Text
                          key={id}
                          text={t.text}
                          x={renderX}
                          y={t.y}
                          width={renderWidth}
                          fontFamily={t.font}
                          fontSize={t.size}
                          fontStyle={t.weight >= 700 ? 'bold' : 'normal'}
                          fill={t.color}
                          align={t.align}
                          lineHeight={t.lineHeight ?? 1.2}
                          letterSpacing={t.letterSpacing ?? 0}
                          opacity={t.opacity ?? 1}
                          rotation={t.rotation ?? 0}
                          shadowColor={t.shadow?.color}
                          shadowBlur={t.shadow?.blur ?? 0}
                          shadowOffsetX={t.shadow?.offsetX ?? 0}
                          shadowOffsetY={t.shadow?.offsetY ?? 0}
                          shadowOpacity={t.shadow?.opacity ?? (t.shadow ? 1 : 0)}
                          draggable={!t.locked}
                          listening={!t.locked}
                          {...(handlers as any)}
                        />
                      );
                    }
                    if (id === 'footer') {
                      const bgIsLightSolid =
                        cfg.bg.type === 'solid' &&
                        cfg.bg.color1.toUpperCase() === '#FFFFFF';
                      return (
                        <Text
                          key="footer"
                          text="Powered by Clubify"
                          x={0}
                          y={cfg.canvas.h - 60}
                          width={cfg.canvas.w}
                          fontFamily="Inter, system-ui, sans-serif"
                          fontSize={22}
                          fill={bgIsLightSolid ? '#9CA3AF' : 'rgba(255,255,255,0.75)'}
                          align="center"
                          listening={false}
                        />
                      );
                    }
                    if (id.startsWith('shape.')) {
                      const sid = id.slice(6);
                      const s = cfg.shapes?.find((sh) => sh.id === sid);
                      if (!s) return null;
                      return (
                        <ShapeView
                          key={id}
                          shape={s}
                          cfg={cfg}
                          onPatch={(patch) => patchShape(sid, patch)}
                          setGuides={setGuides}
                          gatherSnapTargets={gatherSnapTargets}
                          computeSnap={computeSnap}
                        />
                      );
                    }
                    if (id.startsWith('image.')) {
                      const iid = id.slice(6);
                      const im = cfg.images?.find((x) => x.id === iid);
                      if (!im) return null;
                      return (
                        <ImageLayerView
                          key={id}
                          layer={im}
                          makeHandlers={(box, onUpdate) =>
                            makeDragHandlers(`image.${iid}`, box, onUpdate)
                          }
                          onMove={(x, y) => patchImage(iid, { x, y })}
                        />
                      );
                    }
                    if (id.startsWith('pattern.')) {
                      const pid = id.slice(8);
                      const p = cfg.patterns?.find((x) => x.id === pid);
                      if (!p) return null;
                      return (
                        <PatternLayerView
                          key={id}
                          layer={p}
                          canvasW={cfg.canvas.w}
                          canvasH={cfg.canvas.h}
                        />
                      );
                    }
                    if (id.startsWith('icon.')) {
                      const iid = id.slice(5);
                      const i = cfg.icons?.find((ic) => ic.id === iid);
                      if (!i) return null;
                      const locked = i.locked === true;
                      const handlers = locked
                        ? { onDragMove: undefined, onDragEnd: undefined }
                        : makeDragHandlers(
                            `icon.${iid}`,
                            { x: i.x, y: i.y, w: i.size, h: i.size },
                            (x, y) => patchIcon(iid, { x, y }),
                          );
                      return (
                        <Text
                          key={id}
                          text={i.emoji}
                          x={i.x}
                          y={i.y}
                          fontSize={i.size}
                          opacity={i.opacity ?? 1}
                          rotation={i.rotation ?? 0}
                          draggable={!locked}
                          listening={!locked}
                          {...(handlers as any)}
                        />
                      );
                    }
                    if (id.startsWith('customText.')) {
                      const cid = id.slice('customText.'.length);
                      const t = cfg.customTexts?.find((x) => x.id === cid);
                      if (!t || t.hidden) return null;
                      const renderWidth = t.boxWidth ?? cfg.canvas.w;
                      const renderX = t.boxWidth != null ? t.x : 0;
                      const visualBox = estimateTextBox(t, cfg.canvas.w);
                      const handlers = t.locked
                        ? { onDragMove: undefined, onDragEnd: undefined }
                        : makeDragHandlers(
                            `customText.${cid}`,
                            visualBox,
                            (newVx, newVy) => {
                              const deltaX = newVx - visualBox.x;
                              const deltaY = newVy - visualBox.y;
                              const canMoveX =
                                t.boxWidth != null || t.align === 'left';
                              patchCustomText(cid, {
                                x: canMoveX ? t.x + deltaX : t.x,
                                y: t.y + deltaY,
                              });
                            },
                          );
                      return (
                        <Text
                          key={id}
                          text={t.text}
                          x={renderX}
                          y={t.y}
                          width={renderWidth}
                          fontFamily={t.font}
                          fontSize={t.size}
                          fontStyle={t.weight >= 700 ? 'bold' : 'normal'}
                          fill={t.color}
                          align={t.align}
                          lineHeight={t.lineHeight ?? 1.2}
                          letterSpacing={t.letterSpacing ?? 0}
                          opacity={t.opacity ?? 1}
                          rotation={t.rotation ?? 0}
                          shadowColor={t.shadow?.color}
                          shadowBlur={t.shadow?.blur ?? 0}
                          shadowOffsetX={t.shadow?.offsetX ?? 0}
                          shadowOffsetY={t.shadow?.offsetY ?? 0}
                          shadowOpacity={t.shadow?.opacity ?? (t.shadow ? 1 : 0)}
                          draggable={!t.locked}
                          listening={!t.locked}
                          {...(handlers as any)}
                        />
                      );
                    }
                    return null;
                  })}
                </Group>
                {/* Smart guides v2 — color por tipo de match. Verde
                 *  para canvas center (más informativo), fucsia para
                 *  alineación entre elementos, naranja para spacing
                 *  uniforme. Labels arriba en spacing. */}
                {guides.map((g, idx) => {
                  const color =
                    g.kind === 'canvasCenter'
                      ? '#10B981' // verde — más visible para center
                      : g.kind === 'spacing'
                      ? '#F59E0B' // amber para spacing
                      : '#EC4899'; // fucsia default
                  return (
                    <Group key={`g-${idx}`} listening={false}>
                      {g.type === 'v' ? (
                        <Line
                          points={[g.value, 0, g.value, cfg.canvas.h]}
                          stroke={color}
                          strokeWidth={1.5}
                          dash={[6, 4]}
                        />
                      ) : (
                        <Line
                          points={[0, g.value, cfg.canvas.w, g.value]}
                          stroke={color}
                          strokeWidth={1.5}
                          dash={[6, 4]}
                        />
                      )}
                      {g.label && (
                        <Text
                          text={g.label}
                          x={g.type === 'v' ? g.value + 8 : 8}
                          y={g.type === 'h' ? g.value - 18 : 8}
                          fontSize={14}
                          fontStyle="bold"
                          fill={color}
                          fontFamily="Inter, system-ui, sans-serif"
                        />
                      )}
                    </Group>
                  );
                })}
              </Layer>
            </Stage>
          </div>
          <div className="text-[11px] text-mute mt-3 text-center">
            Tamaño real: {cfg.canvas.w} × {cfg.canvas.h} px ·{' '}
            {cfg.canvas.mm?.w ?? 210}×{cfg.canvas.mm?.h ?? 297} mm ·{' '}
            {cfg.canvas.dpi ?? 300} DPI
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────── helpers UI ────────── //

/** Botón candado reutilizable. Cuando una capa está bloqueada, el editor
 *  desactiva drag/listening en el canvas — el cliente sigue editándola
 *  desde el sidebar pero ya no se mueve por accidente. */
function LockButton({
  locked,
  onToggle,
  className = '',
}: {
  locked: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`text-mute hover:text-ink text-xs px-1 ${className}`}
      title={locked ? 'Desbloquear (permitir mover)' : 'Bloquear (fijar posición)'}
      aria-label={locked ? 'Desbloquear' : 'Bloquear'}
    >
      {locked ? '🔒' : '🔓'}
    </button>
  );
}

/** Fila inline para bloquear/desbloquear una capa singleton (logo, texto
 *  fijo). Se renderiza adentro del Section content. */
function LockRow({
  locked,
  onToggle,
}: {
  locked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 bg-bg2/40 rounded px-2 py-1.5">
      <span className="text-[11px] text-mute">
        {locked ? 'Bloqueado: no se mueve al arrastrar' : 'Editable: se puede mover'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        className={`text-xs px-2 py-1 rounded-lg border-2 transition ${
          locked
            ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
            : 'border-line hover:border-mute'
        }`}
        title={locked ? 'Tocá para permitir mover' : 'Tocá para fijar posición'}
      >
        {locked ? '🔒 Bloqueado' : '🔓 Bloquear'}
      </button>
    </div>
  );
}

/** Botones visibles para alinear el TEXTO dentro de su caja. Reemplaza
 *  el dropdown — más obvio y consistente con Canva/Figma. Maneja
 *  TextLayer y CustomTextLayer (mismos campos relevantes). */
function TextAlignButtons({
  value,
  onChange,
}: {
  value: TextLayer['align'];
  onChange: (v: TextLayer['align']) => void;
}) {
  const opts: { v: TextLayer['align']; icon: string; title: string }[] = [
    { v: 'left', icon: '⯇', title: 'Alinear texto a la izquierda' },
    { v: 'center', icon: '≡', title: 'Centrar texto' },
    { v: 'right', icon: '⯈', title: 'Alinear texto a la derecha' },
    { v: 'justify', icon: '☰', title: 'Justificar texto' },
  ];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
        Alineación del texto
      </div>
      <div className="grid grid-cols-4 gap-1">
        {opts.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`text-sm py-1.5 rounded-lg border-2 transition ${
              value === o.v
                ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                : 'border-line hover:border-mute'
            }`}
            title={o.title}
          >
            {o.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Botones que alinean la posición de un texto al lienzo (página). Pega
 *  el texto a borde izq/der/sup/inf o lo centra exactamente. Para textos
 *  sin boxWidth, hori se mapea al `align` (la caja ocupa todo el ancho
 *  del canvas, así que mover x no cambia nada — lo que sí cambia es la
 *  alineación interna). */
function PageAlignButtons<T extends TextLayer>({
  layer,
  canvasW,
  canvasH,
  onPatch,
}: {
  layer: T;
  canvasW: number;
  canvasH: number;
  onPatch: (patch: Partial<T>) => void;
}) {
  const PAD = 40;
  function alignH(side: 'left' | 'center' | 'right'): Partial<T> {
    if (layer.boxWidth != null) {
      const bw = layer.boxWidth;
      if (side === 'left') return { x: PAD } as Partial<T>;
      if (side === 'right') return { x: Math.max(PAD, canvasW - bw - PAD) } as Partial<T>;
      return { x: Math.round((canvasW - bw) / 2) } as Partial<T>;
    }
    return { align: side } as Partial<T>;
  }
  function alignV(side: 'top' | 'middle' | 'bottom'): Partial<T> {
    const lines = (layer.text || ' ').split('\n').length;
    const totalH = Math.round(lines * layer.size * (layer.lineHeight ?? 1.2));
    if (side === 'top') return { y: PAD } as Partial<T>;
    if (side === 'bottom')
      return { y: Math.max(PAD, canvasH - totalH - PAD) } as Partial<T>;
    return { y: Math.max(0, Math.round((canvasH - totalH) / 2)) } as Partial<T>;
  }
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        Alinear en la página
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => onPatch(alignH('left'))}
          className="btn-ghost text-[10px] py-1.5"
          title="Pegar al borde izquierdo del lienzo"
        >
          ⇤ Izq.
        </button>
        <button
          type="button"
          onClick={() => onPatch(alignH('center'))}
          className="btn-ghost text-[10px] py-1.5"
          title="Centrar horizontalmente en el lienzo"
        >
          ↔ Centro
        </button>
        <button
          type="button"
          onClick={() => onPatch(alignH('right'))}
          className="btn-ghost text-[10px] py-1.5"
          title="Pegar al borde derecho del lienzo"
        >
          Der. ⇥
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => onPatch(alignV('top'))}
          className="btn-ghost text-[10px] py-1.5"
          title="Pegar al borde superior del lienzo"
        >
          ⇡ Arriba
        </button>
        <button
          type="button"
          onClick={() => onPatch(alignV('middle'))}
          className="btn-ghost text-[10px] py-1.5"
          title="Centrar verticalmente en el lienzo"
        >
          ↕ Medio
        </button>
        <button
          type="button"
          onClick={() => onPatch(alignV('bottom'))}
          className="btn-ghost text-[10px] py-1.5"
          title="Pegar al borde inferior del lienzo"
        >
          ⇣ Abajo
        </button>
      </div>
    </div>
  );
}

const LAYER_LABELS: Record<keyof QrPosterConfig['texts'], string> = {
  title: 'Título',
  subtitle: 'Subtítulo',
  cta: 'CTA',
  brand: 'Nombre del negocio',
};

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-bg2/40 transition"
      >
        {icon && <span className="text-base leading-none">{icon}</span>}
        <span className="text-[11px] uppercase tracking-wider text-mute font-semibold flex-1 text-left">
          {title}
        </span>
        <span className="text-mute text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-xs px-2 py-1.5 rounded-lg border-2 transition ${
        active
          ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
          : 'border-line hover:border-mute'
      }`}
    >
      {children}
    </button>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-mute flex-1">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-9 h-9 rounded border border-line cursor-pointer"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input text-xs w-[80px]"
      />
    </div>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-mute flex-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input text-xs w-[80px]"
      />
    </div>
  );
}

function OpacityRow({
  value,
  onChange,
  label = 'Opacidad',
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-mute w-[64px]">{label}</label>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-brand"
      />
      <span className="text-xs text-mute tabular-nums w-[32px] text-right">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function PositionRow({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center gap-1">
        <label className="text-xs text-mute">X</label>
        <input
          type="number"
          value={x}
          onChange={(e) => onChange(Number(e.target.value), y)}
          className="input text-xs flex-1"
        />
      </div>
      <div className="flex items-center gap-1">
        <label className="text-xs text-mute">Y</label>
        <input
          type="number"
          value={y}
          onChange={(e) => onChange(x, Number(e.target.value))}
          className="input text-xs flex-1"
        />
      </div>
    </div>
  );
}

function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-mute flex-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** FontPicker con optgroups por categoría. Pre-renderiza cada opción
 *  con su propio font-family para que el dueño "vea" el estilo. */
/** FontPicker visual — dropdown que renderea CADA fuente con su propia
 *  familia para que el cliente vea cómo se va a ver antes de elegir.
 *  Búsqueda + categorías + scroll. El <select> nativo solo permitía
 *  cambiar la familia del <option> via inline style pero muchos
 *  browsers ignoran el style en options dentro del menu (Safari/iOS),
 *  asi que reemplazamos por un menu custom controlado. */
function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const grouped = useMemo(() => {
    const out: Record<FontOption['category'], FontOption[]> = {
      sans: [],
      serif: [],
      display: [],
      handwriting: [],
      mono: [],
    };
    const query = q.trim().toLowerCase();
    for (const f of FONT_OPTIONS) {
      if (query && !f.label.toLowerCase().includes(query)) continue;
      out[f.category].push(f);
    }
    return out;
  }, [q]);

  const current = FONT_OPTIONS.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input text-sm w-full flex items-center justify-between gap-2 hover:border-brand/50"
        style={{ fontFamily: value }}
      >
        <span className="truncate">{current?.label ?? 'Fuente…'}</span>
        <span className="text-xs text-mute ml-auto">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-line rounded-input shadow-lg max-h-[320px] overflow-hidden flex flex-col">
          <div className="p-2 border-b border-line2">
            <input
              autoFocus
              type="text"
              placeholder="Buscar tipografía…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input text-sm"
            />
          </div>
          <div className="overflow-y-auto">
            {(Object.keys(grouped) as FontOption['category'][]).map((cat) => {
              if (grouped[cat].length === 0) return null;
              return (
                <div key={cat}>
                  <div className="text-[10px] uppercase tracking-wider text-mute font-semibold px-3 py-1 bg-bg2/50 sticky top-0">
                    {FONT_CATEGORY_LABELS[cat]}
                  </div>
                  {grouped[cat].map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setQ('');
                      }}
                      className={`w-full text-left px-3 py-2 hover:bg-bg2/60 border-b border-line2 last:border-b-0 ${
                        o.value === value ? 'bg-brand-soft/40' : ''
                      }`}
                      style={{ fontFamily: o.value }}
                    >
                      <div className="text-base leading-none">{o.label}</div>
                      <div
                        className="text-[10px] text-mute mt-0.5"
                        style={{ fontFamily: 'Inter, sans-serif' }}
                      >
                        Aa Bb 123 — {o.label}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
            {Object.values(grouped).every((g) => g.length === 0) && (
              <div className="text-sm text-mute text-center py-4">
                Sin resultados
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Indicador del estado de auto-save. Solo se renderea texto compacto
 *  (~24px alto) — mensajes claros sin ocupar espacio. */
function AutosaveStatus({
  state,
  savedAt,
  error,
}: {
  state: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  savedAt: number | null;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="text-[11px] text-red-600 leading-relaxed bg-red-50 border border-red-200 rounded px-2 py-1.5">
        ✕ {error}
      </div>
    );
  }
  if (state === 'saving') {
    return (
      <div className="text-[11px] text-mute font-medium flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        Guardando…
      </div>
    );
  }
  if (state === 'dirty') {
    return (
      <div className="text-[11px] text-mute italic">
        Cambios pendientes — se guardarán automáticamente
      </div>
    );
  }
  if (state === 'saved' && savedAt) {
    const secs = Math.round((Date.now() - savedAt) / 1000);
    return (
      <div className="text-[11px] text-emerald-600 font-semibold">
        ✓ Guardado{secs > 5 ? ` hace ${secs}s` : ''}
      </div>
    );
  }
  return null;
}

/** Textarea con auto-resize según el contenido. Reemplaza al <input>
 *  para que ENTER genere salto de línea (caso de uso típico: títulos
 *  largos o subtítulos multilínea). El value se persiste con "\n"
 *  literal y Konva.Text lo renderea como líneas separadas. */
function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    // Cap a 320px de alto. Si el cliente pega un texto enorme el
    // textarea no rompe el layout del sidebar — entra scroll interno.
    const target = Math.min(320, Math.max(32, el.scrollHeight));
    el.style.height = `${target}px`;
    el.style.overflowY = el.scrollHeight > 320 ? 'auto' : 'hidden';
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="input text-sm resize-none leading-snug py-1.5"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
    />
  );
}

/** Editor compacto de sombra de texto. Toggle on/off + sliders cuando
 *  está activa. Sirve para textos con fondos complejos (imagen) que
 *  necesitan contraste extra. */
function TextShadowEditor({
  shadow,
  onChange,
}: {
  shadow: TextLayer['shadow'] | null | undefined;
  onChange: (s: TextLayer['shadow'] | null) => void;
}) {
  const active = !!shadow;
  if (!active) {
    return (
      <button
        type="button"
        onClick={() =>
          onChange({
            color: '#000000',
            blur: 8,
            offsetX: 2,
            offsetY: 2,
            opacity: 0.5,
          })
        }
        className="w-full text-[11px] text-mute hover:text-ink border border-dashed border-line rounded py-1.5 transition"
      >
        + Agregar sombra
      </button>
    );
  }
  return (
    <div className="border border-line rounded p-2 bg-bg2/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold">Sombra</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-mute hover:text-red-500 text-xs"
        >
          ✕
        </button>
      </div>
      <ColorRow
        label="Color"
        value={shadow!.color}
        onChange={(v) => onChange({ ...shadow!, color: v })}
      />
      <NumberRow
        label="Blur"
        value={shadow!.blur}
        min={0}
        max={40}
        step={1}
        onChange={(v) => onChange({ ...shadow!, blur: v })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <NumberRow
          label="Off X"
          value={shadow!.offsetX}
          min={-30}
          max={30}
          step={1}
          onChange={(v) => onChange({ ...shadow!, offsetX: v })}
        />
        <NumberRow
          label="Off Y"
          value={shadow!.offsetY}
          min={-30}
          max={30}
          step={1}
          onChange={(v) => onChange({ ...shadow!, offsetY: v })}
        />
      </div>
      <OpacityRow
        value={shadow!.opacity ?? 1}
        onChange={(v) => onChange({ ...shadow!, opacity: v })}
      />
    </div>
  );
}

function ExportButton({
  label,
  hint,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex flex-col items-center justify-center rounded-lg border-2 py-2 text-xs font-semibold transition ${
        busy
          ? 'border-brand bg-brand-soft text-brand-700'
          : 'border-line hover:border-brand hover:bg-brand-soft hover:text-brand-700'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {busy ? '…' : label}
      <span className="text-[10px] text-mute font-normal mt-0.5">{hint}</span>
    </button>
  );
}

function ExportPanel({
  exporting,
  onExport,
  mm,
  dpi,
}: {
  exporting: 'png' | 'jpg' | 'pdf' | null;
  onExport: (k: 'png' | 'jpg' | 'pdf') => void;
  mm?: { w: number; h: number };
  dpi: number;
}) {
  return (
    <div className="card card-pad space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        Descargar
      </div>
      <div className="grid grid-cols-3 gap-2">
        <ExportButton
          label="PNG"
          hint="Imagen"
          busy={exporting === 'png'}
          disabled={!!exporting}
          onClick={() => onExport('png')}
        />
        <ExportButton
          label="JPG"
          hint="Liviano"
          busy={exporting === 'jpg'}
          disabled={!!exporting}
          onClick={() => onExport('jpg')}
        />
        <ExportButton
          label="PDF"
          hint="Imprenta"
          busy={exporting === 'pdf'}
          disabled={!!exporting}
          onClick={() => onExport('pdf')}
        />
      </div>
      <div className="text-[11px] text-mute leading-relaxed">
        {dpi} DPI sobre {mm?.w ?? 210}×{mm?.h ?? 297} mm.
      </div>
    </div>
  );
}

/** Label legible para cada LayerId en el panel "Capas". */
function layerLabel(id: LayerId, cfg: QrPosterConfig): string | null {
  if (id === 'bg') return 'Fondo';
  if (id === 'qr') return 'Código QR';
  if (id === 'logo') return cfg.logo ? 'Logo' : null;
  if (id === 'footer') return 'Pie "Powered by Clubify"';
  if (id === 'text.title') return `Título: ${cfg.texts.title.text || ''}`;
  if (id === 'text.subtitle') return `Subtítulo: ${cfg.texts.subtitle.text || ''}`;
  if (id === 'text.cta') return `CTA: ${cfg.texts.cta.text || ''}`;
  if (id === 'text.brand') return `Marca: ${cfg.texts.brand.text || ''}`;
  if (id.startsWith('shape.')) {
    const s = cfg.shapes?.find((sh) => sh.id === id.slice(6));
    if (!s) return null;
    const meta = {
      rect: { icon: '▭', label: 'Rectángulo' },
      circle: { icon: '●', label: 'Círculo' },
      roundedRect: { icon: '▢', label: 'Rect redondo' },
      capsule: { icon: '⬭', label: 'Pill' },
      star: { icon: '★', label: 'Estrella' },
      burst: { icon: '✺', label: 'Sticker' },
      blob: { icon: '🜲', label: 'Blob' },
    }[s.type];
    const preview = s.innerText?.text
      ? ` · "${s.innerText.text.split('\n')[0]}"`
      : '';
    return `${meta.icon} ${meta.label}${preview}`;
  }
  if (id.startsWith('icon.')) {
    const i = cfg.icons?.find((ic) => ic.id === id.slice(5));
    if (!i) return null;
    return `${i.emoji} Ícono`;
  }
  if (id.startsWith('image.')) {
    const im = cfg.images?.find((x) => x.id === id.slice(6));
    if (!im) return null;
    return '🖼️ Imagen';
  }
  if (id.startsWith('pattern.')) {
    const p = cfg.patterns?.find((x) => x.id === id.slice(8));
    if (!p) return null;
    return p.imageUrl ? '🖼️ Patrón (imagen)' : `${p.emojis.join('')} Patrón`;
  }
  if (id.startsWith('customText.')) {
    const t = cfg.customTexts?.find((x) => x.id === id.slice('customText.'.length));
    if (!t) return null;
    const preview = (t.text || '').split('\n')[0].slice(0, 32);
    return `🅣 ${preview || 'Texto'}${t.hidden ? ' · oculto' : ''}${t.locked ? ' · 🔒' : ''}`;
  }
  return null;
}

// ────────── Sub-componentes ────────── //

/** Panel de fondo con tres modos: sólido, gradiente, imagen. La imagen
 *  admite upload, zoom, posición, blur, overlay color + opacidad. */
function BackgroundSection({
  bg,
  onChange,
  setCfg,
}: {
  bg: BgConfig;
  onChange: (patch: Partial<BgConfig>) => void;
  setCfg: (updater: (c: QrPosterConfig) => QrPosterConfig) => void;
}) {
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    // Reset input siempre — sin esto, si el usuario rechaza una imagen
    // grande y vuelve a elegir EL MISMO archivo, el onChange no dispara
    // porque el value no cambió. Limpiando primero garantizamos retry.
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert(`La imagen es muy pesada. Máx ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      setCfg((c) => ({
        ...c,
        bg: {
          type: 'image',
          url,
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
          blur: 0,
          overlayColor: null,
          overlayOpacity: 0.3,
          opacity: 1,
        },
      }));
    };
    reader.readAsDataURL(file);
  }

  return (
    <Section title="Fondo" icon="🎨">
      <div className="grid grid-cols-3 gap-1.5">
        <Toggle
          active={bg.type === 'solid'}
          onClick={() => {
            const color1 =
              bg.type === 'solid' || bg.type === 'gradient' ? bg.color1 : '#FFFFFF';
            setCfg((c) => ({ ...c, bg: { type: 'solid', color1 } }));
          }}
        >
          Sólido
        </Toggle>
        <Toggle
          active={bg.type === 'gradient'}
          onClick={() => {
            const color1 =
              bg.type === 'solid' || bg.type === 'gradient' ? bg.color1 : '#FFFFFF';
            setCfg((c) => ({
              ...c,
              bg: { type: 'gradient', color1, color2: '#4ADE80', angle: 135 },
            }));
          }}
        >
          Gradiente
        </Toggle>
        <Toggle
          active={bg.type === 'image'}
          onClick={() => {
            // Si no hay imagen aún, solo cambiamos al modo y esperamos que
            // el usuario suba una. Si ya hay, no la sobrescribimos.
            if (bg.type === 'image') return;
            // Trigger file input desde label
            document.getElementById('bg-image-upload')?.click();
          }}
        >
          Imagen
        </Toggle>
      </div>

      {(bg.type === 'solid' || bg.type === 'gradient') && (
        <ColorRow label="Color 1" value={bg.color1} onChange={(v) => onChange({ color1: v })} />
      )}
      {bg.type === 'gradient' && (
        <>
          <ColorRow
            label="Color 2"
            value={bg.color2}
            onChange={(v) => onChange({ color2: v })}
          />
          <div>
            <label className="text-xs text-mute">Tipo de gradiente</label>
            <div className="grid grid-cols-3 gap-1.5 mt-1">
              {(
                [
                  { v: 'linear' as const, label: '⟶ Linear' },
                  { v: 'radial' as const, label: '◯ Radial' },
                  { v: 'diagonal' as const, label: '⤢ Diagonal' },
                ] as const
              ).map((opt) => {
                const active = (bg.subtype ?? 'linear') === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => onChange({ subtype: opt.v })}
                    className={`text-[10px] py-1.5 rounded border-2 transition ${
                      active
                        ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                        : 'border-line hover:border-mute'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          {(bg.subtype ?? 'linear') === 'linear' && (
            <NumberRow
              label="Ángulo"
              value={bg.angle}
              min={0}
              max={360}
              step={5}
              onChange={(v) => onChange({ angle: v })}
            />
          )}
          {/* Mini preview del gradiente. Para radial usamos ellipse
              farthest-corner para que el preview matchee al export
              Konva (que usa radio = diagonal/2 — cubre hasta las
              esquinas). El `circle` antes daba un look muy distinto
              cuando el canvas no era cuadrado. */}
          <div
            className="rounded-lg border border-line h-12 mt-1"
            style={{
              background:
                (bg.subtype ?? 'linear') === 'radial'
                  ? `radial-gradient(ellipse farthest-corner at center, ${bg.color1}, ${bg.color2})`
                  : `linear-gradient(${
                      (bg.subtype === 'diagonal' ? 135 : bg.angle) ?? 135
                    }deg, ${bg.color1}, ${bg.color2})`,
            }}
          />
        </>
      )}
      {(bg.type === 'solid' || bg.type === 'gradient') && (
        <OpacityRow value={bg.opacity ?? 1} onChange={(v) => onChange({ opacity: v })} />
      )}

      {bg.type === 'image' && (
        <>
          <div className="flex gap-2">
            <label
              htmlFor="bg-image-upload"
              className="btn-ghost text-xs flex-1 text-center cursor-pointer"
            >
              Cambiar imagen
            </label>
            <button
              type="button"
              onClick={() => setCfg((c) => ({ ...c, bg: { type: 'solid', color1: '#FFFFFF' } }))}
              className="btn-ghost text-xs"
              title="Quitar imagen"
            >
              ✕
            </button>
          </div>
          <OpacityRow value={bg.opacity ?? 1} onChange={(v) => onChange({ opacity: v })} />
          <NumberRow
            label="Zoom"
            value={bg.zoom ?? 1}
            min={0.5}
            max={3}
            step={0.05}
            onChange={(v) => onChange({ zoom: v })}
          />
          <PositionRow
            x={bg.offsetX ?? 0}
            y={bg.offsetY ?? 0}
            onChange={(x, y) => onChange({ offsetX: x, offsetY: y })}
          />
          <NumberRow
            label="Blur"
            value={bg.blur ?? 0}
            min={0}
            max={40}
            step={1}
            onChange={(v) => onChange({ blur: v })}
          />
          <div className="pt-1 border-t border-line">
            <div className="text-[10px] text-mute mb-1">Overlay encima de la imagen</div>
            <ColorRow
              label="Color overlay"
              value={bg.overlayColor ?? '#000000'}
              onChange={(v) => onChange({ overlayColor: v })}
            />
            <OpacityRow
              label="Opacidad"
              value={bg.overlayOpacity ?? 0.3}
              onChange={(v) => onChange({ overlayOpacity: v })}
            />
            <button
              type="button"
              onClick={() => onChange({ overlayColor: null })}
              className="text-[10px] text-mute hover:text-ink mt-1"
            >
              Quitar overlay
            </button>
          </div>
        </>
      )}
      <input
        id="bg-image-upload"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleUpload}
        className="hidden"
      />
    </Section>
  );
}

/** Sección de tamaño de lienzo: presets + tamaño custom (mm) + DPI. */
function CanvasSection({
  cfg,
  setCfg,
}: {
  cfg: QrPosterConfig;
  setCfg: (updater: (c: QrPosterConfig) => QrPosterConfig) => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customMmW, setCustomMmW] = useState(cfg.canvas.mm?.w ?? 210);
  const [customMmH, setCustomMmH] = useState(cfg.canvas.mm?.h ?? 297);

  function applyCustom() {
    // Px del canvas = aspect ratio del mm * 1080 base
    const aspect = customMmW / customMmH;
    const w = aspect >= 1 ? 1528 : 1080;
    const h = Math.round(w / aspect);
    setCfg((c) => ({
      ...rescaleForCanvas(c, {
        w,
        h,
        mm: { w: customMmW, h: customMmH },
        dpi: c.canvas.dpi,
      }),
      clipShape: undefined,
    }));
    setCustomMode(false);
  }

  /** Toggle orientación: swap w↔h del canvas (px y mm) y reusar el
   *  reescalado existente para que TODOS los elementos se ajusten
   *  proporcionalmente. Soluciona el caso "diseñé vertical y ahora
   *  necesito horizontal" sin tener que recrear todo. */
  /** Swap orientación: cambia w↔h del canvas + CLAMPEA posiciones de
   *  todos los elementos al nuevo bbox. Sizes preservados (no deforma).
   *
   *  Sin clamp un texto en y=1400 (canvas vertical 1080×1528) quedaba
   *  invisible al swap a 1528×1080 porque y=1400 > newH=1080. El
   *  cliente clickea "Horizontal" y "pierde" elementos.
   *
   *  Antes con rescaleForCanvas se escalaba anisotrópicamente (sx≠sy)
   *  y deformaba aspect (200×200 → 283×141). Ahora preservamos tamaños
   *  pero garantizamos visibilidad. */
  function swapOrientation() {
    setCfg((c) => {
      const newW = c.canvas.h;
      const newH = c.canvas.w;
      const cx = (x: number, w = 0) => Math.max(0, Math.min(newW - w, x));
      const cy = (y: number, h = 0) => Math.max(0, Math.min(newH - h, y));
      return {
        ...c,
        canvas: {
          ...c.canvas,
          w: newW,
          h: newH,
          mm: c.canvas.mm
            ? { w: c.canvas.mm.h, h: c.canvas.mm.w }
            : c.canvas.mm,
        },
        qr: {
          ...c.qr,
          x: cx(c.qr.x, c.qr.size),
          y: cy(c.qr.y, c.qr.size),
        },
        logo: c.logo
          ? { ...c.logo, x: cx(c.logo.x, c.logo.size), y: cy(c.logo.y, c.logo.size) }
          : c.logo,
        texts: {
          title: { ...c.texts.title, x: cx(c.texts.title.x), y: cy(c.texts.title.y, c.texts.title.size) },
          subtitle: { ...c.texts.subtitle, x: cx(c.texts.subtitle.x), y: cy(c.texts.subtitle.y, c.texts.subtitle.size) },
          cta: { ...c.texts.cta, x: cx(c.texts.cta.x), y: cy(c.texts.cta.y, c.texts.cta.size) },
          brand: { ...c.texts.brand, x: cx(c.texts.brand.x), y: cy(c.texts.brand.y, c.texts.brand.size) },
        },
        shapes: (c.shapes ?? []).map((s) => ({
          ...s,
          x: cx(s.x, s.w),
          y: cy(s.y, s.h),
        })),
        icons: (c.icons ?? []).map((i) => ({
          ...i,
          x: cx(i.x, i.size),
          y: cy(i.y, i.size),
        })),
        images: (c.images ?? []).map((im) => ({
          ...im,
          x: cx(im.x, im.w),
          y: cy(im.y, im.h),
        })),
        customTexts: (c.customTexts ?? []).map((t) => ({
          ...t,
          x: cx(t.x, t.boxWidth ?? 0),
          y: cy(t.y, t.size),
        })),
        clipShape: c.clipShape,
      };
    });
  }

  const isLandscape = cfg.canvas.w > cfg.canvas.h;
  const isSquare = cfg.canvas.w === cfg.canvas.h;

  return (
    <Section title="Tamaño y resolución" icon="📐">
      {/* Toggle Horizontal / Vertical — solo aplica si el canvas no
          es cuadrado/circular. Para esos casos w === h y el swap no
          hace nada, así que ocultamos para no confundir. */}
      {!isSquare && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (isLandscape) swapOrientation();
            }}
            className={`flex-1 text-xs py-2 rounded-lg border-2 transition ${
              !isLandscape
                ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                : 'border-line hover:border-mute'
            }`}
            title="Lienzo vertical (portrait)"
          >
            ▯ Vertical
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isLandscape) swapOrientation();
            }}
            className={`flex-1 text-xs py-2 rounded-lg border-2 transition ${
              isLandscape
                ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                : 'border-line hover:border-mute'
            }`}
            title="Lienzo horizontal (landscape)"
          >
            ▭ Horizontal
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {CANVAS_PRESETS.map((p) => {
          const isCircular = p.label.startsWith('Circular');
          const active =
            cfg.canvas.w === p.w &&
            cfg.canvas.h === p.h &&
            cfg.canvas.mm?.w === p.mm.w &&
            cfg.canvas.mm?.h === p.mm.h &&
            (isCircular ? cfg.clipShape === 'circle' : !cfg.clipShape);
          return (
            <button
              key={p.label}
              onClick={() =>
                setCfg((c) => ({
                  ...rescaleForCanvas(c, { w: p.w, h: p.h, mm: p.mm, dpi: c.canvas.dpi }),
                  clipShape: isCircular ? 'circle' : undefined,
                }))
              }
              className={`text-xs px-2 py-2 rounded-lg border-2 transition ${
                active
                  ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                  : 'border-line hover:border-mute'
              }`}
            >
              {p.label}
              <div className="text-[10px] text-mute mt-0.5">
                {p.mm.w}×{p.mm.h} mm
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setCustomMode((v) => !v)}
        className="w-full mt-2 text-xs px-2 py-2 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
      >
        {customMode ? '✕ Cerrar' : '+ Tamaño personalizado'}
      </button>
      {customMode && (
        <div className="border border-line rounded p-2 space-y-2 bg-bg2/30">
          <NumberRow
            label="Ancho (mm)"
            value={customMmW}
            min={10}
            max={2000}
            step={1}
            onChange={setCustomMmW}
          />
          <NumberRow
            label="Alto (mm)"
            value={customMmH}
            min={10}
            max={2000}
            step={1}
            onChange={setCustomMmH}
          />
          <button
            type="button"
            onClick={applyCustom}
            className="btn-primary w-full text-xs"
          >
            Aplicar tamaño
          </button>
        </div>
      )}

      <div className="pt-2 border-t border-line">
        <SelectRow
          label="DPI"
          value={String(cfg.canvas.dpi ?? 300)}
          options={[
            { label: '150 (Borrador)', value: '150' },
            { label: '300 (Imprenta estándar)', value: '300' },
            { label: '450 (Alta calidad)', value: '450' },
            { label: '600 (Vinilo / fotografía)', value: '600' },
          ]}
          onChange={(v) =>
            setCfg((c) => ({ ...c, canvas: { ...c.canvas, dpi: Number(v) } }))
          }
        />
        <div className="text-[10px] text-mute mt-1 leading-relaxed">
          Mayor DPI = archivo más pesado, mejor calidad al imprimir grande.
        </div>
      </div>
    </Section>
  );
}

/** Render del background image como capa Konva separada, con blur
 *  opcional aplicado via Konva.Filters.Blur. cache() debe llamarse
 *  cada vez que cambian width/height/blur/image para que el filtro
 *  se aplique correctamente. */
/** Genera un Konva SVG path string para un blob orgánico. Usa
 *  Catmull-Rom approximation con N puntos en círculo, cada uno con
 *  jitter radial determinístico (mulberry32 con seed). Resultado:
 *  forma "burbuja" suave que parece dibujada a mano. */
function generateBlobPath(
  w: number,
  h: number,
  seed: number,
): string {
  const rand = mulberry32(seed);
  const cx = w / 2;
  const cy = h / 2;
  const n = 8;
  const baseR = Math.min(w, h) / 2;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const r = baseR * (0.75 + rand() * 0.45);
    points.push({
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
  }
  // Bezier quadratic conectando los puntos para que las curvas sean
  // suaves — el control point es el midpoint del siguiente segmento.
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const cur = points[i];
    const next = points[(i + 1) % n];
    const midX = (cur.x + next.x) / 2;
    const midY = (cur.y + next.y) / 2;
    d += ` Q ${cur.x.toFixed(1)} ${cur.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  d += ' Z';
  return d;
}

/** Render unificado de TODAS las formas (rect/circle/roundedRect/
 *  capsule/star/burst/blob) + innerText opcional centrado. Maneja
 *  drag con snap + gradiente alternativo al fill sólido. */
function ShapeView({
  shape: s,
  cfg,
  onPatch,
  setGuides,
  gatherSnapTargets,
  computeSnap,
}: {
  shape: ShapeLayer;
  cfg: QrPosterConfig;
  onPatch: (patch: Partial<ShapeLayer>) => void;
  setGuides: (g: Guide[]) => void;
  gatherSnapTargets: (cfg: QrPosterConfig) => any[];
  computeSnap: any;
}) {
  // Gradient props si gradientFill está activo, sino fill sólido.
  const fillProps = useMemo(() => {
    if (!s.gradientFill) return { fill: s.fill };
    const g = s.gradientFill;
    if (g.angle === 'radial') {
      return {
        fillRadialGradientStartPoint: { x: s.w / 2, y: s.h / 2 },
        fillRadialGradientStartRadius: 0,
        fillRadialGradientEndPoint: { x: s.w / 2, y: s.h / 2 },
        fillRadialGradientEndRadius: Math.sqrt(s.w * s.w + s.h * s.h) / 2,
        fillRadialGradientColorStops: [0, g.color1, 1, g.color2],
      };
    }
    const rad = ((g.angle as number) * Math.PI) / 180;
    const len = Math.max(s.w, s.h);
    return {
      fillLinearGradientStartPoint: {
        x: s.w / 2 - (Math.cos(rad) * len) / 2,
        y: s.h / 2 - (Math.sin(rad) * len) / 2,
      },
      fillLinearGradientEndPoint: {
        x: s.w / 2 + (Math.cos(rad) * len) / 2,
        y: s.h / 2 + (Math.sin(rad) * len) / 2,
      },
      fillLinearGradientColorStops: [0, g.color1, 1, g.color2],
    };
  }, [s.gradientFill, s.fill, s.w, s.h]);

  // Rotation se aplica al <Group> wrapper (no a cada shape individual)
  // para que el innerText rote JUNTO con la forma. Sino el burst con
  // rotation=-8 dejaba la estrella inclinada y el "10% off" recto.
  const common = {
    opacity: s.opacity ?? 1,
    stroke: s.stroke,
    strokeWidth: s.strokeWidth ?? 0,
    ...fillProps,
  };

  // Group anclado en el CENTRO (cx, cy) con offset = (w/2, h/2). Esto
  // permite que rotation pivote desde el centro de la forma (como en
  // Canva/Figma) en vez del top-left. El drag se ajusta para convertir
  // de center a top-left al persistir s.x/s.y.
  const onDragMove = (e: any) => {
    const node = e.target;
    // node.x()/y() es el CENTRO. Convertimos a top-left para snap.
    const tlX = node.x() - s.w / 2;
    const tlY = node.y() - s.h / 2;
    const newBox = { x: tlX, y: tlY, w: s.w, h: s.h };
    const others = gatherSnapTargets(cfg);
    const snap = computeSnap(newBox, others, cfg.canvas.w, cfg.canvas.h, `shape.${s.id}`);
    if (snap.x !== newBox.x) node.x(snap.x + s.w / 2);
    if (snap.y !== newBox.y) node.y(snap.y + s.h / 2);
    setGuides(snap.guides);
  };
  const onDragEnd = (e: any) => {
    onPatch({
      x: e.target.x() - s.w / 2,
      y: e.target.y() - s.h / 2,
    });
    setGuides([]);
  };

  let shapeNode: React.ReactNode = null;
  if (s.type === 'rect') {
    shapeNode = (
      <Rect
        x={0}
        y={0}
        width={s.w}
        height={s.h}
        cornerRadius={s.borderRadius ?? 0}
        {...common}
      />
    );
  } else if (s.type === 'roundedRect') {
    shapeNode = (
      <Rect
        x={0}
        y={0}
        width={s.w}
        height={s.h}
        cornerRadius={s.borderRadius ?? 24}
        {...common}
      />
    );
  } else if (s.type === 'capsule') {
    // Pill: cornerRadius = min(w,h) / 2 → totalmente redondeada en el
    // lado corto. Si w === h, queda círculo perfecto.
    shapeNode = (
      <Rect
        x={0}
        y={0}
        width={s.w}
        height={s.h}
        cornerRadius={Math.min(s.w, s.h) / 2}
        {...common}
      />
    );
  } else if (s.type === 'circle') {
    shapeNode = (
      <Circle
        x={s.w / 2}
        y={s.w / 2}
        radius={s.w / 2}
        {...common}
      />
    );
  } else if (s.type === 'star') {
    const numPoints = s.points ?? 5;
    const outerR = Math.min(s.w, s.h) / 2;
    const innerR = outerR * (s.innerRadiusFactor ?? 0.5);
    shapeNode = (
      <Star
        x={s.w / 2}
        y={s.h / 2}
        numPoints={numPoints}
        innerRadius={innerR}
        outerRadius={outerR}
        {...common}
      />
    );
  } else if (s.type === 'burst') {
    // Burst = sun/star de muchas puntas finas. Default 16 puntas con
    // innerRadius alto (0.85 del outer) → puntas cortitas tipo
    // explosión promocional como el sticker "10% off" de Nudo Cookie.
    const numPoints = s.points ?? 16;
    const outerR = Math.min(s.w, s.h) / 2;
    const innerR = outerR * (s.innerRadiusFactor ?? 0.85);
    shapeNode = (
      <Star
        x={s.w / 2}
        y={s.h / 2}
        numPoints={numPoints}
        innerRadius={innerR}
        outerRadius={outerR}
        {...common}
      />
    );
  } else if (s.type === 'blob') {
    const path = generateBlobPath(s.w, s.h, s.seed ?? 12345);
    shapeNode = <Path data={path} {...common} />;
  }

  // Inner text — centrado VERTICAL real en el bbox de la forma.
  // Calculamos la altura total considerando líneas (split por \n) +
  // lineHeight. Sin esto el "10%\noff" del Nudo burst queda corrido
  // hacia arriba porque solo se restaba la altura de 1 línea.
  let textNode: React.ReactNode = null;
  if (s.innerText) {
    const lines = s.innerText.text.split('\n').length;
    const lh = s.innerText.lineHeight ?? 1;
    const totalTextH = lines * s.innerText.size * lh;
    textNode = (
      <Text
        text={s.innerText.text}
        x={0}
        y={s.h / 2 - totalTextH / 2}
        width={s.w}
        align="center"
        fontFamily={s.innerText.font ?? 'Inter, system-ui, sans-serif'}
        fontSize={s.innerText.size}
        fontStyle={(s.innerText.weight ?? 700) >= 700 ? 'bold' : 'normal'}
        fill={s.innerText.color}
        lineHeight={lh}
        listening={false}
        opacity={s.opacity ?? 1}
      />
    );
  }

  // Pivote desde el centro: Group posicionado en (cx, cy) con
  // offsetX/Y = (w/2, h/2). Las coords internas siguen siendo top-left
  // (shape draws at 0,0 to w,h). Rotation aplicada al Group rota TODO
  // (shape + innerText juntos) pivoteando desde el centro visual.
  const locked = s.locked === true;
  return (
    <Group
      x={s.x + s.w / 2}
      y={s.y + s.h / 2}
      offsetX={s.w / 2}
      offsetY={s.h / 2}
      rotation={s.rotation ?? 0}
      draggable={!locked}
      listening={!locked}
      onDragMove={locked ? undefined : onDragMove}
      onDragEnd={locked ? undefined : onDragEnd}
    >
      {shapeNode}
      {textNode}
    </Group>
  );
}

function BgImageView({
  image,
  x,
  y,
  w,
  h,
  opacity,
  blur,
}: {
  image: HTMLImageElement;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  blur: number;
}) {
  const nodeRef = useRef<Konva.Image | null>(null);
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (blur > 0) {
      // Esperar a que la imagen tenga dimensiones cargadas (image.complete)
      // antes de cachear. Sino el cache captura un frame vacío y el blur
      // queda aplicado a "nada" hasta que el siguiente re-render lo
      // corrija. Si todavía no cargó, defer al onload.
      const applyBlur = () => {
        node.cache();
        node.filters([Konva.Filters.Blur]);
        node.blurRadius(blur);
        node.getLayer()?.batchDraw();
      };
      if (image.complete && image.naturalWidth > 0) {
        applyBlur();
      } else {
        image.addEventListener('load', applyBlur, { once: true });
        return () => image.removeEventListener('load', applyBlur);
      }
    } else {
      node.clearCache();
      node.filters([]);
      node.getLayer()?.batchDraw();
    }
  }, [blur, w, h, image]);
  return (
    <KonvaImage
      ref={nodeRef as any}
      image={image}
      x={x}
      y={y}
      width={w}
      height={h}
      opacity={opacity}
      listening={false}
    />
  );
}

/** Render de un ImageLayer libre. Maneja carga async de la URL +
 *  los 3 modos de ajuste (fit): cover/contain/fill. */
function ImageLayerView({
  layer,
  makeHandlers,
  onMove,
}: {
  layer: ImageLayer;
  makeHandlers: (
    box: { x: number; y: number; w: number; h: number },
    onUpdate: (x: number, y: number) => void,
  ) => { onDragMove: any; onDragEnd: any };
  onMove: (x: number, y: number) => void;
}) {
  const img = useImageFromUrl(layer.url);
  if (!img) return null;
  const rotation = layer.rotation ?? 0;
  const locked = layer.locked === true;
  const cropProp = layer.crop
    ? {
        x: layer.crop.x,
        y: layer.crop.y,
        width: layer.crop.width,
        height: layer.crop.height,
      }
    : undefined;

  // Fit mode → calcula dims internas + offset dentro del bounding rect
  // (layer.w × layer.h). El RECT externo NO cambia (sigue siendo la
  // hitbox para drag/snap/transform); solo cambia cómo se dibuja la
  // imagen ADENTRO. Para 'cover' usamos clipFunc para recortar el
  // overflow; para 'contain' la imagen entera entra dejando bandas; para
  // 'fill' (default actual) la imagen se estira al rect.
  const fit = layer.fit ?? 'fill';
  const sourceW = layer.crop ? layer.crop.width : img.naturalWidth || layer.w;
  const sourceH = layer.crop ? layer.crop.height : img.naturalHeight || layer.h;
  const sourceAspect = sourceW / sourceH;
  const rectAspect = layer.w / layer.h;
  let innerW = layer.w;
  let innerH = layer.h;
  let innerX = 0;
  let innerY = 0;
  if (fit === 'cover') {
    if (sourceAspect > rectAspect) {
      innerH = layer.h;
      innerW = innerH * sourceAspect;
      innerX = -(innerW - layer.w) / 2;
    } else {
      innerW = layer.w;
      innerH = innerW / sourceAspect;
      innerY = -(innerH - layer.h) / 2;
    }
  } else if (fit === 'contain') {
    if (sourceAspect > rectAspect) {
      innerW = layer.w;
      innerH = innerW / sourceAspect;
      innerY = (layer.h - innerH) / 2;
    } else {
      innerH = layer.h;
      innerW = innerH * sourceAspect;
      innerX = (layer.w - innerW) / 2;
    }
  }

  // Konva.Image acepta offsetX/Y directamente. Cuando rotation=0 el
  // offset no afecta la posición visual; cuando rotation>0 hace que
  // pivote desde el centro (estándar Canva/Figma).
  // x/y representan dónde queda el PIVOTE; el render arranca en
  // (x - offsetX, y - offsetY) = top-left original (layer.x, layer.y).
  const handlers = locked
    ? { onDragMove: undefined as any, onDragEnd: undefined as any }
    : makeHandlers(
        { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
        onMove,
      );

  // Drag handlers ajustados: como x/y son centro (cuando hay offset),
  // convertimos a/desde top-left para mantener compatibilidad con
  // gatherSnapTargets (que usa top-left).
  const wrappedHandlers = locked
    ? { onDragMove: undefined, onDragEnd: undefined }
    : {
        onDragMove: (e: any) => {
          const node = e.target;
          const tlX = node.x() - layer.w / 2;
          const tlY = node.y() - layer.h / 2;
          const shim = {
            target: {
              x: (v?: number) => {
                if (v !== undefined) node.x(v + layer.w / 2);
                return tlX;
              },
              y: (v?: number) => {
                if (v !== undefined) node.y(v + layer.h / 2);
                return tlY;
              },
            },
          };
          handlers.onDragMove(shim as any);
        },
        onDragEnd: (e: any) => {
          // El node.x()/y() es el CENTRO (por offsetX/Y); convertimos a
          // top-left para persistir y para que el handler original llame
          // onUpdate(tlX, tlY) en vez de onUpdate(0,0) — bug histórico
          // que tiraba la imagen a la esquina al soltar el drag.
          const tlX = e.target.x() - layer.w / 2;
          const tlY = e.target.y() - layer.h / 2;
          handlers.onDragEnd({
            target: { x: () => tlX, y: () => tlY },
          } as any);
        },
      };

  // Si fit === 'fill' (default histórico), render directo sin wrapper —
  // mantiene compat con configs viejas + minimiza overhead. Para
  // cover/contain envolvemos en Group con clipFunc (cover) o sin él
  // (contain), y dibujamos la imagen con dims internas calculadas.
  if (fit === 'fill') {
    return (
      <KonvaImage
        image={img}
        x={layer.x + layer.w / 2}
        y={layer.y + layer.h / 2}
        offsetX={layer.w / 2}
        offsetY={layer.h / 2}
        width={layer.w}
        height={layer.h}
        opacity={layer.opacity ?? 1}
        rotation={rotation}
        crop={cropProp}
        draggable={!locked}
        listening={!locked}
        {...(wrappedHandlers as any)}
      />
    );
  }

  return (
    <Group
      x={layer.x + layer.w / 2}
      y={layer.y + layer.h / 2}
      offsetX={layer.w / 2}
      offsetY={layer.h / 2}
      rotation={rotation}
      opacity={layer.opacity ?? 1}
      draggable={!locked}
      listening={!locked}
      // En cover, recortamos al rect lógico para que la imagen "más
      // grande" no desborde. En contain no clipeamos — la imagen ya entra
      // entera por construcción y dejar bandas es el resultado deseado.
      clipFunc={
        fit === 'cover'
          ? (ctx) => {
              ctx.beginPath();
              ctx.rect(0, 0, layer.w, layer.h);
              ctx.closePath();
            }
          : undefined
      }
      {...(wrappedHandlers as any)}
    >
      <KonvaImage
        image={img}
        x={innerX}
        y={innerY}
        width={innerW}
        height={innerH}
        crop={cropProp}
        listening={false}
      />
    </Group>
  );
}

/** Render de un PatternLayer — Konva.Group con tiles de Konva.Text
 *  (emojis) distribuidos en grid. La densidad usa PRNG determinístico
 *  para que el patrón sea estable. */
function PatternLayerView({
  layer,
  canvasW,
  canvasH,
}: {
  layer: PatternLayer;
  canvasW: number;
  canvasH: number;
}) {
  // Si el patrón usa una imagen como tile (PNG/SVG subido), cargamos
  // la imagen aquí. Si no, queda null y caemos al render con emojis.
  const tileImg = useImageFromUrl(layer.imageUrl ?? null);
  const useImage = !!layer.imageUrl && !!tileImg;

  const cells = useMemo(() => {
    const fullCanvas = layer.fullCanvas !== false;
    const areaX = fullCanvas ? 0 : layer.x ?? 0;
    const areaY = fullCanvas ? 0 : layer.y ?? 0;
    const areaW = fullCanvas ? canvasW : layer.w ?? canvasW;
    const areaH = fullCanvas ? canvasH : layer.h ?? canvasH;
    const step = layer.size + layer.gap;
    const rand = mulberry32(layer.seed ?? 12345);
    const out: { x: number; y: number; emoji: string; rot: number }[] = [];
    let i = 0;
    for (let y = areaY; y < areaY + areaH; y += step) {
      for (let x = areaX; x < areaX + areaW; x += step) {
        const r = rand();
        if (r > layer.density) {
          i++;
          continue;
        }
        const emoji = layer.emojis[i % Math.max(1, layer.emojis.length)] ?? '';
        out.push({ x, y, emoji, rot: layer.rotation });
        i++;
      }
    }
    return out;
  }, [layer, canvasW, canvasH]);

  return (
    <Group opacity={layer.opacity} listening={false}>
      {cells.map((c, idx) =>
        useImage ? (
          // Tile = imagen subida. Pivote desde centro para que la
          // rotación se vea natural (igual que emojis con offsetX/Y).
          <KonvaImage
            key={idx}
            image={tileImg as HTMLImageElement}
            x={c.x + layer.size / 2}
            y={c.y + layer.size / 2}
            offsetX={layer.size / 2}
            offsetY={layer.size / 2}
            width={layer.size}
            height={layer.size}
            rotation={c.rot}
          />
        ) : (
          <Text
            key={idx}
            text={c.emoji}
            x={c.x}
            y={c.y}
            fontSize={layer.size}
            rotation={c.rot}
          />
        ),
      )}
    </Group>
  );
}

/** Upload + lista de imágenes libres. Reemplaza la sección "Formas". */
function ImagesSection({
  images,
  onAdd,
  onPatch,
  onRemove,
  canvasW,
  canvasH,
}: {
  images: ImageLayer[];
  onAdd: (dataUrl: string, w: number, h: number) => void;
  onPatch: (id: string, patch: Partial<ImageLayer>) => void;
  onRemove: (id: string) => void;
  canvasW: number;
  canvasH: number;
}) {
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    // Reset siempre — ver comentario en BackgroundSection.handleUpload.
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert(`La imagen es muy pesada. Máx ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      // Para conocer dimensiones reales antes de agregar el layer
      const img = new window.Image();
      img.onload = () => onAdd(dataUrl, img.naturalWidth, img.naturalHeight);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  const [loadingBadgeId, setLoadingBadgeId] = useState<string | null>(null);

  async function addBadge(badge: WalletBadge) {
    // Bloquea doble-click: si ya hay un badge cargando (cualquiera),
    // ignoramos clicks subsecuentes. Sin esto, el await deja una
    // ventana donde el usuario clickeó dos veces rápido se agregan 2.
    if (loadingBadgeId) return;
    setLoadingBadgeId(badge.id);
    try {
      const dataUrl = await loadBadgeAsDataUrl(badge);
      if (!dataUrl) {
        alert(`No se pudo cargar el badge ${badge.label}.`);
        return;
      }
      // Escalamos a 28% del ancho del canvas — los badges nativos
      // (100-240px) son invisibles en un canvas de 1080+.
      const targetW = canvasW * 0.28;
      const scale = targetW / badge.width;
      onAdd(dataUrl, targetW, badge.height * scale);
    } finally {
      setLoadingBadgeId(null);
    }
  }

  const badgeEntries: Array<{ key: string; badge: WalletBadge }> = [
    { key: 'appleEs', badge: WALLET_BADGES.appleEs },
    { key: 'googleEs', badge: WALLET_BADGES.googleEs },
    { key: 'applePay', badge: WALLET_BADGES.applePay },
    { key: 'googlePay', badge: WALLET_BADGES.googlePay },
  ];

  return (
    <Section title="Imágenes" icon="🖼️" defaultOpen={images.length > 0}>
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          Badges Wallet & Pay
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {badgeEntries.map(({ key, badge }) => {
            const isLoading = loadingBadgeId === badge.id;
            const isDisabled = loadingBadgeId !== null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => addBadge(badge)}
                disabled={isDisabled}
                className={`rounded-lg border bg-white p-2 transition flex items-center justify-center min-h-[44px] ${
                  isDisabled
                    ? 'border-line opacity-50 cursor-wait'
                    : 'border-line hover:border-brand'
                }`}
                title={`Agregar ${badge.label}`}
              >
                {isLoading ? (
                  <span className="text-[10px] text-mute">cargando…</span>
                ) : (
                  <img
                    src={badge.src}
                    alt={badge.label}
                    className="w-full h-auto max-h-7 object-contain"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <label
        htmlFor="image-layer-upload"
        className="w-full block text-center cursor-pointer text-xs px-2 py-3 rounded-lg border-2 border-dashed border-line hover:border-brand transition mt-2"
      >
        + Subir imagen (PNG, JPG, WebP, SVG)
      </label>
      <input
        id="image-layer-upload"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleUpload}
        className="hidden"
      />
      {images.length > 0 && (
        <div className="space-y-2 pt-1">
          {images.map((im) => (
            <div key={im.id} className="bg-bg2/40 rounded p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <img
                  src={im.url}
                  alt=""
                  className="w-8 h-8 object-cover rounded border border-line"
                />
                <span className="text-xs flex-1 truncate">
                  Imagen
                  {im.locked ? <span className="text-mute"> · 🔒</span> : null}
                </span>
                <LockButton
                  locked={im.locked === true}
                  onToggle={() => onPatch(im.id, { locked: !im.locked })}
                />
                <button
                  onClick={() => onRemove(im.id)}
                  className="text-mute hover:text-red-500 text-xs"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberRow
                  label="Ancho"
                  value={Math.round(im.w)}
                  min={20}
                  max={2000}
                  step={10}
                  onChange={(v) => {
                    if (im.keepAspect) {
                      const aspect = im.h / im.w;
                      onPatch(im.id, { w: v, h: Math.round(v * aspect) });
                    } else {
                      onPatch(im.id, { w: v });
                    }
                  }}
                />
                <NumberRow
                  label="Alto"
                  value={Math.round(im.h)}
                  min={20}
                  max={2000}
                  step={10}
                  onChange={(v) => {
                    if (im.keepAspect) {
                      const aspect = im.w / im.h;
                      onPatch(im.id, { h: v, w: Math.round(v * aspect) });
                    } else {
                      onPatch(im.id, { h: v });
                    }
                  }}
                />
              </div>
              <label className="flex items-center gap-1.5 text-[10px] text-mute">
                <input
                  type="checkbox"
                  checked={im.keepAspect ?? true}
                  onChange={(e) => onPatch(im.id, { keepAspect: e.target.checked })}
                  className="accent-brand"
                />
                Mantener proporción
              </label>
              {/* Ajuste visual: cómo se acomoda la imagen DENTRO del rect
                  W×H. Cover llena el rect recortando el sobrante; Contain
                  entra entera con bandas; Estirar deforma para llenar.
                  Útil cuando la imagen no matchea el aspect del rect. */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1">
                  Ajuste de imagen
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {(['cover', 'contain', 'fill'] as const).map((f) => {
                    const active = (im.fit ?? 'fill') === f;
                    const labels = {
                      cover: { icon: '🟦', label: 'Cubrir' },
                      contain: { icon: '🔲', label: 'Contener' },
                      fill: { icon: '🔳', label: 'Estirar' },
                    } as const;
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => onPatch(im.id, { fit: f })}
                        className={`text-[10px] py-1.5 rounded-lg border-2 transition ${
                          active
                            ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                            : 'border-line hover:border-mute'
                        }`}
                        title={
                          f === 'cover'
                            ? 'Llena el rect recortando lo que sobra (drag para reposicionar)'
                            : f === 'contain'
                              ? 'Imagen entera adentro, deja bandas si es necesario'
                              : 'Estira la imagen al rect (puede deformarla)'
                        }
                      >
                        {labels[f].icon} {labels[f].label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Zoom: multiplica W×H manteniendo el centro visual. Útil
                  para agrandar o achicar rápido sin tocar W/H a mano. */}
              <div>
                <div className="flex items-center justify-between text-[10px] mb-0.5">
                  <span className="uppercase tracking-wider text-mute font-semibold">
                    Zoom
                  </span>
                  <span className="text-mute">
                    {Math.round((im.w / Math.max(1, im.h)) * 100) / 100 ===
                    Math.round((im.w / Math.max(1, im.h)) * 100) / 100
                      ? `${Math.round((im.w / 100) * 10) / 10}×`
                      : ''}
                    {Math.round(im.w)}×{Math.round(im.h)}
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={300}
                  step={5}
                  defaultValue={100}
                  onChange={(e) => {
                    const factor = Number(e.target.value) / 100;
                    const cx = im.x + im.w / 2;
                    const cy = im.y + im.h / 2;
                    const baseW = im.w;
                    const baseH = im.h;
                    const newW = Math.max(20, Math.round(baseW * factor));
                    const newH = Math.max(20, Math.round(baseH * factor));
                    onPatch(im.id, {
                      w: newW,
                      h: newH,
                      x: Math.round(cx - newW / 2),
                      y: Math.round(cy - newH / 2),
                    });
                    e.target.value = '100';
                  }}
                  className="w-full accent-brand"
                  title="Arrastrá para escalar; el centro de la imagen se mantiene en su lugar"
                />
                <div className="flex gap-1 mt-1">
                  <button
                    type="button"
                    onClick={() => {
                      // Ajustar al lienzo: ocupa el canvas completo
                      // manteniendo aspect (si keepAspect ON) o estirado.
                      const cw = canvasW;
                      const ch = canvasH;
                      if (im.keepAspect ?? true) {
                        const aspect = im.w / im.h;
                        const canvasAspect = cw / ch;
                        let nw, nh;
                        if (aspect > canvasAspect) {
                          nw = cw;
                          nh = Math.round(cw / aspect);
                        } else {
                          nh = ch;
                          nw = Math.round(ch * aspect);
                        }
                        onPatch(im.id, {
                          w: nw,
                          h: nh,
                          x: Math.round((cw - nw) / 2),
                          y: Math.round((ch - nh) / 2),
                        });
                      } else {
                        onPatch(im.id, { w: cw, h: ch, x: 0, y: 0 });
                      }
                    }}
                    className="btn-ghost text-[10px] py-1.5 flex-1"
                    title="Ocupa el lienzo entero"
                  >
                    ⛶ Lienzo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Tamaño original: lleva W×H a las dimensiones
                      // naturales de la imagen subida (read-only, conocido
                      // al cargar). Si la imagen no cargó todavía, no-op.
                      const i = new window.Image();
                      i.onload = () => {
                        const cw = canvasW;
                        const ch = canvasH;
                        const nw = i.naturalWidth;
                        const nh = i.naturalHeight;
                        const cx = im.x + im.w / 2;
                        const cy = im.y + im.h / 2;
                        // Clampear al canvas para que no quede fuera de
                        // pantalla si la natural es enorme.
                        const maxW = cw * 0.9;
                        const maxH = ch * 0.9;
                        const scale = Math.min(maxW / nw, maxH / nh, 1);
                        const finalW = Math.round(nw * scale);
                        const finalH = Math.round(nh * scale);
                        onPatch(im.id, {
                          w: finalW,
                          h: finalH,
                          x: Math.round(cx - finalW / 2),
                          y: Math.round(cy - finalH / 2),
                        });
                      };
                      i.src = im.url;
                    }}
                    className="btn-ghost text-[10px] py-1.5 flex-1"
                    title="Vuelve a las dimensiones naturales de la imagen"
                  >
                    ↺ Original
                  </button>
                </div>
              </div>
              {/* Centrar matemáticamente preciso. Soluciona la queja
                  de "alineado de imágenes + guía de centro": el cliente
                  no tiene que tratar de arrastrar al centro exacto a
                  mano — un click centra al pixel. */}
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onPatch(im.id, { x: (canvasW - im.w) / 2 })
                  }
                  className="btn-ghost text-[10px] py-1.5"
                  title="Centrar horizontalmente"
                >
                  ↔ H
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onPatch(im.id, { y: (canvasH - im.h) / 2 })
                  }
                  className="btn-ghost text-[10px] py-1.5"
                  title="Centrar verticalmente"
                >
                  ↕ V
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onPatch(im.id, {
                      x: (canvasW - im.w) / 2,
                      y: (canvasH - im.h) / 2,
                    })
                  }
                  className="btn-ghost text-[10px] py-1.5"
                  title="Centrar en el canvas"
                >
                  ⊕ Todo
                </button>
              </div>
              <NumberRow
                label="Rotación"
                value={im.rotation ?? 0}
                min={-180}
                max={180}
                step={5}
                onChange={(v) => onPatch(im.id, { rotation: v })}
              />
              <OpacityRow
                value={im.opacity ?? 1}
                onChange={(v) => onPatch(im.id, { opacity: v })}
              />
              <CropButton
                image={im}
                onApply={(crop) => {
                  if (crop) {
                    // Ajustar altura del rect render para que matchee
                    // el aspect del crop — sino la imagen sale estirada
                    // al hacer crop de aspect distinto al rect viejo.
                    const aspect = crop.width / crop.height;
                    const newH = Math.max(20, Math.round(im.w / aspect));
                    onPatch(im.id, { crop, h: newH });
                  } else {
                    onPatch(im.id, { crop: null });
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Generador de patrones con emojis. */
/** Botón + modal de crop para un ImageLayer. Muestra la imagen original
 *  con un rect arrastrable que define la región a usar. Aplica al
 *  cerrar — actualiza ImageLayer.crop con coords en la imagen source. */
function CropButton({
  image,
  onApply,
}: {
  image: ImageLayer;
  onApply: (crop: { x: number; y: number; width: number; height: number } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState<null | {
    mode: 'move' | 'resize';
    corner?: 'tl' | 'tr' | 'bl' | 'br';
    startX: number;
    startY: number;
    cropStart: { x: number; y: number; w: number; h: number };
  }>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [loadError, setLoadError] = useState(false);

  // Cargar dimensiones reales de la imagen + setear crop default
  useEffect(() => {
    if (!open) return;
    setLoadError(false);
    const img = new window.Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setNaturalSize({ w, h });
      if (image.crop) {
        setCrop({
          x: image.crop.x,
          y: image.crop.y,
          w: image.crop.width,
          h: image.crop.height,
        });
      } else {
        setCrop({ x: 0, y: 0, w, h });
      }
    };
    img.onerror = () => {
      setLoadError(true);
      setNaturalSize(null);
    };
    img.src = image.url;
  }, [open, image.url]);

  // Display: imagen escalada a 400px ancho max
  const displayW = 480;
  const scale = naturalSize ? displayW / naturalSize.w : 1;
  const displayH = naturalSize ? naturalSize.h * scale : 0;

  function pointerToImage(e: React.PointerEvent) {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / scale,
      y: (e.clientY - r.top) / scale,
    };
  }

  function onDown(
    e: React.PointerEvent,
    mode: 'move' | 'resize',
    corner?: 'tl' | 'tr' | 'bl' | 'br',
  ) {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = pointerToImage(e);
    setDragging({ mode, corner, startX: p.x, startY: p.y, cropStart: { ...crop } });
  }
  function onMove(e: React.PointerEvent) {
    if (!dragging || !crop || !naturalSize) return;
    const p = pointerToImage(e);
    const dx = p.x - dragging.startX;
    const dy = p.y - dragging.startY;
    const base = dragging.cropStart;
    if (dragging.mode === 'move') {
      const newX = Math.max(0, Math.min(naturalSize.w - base.w, base.x + dx));
      const newY = Math.max(0, Math.min(naturalSize.h - base.h, base.y + dy));
      setCrop({ ...base, x: newX, y: newY });
    } else if (dragging.mode === 'resize') {
      let { x, y, w, h } = base;
      const c = dragging.corner!;
      if (c.includes('l')) {
        const newX = Math.max(0, Math.min(base.x + base.w - 50, base.x + dx));
        w = base.w - (newX - base.x);
        x = newX;
      }
      if (c.includes('r')) {
        w = Math.max(50, Math.min(naturalSize.w - base.x, base.w + dx));
      }
      if (c.includes('t')) {
        const newY = Math.max(0, Math.min(base.y + base.h - 50, base.y + dy));
        h = base.h - (newY - base.y);
        y = newY;
      }
      if (c.includes('b')) {
        h = Math.max(50, Math.min(naturalSize.h - base.y, base.h + dy));
      }
      setCrop({ x, y, w, h });
    }
  }
  function onUp(e: React.PointerEvent) {
    if (dragging) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
    setDragging(null);
  }

  function apply() {
    if (!crop) return;
    onApply({ x: crop.x, y: crop.y, width: crop.w, height: crop.h });
    setOpen(false);
  }
  function reset() {
    onApply(null);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-ghost text-xs w-full"
      >
        ✂️ Recortar imagen
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-line flex items-center justify-between">
              <h3 className="text-sm font-semibold m-0">Recortar imagen</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-mute hover:text-ink"
              >
                ✕
              </button>
            </div>
            <div className="p-4 flex flex-col items-center gap-3">
              {loadError ? (
                <div className="text-sm text-bad py-8">
                  No se pudo cargar la imagen para recortar. Probá eliminarla y subirla de nuevo.
                </div>
              ) : !naturalSize || !crop ? (
                <div className="text-sm text-mute py-8">Cargando imagen…</div>
              ) : (
                <>
                  <div
                    ref={containerRef}
                    className="relative bg-bg2/40 select-none"
                    style={{ width: displayW, height: displayH }}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                  >
                    <img
                      src={image.url}
                      alt=""
                      className="absolute inset-0 w-full h-full pointer-events-none object-fill"
                      draggable={false}
                    />
                    {/* Overlay oscuro fuera del crop */}
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        boxShadow: `inset 0 0 0 9999px rgba(0,0,0,0.45)`,
                        clipPath: `polygon(
                          0% 0%, 0% 100%, ${(crop.x * scale).toFixed(1)}px 100%,
                          ${(crop.x * scale).toFixed(1)}px ${(crop.y * scale).toFixed(1)}px,
                          ${((crop.x + crop.w) * scale).toFixed(1)}px ${(crop.y * scale).toFixed(1)}px,
                          ${((crop.x + crop.w) * scale).toFixed(1)}px ${((crop.y + crop.h) * scale).toFixed(1)}px,
                          ${(crop.x * scale).toFixed(1)}px ${((crop.y + crop.h) * scale).toFixed(1)}px,
                          ${(crop.x * scale).toFixed(1)}px 100%, 100% 100%, 100% 0%
                        )`,
                      }}
                    />
                    {/* Rect del crop con handles */}
                    <div
                      className="absolute border-2 border-white shadow-md cursor-move"
                      style={{
                        left: crop.x * scale,
                        top: crop.y * scale,
                        width: crop.w * scale,
                        height: crop.h * scale,
                      }}
                      onPointerDown={(e) => onDown(e, 'move')}
                    >
                      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                        <div
                          key={c}
                          className="absolute w-3 h-3 bg-white border-2 border-brand"
                          style={{
                            top: c.includes('t') ? -6 : undefined,
                            bottom: c.includes('b') ? -6 : undefined,
                            left: c.includes('l') ? -6 : undefined,
                            right: c.includes('r') ? -6 : undefined,
                            cursor:
                              c === 'tl' || c === 'br'
                                ? 'nwse-resize'
                                : 'nesw-resize',
                          }}
                          onPointerDown={(e) => onDown(e, 'resize', c)}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="text-[11px] text-mute">
                    {Math.round(crop.w)} × {Math.round(crop.h)} px
                  </div>
                </>
              )}
            </div>
            <div className="p-4 border-t border-line flex gap-2 justify-between flex-wrap">
              <button
                onClick={reset}
                className="btn-ghost text-sm"
              >
                Quitar recorte
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setOpen(false)}
                  className="btn-ghost text-sm"
                >
                  Cancelar
                </button>
                <button
                  onClick={apply}
                  className="btn-primary text-sm"
                  disabled={!crop}
                >
                  Aplicar recorte
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PatternsSection({
  patterns,
  onAdd,
  onPatch,
  onRemove,
}: {
  patterns: PatternLayer[];
  onAdd: (opts: { emojis?: string[]; imageUrl?: string }) => void;
  onPatch: (id: string, patch: Partial<PatternLayer>) => void;
  onRemove: (id: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [draftEmojis, setDraftEmojis] = useState<string[]>(['🍪', '☕']);

  function commit() {
    onAdd({ emojis: draftEmojis });
    setDraftEmojis(['🍪', '☕']);
    setPicking(false);
  }

  /** Subir un PNG/SVG/JPG y crear un patrón usando esa imagen como
   *  tile. El cliente puede entonces ajustar tamaño/gap/rotación/
   *  densidad como cualquier patrón. */
  function handlePngUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      alert(`La imagen es muy pesada. Máx ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      onAdd({ imageUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }

  return (
    <Section title="Patrones" icon="✨" defaultOpen={patterns.length > 0}>
      {!picking ? (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="w-full text-xs px-2 py-3 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
          >
            + Generar patrón con emojis
          </button>
          <label
            htmlFor="pattern-png-upload"
            className="w-full block text-center cursor-pointer text-xs px-2 py-3 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
          >
            + Patrón con imagen (PNG/SVG)
          </label>
          <input
            id="pattern-png-upload"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={handlePngUpload}
            className="hidden"
          />
        </div>
      ) : (
        <div className="space-y-2 border border-line rounded p-2 bg-bg2/30">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold">Elegí emojis para el patrón</div>
            <div
              className={`text-[10px] tabular-nums ${
                draftEmojis.length >= 8
                  ? 'text-amber-600 font-semibold'
                  : 'text-mute'
              }`}
            >
              {draftEmojis.length}/8
            </div>
          </div>
          <div className="flex flex-wrap gap-1 min-h-[28px] p-1.5 bg-white rounded border border-line">
            {draftEmojis.length === 0 ? (
              <span className="text-[10px] text-mute">(Vacío)</span>
            ) : (
              draftEmojis.map((e, i) => (
                <button
                  key={i}
                  onClick={() => setDraftEmojis((d) => d.filter((_, idx) => idx !== i))}
                  className="text-lg hover:scale-110 transition"
                  title="Quitar"
                >
                  {e}
                </button>
              ))
            )}
          </div>
          <EmojiQuickPick
            disabled={draftEmojis.length >= 8}
            onPick={(e) => setDraftEmojis((d) => (d.length < 8 ? [...d, e] : d))}
          />
          {draftEmojis.length >= 8 && (
            <div className="text-[10px] text-amber-700 leading-relaxed">
              Llegaste al máximo de 8 emojis por patrón. Quitá uno para
              agregar otro.
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={commit}
              disabled={draftEmojis.length === 0}
              className="btn-primary flex-1 text-xs disabled:opacity-50"
            >
              Crear patrón
            </button>
            <button
              type="button"
              onClick={() => setPicking(false)}
              className="btn-ghost text-xs"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {patterns.length > 0 && (
        <div className="space-y-2 pt-1">
          {patterns.map((p) => (
            <div key={p.id} className="bg-bg2/40 rounded p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt=""
                    className="w-7 h-7 object-cover rounded border border-line shrink-0"
                  />
                ) : (
                  <span className="text-base">{p.emojis.join('')}</span>
                )}
                <span className="text-xs flex-1">
                  Patrón {p.imageUrl ? '(imagen)' : '(emojis)'}
                </span>
                <button
                  onClick={() => onRemove(p.id)}
                  className="text-mute hover:text-red-500 text-xs"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberRow
                  label="Tamaño"
                  value={p.size}
                  min={16}
                  max={200}
                  step={4}
                  onChange={(v) => onPatch(p.id, { size: v })}
                />
                <NumberRow
                  label="Espacio"
                  value={p.gap}
                  min={0}
                  max={200}
                  step={4}
                  onChange={(v) => onPatch(p.id, { gap: v })}
                />
              </div>
              <NumberRow
                label="Rotación"
                value={p.rotation}
                min={-180}
                max={180}
                step={5}
                onChange={(v) => onPatch(p.id, { rotation: v })}
              />
              <OpacityRow
                label="Densidad"
                value={p.density}
                onChange={(v) => onPatch(p.id, { density: v })}
              />
              <OpacityRow
                value={p.opacity}
                onChange={(v) => onPatch(p.id, { opacity: v })}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Quick emoji pick: usado dentro del generador de patrones. Muestra
 *  un mini buscador + grid. */
function EmojiQuickPick({
  onPick,
  disabled = false,
}: {
  onPick: (e: string) => void;
  disabled?: boolean;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(
    () => (q.trim() ? searchEmojis(q, 24) : EMOJI_DATA.slice(0, 24)),
    [q],
  );
  return (
    <div className={`space-y-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar emoji…"
        className="input text-xs"
        disabled={disabled}
      />
      <div className="grid grid-cols-8 gap-0.5 max-h-[120px] overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.e}
            onClick={() => onPick(r.e)}
            disabled={disabled}
            className="text-lg hover:bg-bg2 rounded p-1 transition disabled:cursor-not-allowed"
            title={r.n}
          >
            {r.e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Sección de iconos/emojis libres — busca, agrega, edita. */
/** Sección de cajas de texto libres. UI tipo Canva — cada caja con
 *  controles de duplicar, lock, hide, eliminar + sus props
 *  individuales colapsadas hasta clickearla. */
/** Sección "Formas" — agregar shapes de los 7 tipos + listado de
 *  shapes existentes con color/tamaño/rotation/innerText editables.
 *  Pensada para composiciones tipo Canva (stickers, badges, fondos
 *  curvos, blobs decorativos). */
function ShapesSection({
  shapes,
  onAdd,
  onPatch,
  onDuplicate,
  onRemove,
}: {
  shapes: ShapeLayer[];
  onAdd: (type: ShapeType) => void;
  onPatch: (id: string, patch: Partial<ShapeLayer>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const SHAPE_BUTTONS: { type: ShapeType; icon: string; label: string }[] = [
    { type: 'rect', icon: '▭', label: 'Rect' },
    { type: 'roundedRect', icon: '▢', label: 'Redondo' },
    { type: 'capsule', icon: '⬭', label: 'Pill' },
    { type: 'circle', icon: '●', label: 'Círculo' },
    { type: 'star', icon: '★', label: 'Estrella' },
    { type: 'burst', icon: '✺', label: 'Sticker' },
    { type: 'blob', icon: '🜲', label: 'Blob' },
  ];
  return (
    <Section title="Formas" icon="⬡" defaultOpen={shapes.length > 0}>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
        {SHAPE_BUTTONS.map((b) => (
          <button
            key={b.type}
            type="button"
            onClick={() => onAdd(b.type)}
            className="flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-lg border-2 border-line hover:border-brand transition text-[10px]"
            title={`Agregar ${b.label}`}
          >
            <span className="text-lg leading-none">{b.icon}</span>
            <span>{b.label}</span>
          </button>
        ))}
      </div>
      {shapes.length === 0 && (
        <div className="text-[11px] text-mute leading-relaxed text-center py-2">
          Tocá un tipo para agregar. El{' '}
          <strong>Sticker</strong> trae "10% off" precargado — útil para
          carteles promocionales.
        </div>
      )}
      {shapes.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {shapes.map((s) => {
            const open = expandedId === s.id;
            const label =
              SHAPE_BUTTONS.find((b) => b.type === s.type)?.label ?? s.type;
            return (
              <div key={s.id} className="bg-bg2/40 rounded p-2 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setExpandedId(open ? null : s.id)}
                    className="flex-1 text-left text-xs font-semibold truncate"
                  >
                    <span className="text-mute mr-1">{open ? '▾' : '▸'}</span>
                    {label}
                    {s.innerText?.text
                      ? ` · "${s.innerText.text.split('\n')[0]}"`
                      : ''}
                    {s.locked ? <span className="text-mute"> · 🔒</span> : null}
                  </button>
                  <LockButton
                    locked={s.locked === true}
                    onToggle={() => onPatch(s.id, { locked: !s.locked })}
                  />
                  <button
                    onClick={() => onDuplicate(s.id)}
                    className="text-mute hover:text-ink text-xs px-1"
                    title="Duplicar"
                  >
                    ⎘
                  </button>
                  <button
                    onClick={() => onRemove(s.id)}
                    className="text-mute hover:text-red-500 text-xs px-1"
                    title="Eliminar"
                  >
                    ✕
                  </button>
                </div>
                {open && (
                  <div className="space-y-1.5 pt-1 border-t border-line2">
                    <ColorRow
                      label="Color"
                      value={s.fill}
                      onChange={(v) => onPatch(s.id, { fill: v })}
                    />
                    {/* Para shapes "radiales" (circle/star/burst) el
                     *  ancho y alto siempre coinciden — Konva.Circle/
                     *  Star usan UN radio, así que mostrar 2 inputs
                     *  confunde y desfasa el snap. Un solo input "Tamaño".
                     *  Mostramos min(w,h) para que posters viejos con
                     *  asimetría se vean coherentes con el render. Al
                     *  cambiar, preservamos el centro visual (sino la
                     *  shape salta si h era distinto de w). */}
                    {s.type === 'circle' ||
                    s.type === 'star' ||
                    s.type === 'burst' ? (
                      <NumberRow
                        label="Tamaño"
                        value={Math.min(s.w, s.h)}
                        min={20}
                        max={2000}
                        step={10}
                        onChange={(v) =>
                          onPatch(s.id, {
                            w: v,
                            h: v,
                            // Preservar el centro visual al re-igualar w/h
                            x: s.x + (s.w - v) / 2,
                            y: s.y + (s.h - v) / 2,
                          })
                        }
                      />
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        <NumberRow
                          label="Ancho"
                          value={s.w}
                          min={20}
                          max={2000}
                          step={10}
                          onChange={(v) => onPatch(s.id, { w: v })}
                        />
                        <NumberRow
                          label="Alto"
                          value={s.h}
                          min={20}
                          max={2000}
                          step={10}
                          onChange={(v) => onPatch(s.id, { h: v })}
                        />
                      </div>
                    )}
                    {(s.type === 'rect' || s.type === 'roundedRect') && (
                      <NumberRow
                        label="Esquinas"
                        value={s.borderRadius ?? 0}
                        min={0}
                        max={200}
                        step={4}
                        onChange={(v) => onPatch(s.id, { borderRadius: v })}
                      />
                    )}
                    {(s.type === 'star' || s.type === 'burst') && (
                      <>
                        <NumberRow
                          label="Puntas"
                          value={s.points ?? (s.type === 'burst' ? 16 : 5)}
                          min={3}
                          max={32}
                          step={1}
                          onChange={(v) => onPatch(s.id, { points: v })}
                        />
                        <NumberRow
                          label="Profundidad"
                          value={Math.round((s.innerRadiusFactor ?? 0.5) * 100)}
                          min={20}
                          max={95}
                          step={5}
                          onChange={(v) =>
                            onPatch(s.id, { innerRadiusFactor: v / 100 })
                          }
                        />
                      </>
                    )}
                    {s.type === 'blob' && (
                      <button
                        type="button"
                        onClick={() =>
                          onPatch(s.id, {
                            seed: Math.floor(Math.random() * 100000),
                          })
                        }
                        className="btn-ghost text-xs w-full"
                      >
                        🎲 Regenerar blob
                      </button>
                    )}
                    <PositionRow
                      x={s.x}
                      y={s.y}
                      onChange={(x, y) => onPatch(s.id, { x, y })}
                    />
                    <NumberRow
                      label="Rotación"
                      value={s.rotation ?? 0}
                      min={-180}
                      max={180}
                      step={5}
                      onChange={(v) => onPatch(s.id, { rotation: v })}
                    />
                    <OpacityRow
                      value={s.opacity ?? 1}
                      onChange={(v) => onPatch(s.id, { opacity: v })}
                    />
                    {/* Sticker / badge: innerText opcional */}
                    <ShapeGradientEditor
                      gradient={s.gradientFill ?? null}
                      onChange={(g) => onPatch(s.id, { gradientFill: g })}
                    />
                    <ShapeInnerTextEditor
                      innerText={s.innerText ?? null}
                      onChange={(it) => onPatch(s.id, { innerText: it })}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/** Editor del texto centrado adentro de una shape (para sticker
 *  promocional tipo "10% OFF" en un burst, badge "NUEVO" en un círculo,
 *  etc). Toggle on/off + controles. */
/** Editor de gradient para shapes — toggle on/off + 2 colores +
 *  selector de tipo (linear angle preset / radial). Si está off, la
 *  shape usa fill sólido normal. Cuando está on, sobrescribe fill. */
function ShapeGradientEditor({
  gradient,
  onChange,
}: {
  gradient: ShapeLayer['gradientFill'] | null;
  onChange: (g: ShapeLayer['gradientFill'] | null) => void;
}) {
  // Cachear el último ángulo numérico para que el toggle linear → radial
  // → linear no pierda el ángulo custom (default era reset a 135 cada
  // vez). Persiste mientras el componente está montado.
  const lastLinearAngleRef = useRef<number>(
    gradient && typeof gradient.angle === 'number' ? gradient.angle : 135,
  );
  useEffect(() => {
    if (gradient && typeof gradient.angle === 'number') {
      lastLinearAngleRef.current = gradient.angle;
    }
  }, [gradient]);

  if (!gradient) {
    return (
      <button
        type="button"
        onClick={() =>
          onChange({ color1: '#6366F1', color2: '#A855F7', angle: 135 })
        }
        className="w-full text-[11px] text-mute hover:text-ink border border-dashed border-line rounded py-1.5 transition"
      >
        + Aplicar gradiente
      </button>
    );
  }
  const isRadial = gradient.angle === 'radial';
  return (
    <div className="border border-line rounded p-2 bg-bg2/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold">Gradiente</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-mute hover:text-red-500 text-xs"
        >
          ✕
        </button>
      </div>
      <ColorRow
        label="Color 1"
        value={gradient.color1}
        onChange={(v) => onChange({ ...gradient, color1: v })}
      />
      <ColorRow
        label="Color 2"
        value={gradient.color2}
        onChange={(v) => onChange({ ...gradient, color2: v })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ ...gradient, angle: lastLinearAngleRef.current })}
          className={`text-[10px] py-1.5 rounded border-2 ${
            !isRadial
              ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
              : 'border-line'
          }`}
        >
          ⟶ Linear
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...gradient, angle: 'radial' })}
          className={`text-[10px] py-1.5 rounded border-2 ${
            isRadial
              ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
              : 'border-line'
          }`}
        >
          ◯ Radial
        </button>
      </div>
      {!isRadial && (
        <NumberRow
          label="Ángulo"
          value={typeof gradient.angle === 'number' ? gradient.angle : 135}
          min={0}
          max={360}
          step={5}
          onChange={(v) => onChange({ ...gradient, angle: v })}
        />
      )}
      {/* Preview: para radial usamos `ellipse farthest-corner` para que
       *  matchee el render Konva (radius = diagonal/2). Sin esto, el
       *  preview se ve como un círculo pero el export sale elipse. */}
      <div
        className="rounded h-8 mt-1 border border-line"
        style={{
          background: isRadial
            ? `radial-gradient(ellipse farthest-corner at center, ${gradient.color1}, ${gradient.color2})`
            : `linear-gradient(${gradient.angle}deg, ${gradient.color1}, ${gradient.color2})`,
        }}
      />
    </div>
  );
}

function ShapeInnerTextEditor({
  innerText,
  onChange,
}: {
  innerText: ShapeLayer['innerText'] | null;
  onChange: (it: ShapeLayer['innerText'] | null) => void;
}) {
  // Cachear el último innerText conocido para preservar customizaciones
  // al toggle off→on. Sin esto el ✕ destruía text/color/size y al
  // re-abrirlo arrancaba con defaults — el cliente perdía el trabajo.
  const lastValueRef = useRef<NonNullable<ShapeLayer['innerText']> | null>(null);
  useEffect(() => {
    if (innerText) lastValueRef.current = innerText;
  }, [innerText]);

  if (!innerText) {
    return (
      <button
        type="button"
        onClick={() =>
          onChange(
            lastValueRef.current ?? {
              text: 'TEXTO',
              color: '#FFFFFF',
              size: 32,
              font: 'Inter, system-ui, sans-serif',
              weight: 900,
              lineHeight: 1.1,
            },
          )
        }
        className="w-full text-[11px] text-mute hover:text-ink border border-dashed border-line rounded py-1.5 transition"
      >
        + Texto adentro (sticker)
      </button>
    );
  }
  return (
    <div className="border border-line rounded p-2 bg-bg2/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold">Texto adentro</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-mute hover:text-red-500 text-xs"
        >
          ✕
        </button>
      </div>
      <AutoResizeTextarea
        value={innerText.text}
        onChange={(v) => onChange({ ...innerText, text: v })}
        placeholder="10% off"
      />
      <ColorRow
        label="Color"
        value={innerText.color}
        onChange={(v) => onChange({ ...innerText, color: v })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        <NumberRow
          label="Tamaño"
          value={innerText.size}
          min={10}
          max={200}
          step={2}
          onChange={(v) => onChange({ ...innerText, size: v })}
        />
        <SelectRow
          label="Peso"
          value={String(innerText.weight ?? 700)}
          options={[
            { label: 'Regular', value: '400' },
            { label: 'Bold', value: '700' },
            { label: 'Black', value: '900' },
          ]}
          onChange={(v) =>
            onChange({ ...innerText, weight: Number(v) })
          }
        />
      </div>
    </div>
  );
}

function CustomTextsSection({
  texts,
  canvasW,
  canvasH,
  onAdd,
  onPatch,
  onDuplicate,
  onRemove,
}: {
  texts: CustomTextLayer[];
  canvasW: number;
  canvasH: number;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<CustomTextLayer>) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <Section title="Textos libres" icon="🅣" defaultOpen={texts.length > 0}>
      <button
        type="button"
        onClick={onAdd}
        className="w-full text-xs px-2 py-3 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
      >
        + Agregar texto
      </button>
      {texts.length === 0 && (
        <div className="text-[11px] text-mute text-center py-2 leading-relaxed">
          Cajas de texto independientes — tipografía, color, sombra y
          tamaño propios. Útil para callouts, etiquetas, decoración.
        </div>
      )}
      {texts.map((t) => {
        const open = expandedId === t.id;
        const preview = (t.text || '').split('\n')[0].slice(0, 32) || 'Texto';
        return (
          <div key={t.id} className="bg-bg2/40 rounded p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setExpandedId(open ? null : t.id)}
                className="flex-1 text-left text-xs font-semibold truncate"
                title="Editar"
              >
                <span className="text-mute mr-1">{open ? '▾' : '▸'}</span>
                {preview}
              </button>
              <button
                onClick={() => onPatch(t.id, { hidden: !t.hidden })}
                className="text-mute hover:text-ink text-xs px-1"
                title={t.hidden ? 'Mostrar' : 'Ocultar'}
              >
                {t.hidden ? '🙈' : '👁'}
              </button>
              <button
                onClick={() => onPatch(t.id, { locked: !t.locked })}
                className="text-mute hover:text-ink text-xs px-1"
                title={t.locked ? 'Desbloquear' : 'Bloquear'}
              >
                {t.locked ? '🔒' : '🔓'}
              </button>
              <button
                onClick={() => onDuplicate(t.id)}
                className="text-mute hover:text-ink text-xs px-1"
                title="Duplicar"
              >
                ⎘
              </button>
              <button
                onClick={() => onRemove(t.id)}
                className="text-mute hover:text-red-500 text-xs px-1"
                title="Eliminar"
              >
                ✕
              </button>
            </div>
            {open && (
              <div className="space-y-1.5 pt-1 border-t border-line2">
                <AutoResizeTextarea
                  value={t.text}
                  onChange={(v) => onPatch(t.id, { text: v })}
                  placeholder="Tu texto…"
                />
                <FontPicker
                  value={t.font}
                  onChange={(v) => {
                    const opt = FONT_OPTIONS.find((o) => o.value === v);
                    onPatch(t.id, {
                      font: v,
                      fontLabel: opt?.label ?? t.fontLabel,
                    });
                  }}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <NumberRow
                    label="Tamaño"
                    value={t.size}
                    min={10}
                    max={300}
                    step={2}
                    onChange={(v) => onPatch(t.id, { size: v })}
                  />
                  <SelectRow
                    label="Peso"
                    value={String(t.weight)}
                    options={[
                      { label: 'Regular', value: '400' },
                      { label: 'Semibold', value: '600' },
                      { label: 'Bold', value: '700' },
                      { label: 'Black', value: '900' },
                    ]}
                    onChange={(v) => onPatch(t.id, { weight: Number(v) })}
                  />
                </div>
                <ColorRow
                  label="Color"
                  value={t.color}
                  onChange={(v) => onPatch(t.id, { color: v })}
                />
                <PositionRow
                  x={t.x}
                  y={t.y}
                  onChange={(x, y) => onPatch(t.id, { x, y })}
                />
                <NumberRow
                  label="Ancho caja"
                  value={t.boxWidth ?? 0}
                  min={0}
                  max={2000}
                  step={20}
                  onChange={(v) =>
                    onPatch(t.id, { boxWidth: v > 0 ? v : null })
                  }
                />
                <TextAlignButtons
                  value={t.align}
                  onChange={(v) => onPatch(t.id, { align: v })}
                />
                <PageAlignButtons
                  layer={t}
                  canvasW={canvasW}
                  canvasH={canvasH}
                  onPatch={(p) => onPatch(t.id, p)}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  <NumberRow
                    label="Línea"
                    value={t.lineHeight ?? 1.2}
                    min={0.8}
                    max={3}
                    step={0.1}
                    onChange={(v) => onPatch(t.id, { lineHeight: v })}
                  />
                  <NumberRow
                    label="Letra"
                    value={t.letterSpacing ?? 0}
                    min={-10}
                    max={50}
                    step={1}
                    onChange={(v) => onPatch(t.id, { letterSpacing: v })}
                  />
                </div>
                <NumberRow
                  label="Rotación"
                  value={t.rotation ?? 0}
                  min={-180}
                  max={180}
                  step={5}
                  onChange={(v) => onPatch(t.id, { rotation: v })}
                />
                <OpacityRow
                  value={t.opacity ?? 1}
                  onChange={(v) => onPatch(t.id, { opacity: v })}
                />
                <TextShadowEditor
                  shadow={t.shadow ?? null}
                  onChange={(s) => onPatch(t.id, { shadow: s })}
                />
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function EmojisSection({
  icons,
  onAdd,
  onPatch,
  onRemove,
}: {
  icons: IconLayer[];
  onAdd: (e: string) => void;
  onPatch: (id: string, patch: Partial<IconLayer>) => void;
  onRemove: (id: string) => void;
}) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<EmojiCategory | 'all'>('all');

  const results = useMemo<EmojiEntry[]>(() => {
    if (q.trim()) return searchEmojis(q, 80);
    if (category === 'all') return EMOJI_DATA;
    return EMOJI_DATA.filter((e) => e.c === category);
  }, [q, category]);

  return (
    <Section title="Iconos / Emojis" icon="😀" defaultOpen={icons.length > 0}>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder='Buscar "galleta", "café", "fitness"…'
        className="input text-xs"
      />
      {!q.trim() && (
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setCategory('all')}
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              category === 'all' ? 'bg-brand text-white' : 'bg-bg2 text-mute hover:bg-bg2/70'
            }`}
          >
            Todos
          </button>
          {(Object.keys(EMOJI_CATEGORY_LABELS) as EmojiCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`text-base px-1 py-0.5 rounded ${
                category === cat ? 'bg-brand-soft' : 'hover:bg-bg2/50'
              }`}
              title={EMOJI_CATEGORY_LABELS[cat]}
            >
              {EMOJI_CATEGORY_ICONS[cat]}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-8 gap-0.5 max-h-[180px] overflow-y-auto pr-1">
        {results.map((r) => (
          <button
            key={r.e + r.n}
            onClick={() => onAdd(r.e)}
            className="text-xl hover:bg-bg2 rounded p-1 transition"
            title={r.n}
          >
            {r.e}
          </button>
        ))}
        {results.length === 0 && (
          <div className="col-span-8 text-[11px] text-mute py-3 text-center">
            Sin resultados para "{q}"
          </div>
        )}
      </div>
      {icons.length > 0 && (
        <div className="border-t border-line pt-2 mt-1 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
            Agregados al cartel
          </div>
          {icons.map((i) => (
            <div key={i.id} className="flex items-center gap-2 bg-bg2/40 rounded p-1.5">
              <span className="text-xl">{i.emoji}</span>
              <input
                type="number"
                value={i.size}
                min={20}
                max={400}
                step={10}
                onChange={(e) => onPatch(i.id, { size: Number(e.target.value) })}
                className="input text-xs w-[60px]"
                title="Tamaño"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={i.opacity ?? 1}
                onChange={(e) => onPatch(i.id, { opacity: Number(e.target.value) })}
                className="flex-1 accent-brand"
                title="Opacidad"
              />
              <LockButton
                locked={i.locked === true}
                onToggle={() => onPatch(i.id, { locked: !i.locked })}
              />
              <button
                onClick={() => onRemove(i.id)}
                className="text-mute hover:text-red-500 text-xs"
                title="Eliminar"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
