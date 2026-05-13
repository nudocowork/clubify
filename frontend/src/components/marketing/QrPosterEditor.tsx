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
} from 'react-konva';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { api } from '@/lib/api';
import {
  type QrPosterConfig,
  type QrPosterType,
  type TextLayer,
  type BgConfig,
  type ShapeLayer,
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

type Props = {
  type: QrPosterType;
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

let fontsLoaded = false;
function ensureFontsLoaded() {
  if (typeof document === 'undefined' || fontsLoaded) return;
  fontsLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleFontsUrl();
  document.head.appendChild(link);
}

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

/** Convierte el BgConfig sólido o gradient a props de fill para el Rect
 *  base. Para imagen, el Rect base queda con un color neutro y la
 *  imagen se pinta como KonvaImage separada arriba. */
function rectFillProps(bg: BgConfig, w: number, h: number) {
  if (bg.type === 'solid') {
    return { fill: bg.color1, opacity: bg.opacity ?? 1 };
  }
  if (bg.type === 'gradient') {
    const rad = ((bg.angle ?? 135) * Math.PI) / 180;
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

type Guide = { type: 'v' | 'h'; value: number };

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

  // Targets verticales (líneas | a snapear en X)
  const vTargets: { value: number; alignBy: 'left' | 'center' | 'right' }[] = [
    { value: 0, alignBy: 'left' },
    { value: canvasW / 2, alignBy: 'center' },
    { value: canvasW, alignBy: 'right' },
  ];
  // Targets horizontales (líneas ─ a snapear en Y)
  const hTargets: { value: number; alignBy: 'top' | 'center' | 'bottom' }[] = [
    { value: 0, alignBy: 'top' },
    { value: canvasH / 2, alignBy: 'center' },
    { value: canvasH, alignBy: 'bottom' },
  ];

  for (const o of others) {
    if (o.id === skipId) continue;
    vTargets.push({ value: o.x, alignBy: 'left' });
    vTargets.push({ value: o.x + o.w / 2, alignBy: 'center' });
    vTargets.push({ value: o.x + o.w, alignBy: 'right' });
    hTargets.push({ value: o.y, alignBy: 'top' });
    hTargets.push({ value: o.y + o.h / 2, alignBy: 'center' });
    hTargets.push({ value: o.y + o.h, alignBy: 'bottom' });
  }

  // Snap X — probar alinear left/center/right del dragged contra cada target
  let bestVDelta = Infinity;
  let bestV: { newX: number; lineValue: number } | null = null;
  for (const t of vTargets) {
    for (const align of [
      { ref: draggedBox.x, delta: t.value - draggedBox.x },
      { ref: draggedCx, delta: t.value - draggedCx },
      { ref: draggedRight, delta: t.value - draggedRight },
    ]) {
      if (Math.abs(align.delta) < SNAP_THRESHOLD && Math.abs(align.delta) < bestVDelta) {
        bestVDelta = Math.abs(align.delta);
        bestV = { newX: draggedBox.x + align.delta, lineValue: t.value };
      }
    }
  }
  if (bestV) {
    newX = bestV.newX;
    guides.push({ type: 'v', value: bestV.lineValue });
  }

  // Snap Y
  let bestHDelta = Infinity;
  let bestH: { newY: number; lineValue: number } | null = null;
  for (const t of hTargets) {
    for (const align of [
      { ref: draggedBox.y, delta: t.value - draggedBox.y },
      { ref: draggedCy, delta: t.value - draggedCy },
      { ref: draggedBottom, delta: t.value - draggedBottom },
    ]) {
      if (Math.abs(align.delta) < SNAP_THRESHOLD && Math.abs(align.delta) < bestHDelta) {
        bestHDelta = Math.abs(align.delta);
        bestH = { newY: draggedBox.y + align.delta, lineValue: t.value };
      }
    }
  }
  if (bestH) {
    newY = bestH.newY;
    guides.push({ type: 'h', value: bestH.lineValue });
  }

  return { x: newX, y: newY, guides };
}

/** Bounding boxes aproximados de TODOS los layers para usar como
 *  targets de snap. Usa ids prefijados que matchean los LayerId
 *  ('text.title', 'qr', 'shape.<id>', etc). */
function gatherSnapTargets(cfg: QrPosterConfig) {
  const out: { x: number; y: number; w: number; h: number; id: string }[] = [];
  out.push({
    x: cfg.qr.x,
    y: cfg.qr.y,
    w: cfg.qr.size,
    h: cfg.qr.size,
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
    // Estimación del bbox visual real del texto. Para textos full-width
    // (align center/right), el centro horizontal del texto ES el centro
    // del canvas — no aporta info nueva al snap porque ya tenemos el
    // canvas-center como target nativo. Si pusiéramos x:0 w:canvas.w
    // como hacíamos antes, cada drag verticalmente cercano al medio del
    // canvas mostraría una guía duplicada visualmente confusa. Mejor:
    // estimar el ancho real del texto y centrar el bbox.
    const approxW = Math.max(t.size * (t.text.length * 0.5), t.size);
    const isFullWidth = t.align === 'center' || t.align === 'right';
    const bx = isFullWidth ? (cfg.canvas.w - approxW) / 2 : t.x;
    out.push({
      x: bx,
      y: t.y,
      w: approxW,
      h: t.size,
      id: `text.${k}`,
    });
  }
  for (const s of cfg.shapes ?? []) {
    out.push({ x: s.x, y: s.y, w: s.w, h: s.h, id: `shape.${s.id}` });
  }
  for (const i of cfg.icons ?? []) {
    out.push({ x: i.x, y: i.y, w: i.size, h: i.size, id: `icon.${i.id}` });
  }
  for (const im of cfg.images ?? []) {
    out.push({ x: im.x, y: im.y, w: im.w, h: im.h, id: `image.${im.id}` });
  }
  return out;
}

// ─────────────────────────── Componente ─────────────────────────── //

type HistoryState = { history: QrPosterConfig[]; idx: number };

export default function QrPosterEditor({
  type,
  qrUrl,
  brandName,
  logoUrl,
  metaSlot,
}: Props) {
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
    api<any>(`/qr-posters/by-type/${type}`)
      .then((row) => {
        if (cancelled) return;
        if (row?.config) {
          replaceHistory(normalizeConfig(row.config, brandName));
          setPosterId(row.id);
        }
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, brandName]);

  const meta = cfg.meta ?? {};
  const effectiveUrl = typeof qrUrl === 'function' ? qrUrl(meta) : qrUrl;

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

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const row = await api<any>(`/qr-posters/by-type/${type}`, {
        method: 'PUT',
        body: JSON.stringify({ name: '', config: cfg }),
      });
      setPosterId(row.id);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2500);
    } catch (e: any) {
      setSaveError(
        e?.message?.toString() ||
          'No se pudo guardar. Revisá tu conexión y volvé a intentar.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!confirm('¿Descartar cambios y volver al diseño por defecto?')) return;
    if (posterId) {
      try {
        await api(`/qr-posters/by-type/${type}`, { method: 'DELETE' });
      } catch {}
    }
    replaceHistory(defaultConfig(brandName));
    setPosterId(null);
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
    try {
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
      setExporting(null);
    }
  }

  // ───────── Patches & ops ───────── //

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
    setCfg((c) => ({ ...c, icons: [...(c.icons ?? []), newIcon] }));
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
    setCfg((c) => ({ ...c, images: [...(c.images ?? []), newImg] }));
  }
  function removeImage(id: string) {
    setCfg((c) => ({
      ...c,
      images: (c.images ?? []).filter((im) => im.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `image.${id}`),
    }));
  }
  function addPattern(emojis: string[]) {
    const id = newId();
    const newPat: PatternLayer = {
      id,
      emojis: emojis.length ? emojis : ['✨'],
      size: 64,
      gap: 32,
      opacity: 0.5,
      rotation: 0,
      density: 1,
      fullCanvas: true,
      seed: Math.floor(Math.random() * 100000),
    };
    setCfg((c) => ({ ...c, patterns: [...(c.patterns ?? []), newPat] }));
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

  if (loading) {
    return <div className="text-mute py-8 text-center">Cargando editor…</div>;
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
            <button onClick={save} disabled={saving} className="btn-primary flex-1 disabled:opacity-50">
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
          {savedAt && !saveError && (
            <div className="text-[11px] text-emerald-600 font-semibold">
              ✓ Guardado
            </div>
          )}
          {saveError && (
            <div className="text-[11px] text-red-600 leading-relaxed bg-red-50 border border-red-200 rounded px-2 py-1.5">
              ✕ {saveError}
            </div>
          )}
          <div className="text-[11px] text-mute leading-relaxed">
            Arrastrá cualquier elemento en el canvas — las guías rosa
            te ayudan a centrar. ⌘Z para deshacer.
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
                onClick={() => setCfg((c) => applyTemplate(c, tpl))}
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
        </Section>

        {/* Textos */}
        {(['title', 'subtitle', 'cta', 'brand'] as const).map((key) => (
          <Section key={key} title={LAYER_LABELS[key]} icon="🅣">
            <input
              type="text"
              className="input text-sm"
              value={cfg.texts[key].text}
              onChange={(e) => patchText(key, { text: e.target.value })}
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
            <SelectRow
              label="Alineación"
              value={cfg.texts[key].align}
              options={[
                { label: 'Izq.', value: 'left' },
                { label: 'Centro', value: 'center' },
                { label: 'Der.', value: 'right' },
              ]}
              onChange={(v) => patchText(key, { align: v as any })}
            />
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
          </Section>
        ))}

        {/* Tamaño de lienzo + DPI */}
        <CanvasSection cfg={cfg} setCfg={setCfg} />

        {/* Logo */}
        <Section title="Logo del negocio" icon="🏷️">
          {!logoUrl ? (
            <div className="text-[11px] text-mute leading-relaxed">
              Cargá tu logo en{' '}
              <a href="/app/settings" className="text-brand underline">
                Configuraciones
              </a>{' '}
              para poder usarlo como capa.
            </div>
          ) : (
            <>
              <button
                onClick={toggleLogo}
                className={`w-full text-xs px-2 py-2 rounded-lg border-2 transition ${
                  cfg.logo
                    ? 'border-brand bg-brand-soft text-brand-700 font-semibold'
                    : 'border-line hover:border-mute'
                }`}
              >
                {cfg.logo ? '✓ Logo activo (tocá para quitar)' : '+ Agregar logo'}
              </button>
              {cfg.logo && (
                <>
                  <NumberRow
                    label="Tamaño"
                    value={cfg.logo.size}
                    min={60}
                    max={600}
                    step={10}
                    onChange={(v) => patchLogo({ size: v })}
                  />
                  <PositionRow
                    x={cfg.logo.x}
                    y={cfg.logo.y}
                    onChange={(x, y) => patchLogo({ x, y })}
                  />
                  <OpacityRow
                    value={cfg.logo.opacity ?? 1}
                    onChange={(v) => patchLogo({ opacity: v })}
                  />
                </>
              )}
            </>
          )}
        </Section>

        {/* Imágenes (reemplaza Formas) */}
        <ImagesSection
          images={cfg.images ?? []}
          onAdd={addImageFromDataUrl}
          onPatch={patchImage}
          onRemove={removeImage}
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
                        <Group key="bg" listening={false}>
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
                      const handlers = makeDragHandlers(
                        'qr',
                        { x: cfg.qr.x, y: cfg.qr.y, w: cfg.qr.size, h: cfg.qr.size },
                        (x, y) =>
                          setCfg((c) => ({ ...c, qr: { ...c.qr, x, y } })),
                      );
                      return (
                        <KonvaImage
                          key="qr"
                          image={qrImage}
                          x={cfg.qr.x}
                          y={cfg.qr.y}
                          width={cfg.qr.size}
                          height={cfg.qr.size}
                          opacity={cfg.qr.opacity ?? 1}
                          draggable
                          {...handlers}
                        />
                      );
                    }
                    if (id === 'logo') {
                      if (!cfg.logo || !logoImage) return null;
                      const handlers = makeDragHandlers(
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
                          draggable
                          {...handlers}
                        />
                      );
                    }
                    if (id.startsWith('text.')) {
                      const key = id.slice(5) as keyof QrPosterConfig['texts'];
                      const t = cfg.texts[key];
                      if (!t) return null;
                      const isFullWidth =
                        t.align === 'center' || t.align === 'right';
                      const approxW = Math.max(t.size * (t.text.length * 0.5), t.size);
                      const handlers = makeDragHandlers(
                        `text.${key}`,
                        {
                          x: isFullWidth ? 0 : t.x,
                          y: t.y,
                          w: isFullWidth ? cfg.canvas.w : approxW,
                          h: t.size,
                        },
                        (x, y) => {
                          const nx = isFullWidth ? t.x : x;
                          patchText(key, { x: nx, y });
                        },
                      );
                      return (
                        <Text
                          key={id}
                          text={t.text}
                          x={isFullWidth ? 0 : t.x}
                          y={t.y}
                          width={isFullWidth ? cfg.canvas.w : undefined}
                          fontFamily={t.font}
                          fontSize={t.size}
                          fontStyle={t.weight >= 700 ? 'bold' : 'normal'}
                          fill={t.color}
                          align={t.align}
                          opacity={t.opacity ?? 1}
                          rotation={t.rotation ?? 0}
                          draggable
                          {...handlers}
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
                      // Deprecated pero seguimos renderizando para que
                      // posters viejos sigan funcionando.
                      const sid = id.slice(6);
                      const s = cfg.shapes?.find((sh) => sh.id === sid);
                      if (!s) return null;
                      const handlers = makeDragHandlers(
                        `shape.${sid}`,
                        { x: s.x, y: s.y, w: s.w, h: s.h },
                        (x, y) => patchShape(sid, { x, y }),
                      );
                      const common = {
                        fill: s.fill,
                        opacity: s.opacity ?? 1,
                        stroke: s.stroke,
                        strokeWidth: s.strokeWidth ?? 0,
                        draggable: true,
                      };
                      return s.type === 'circle' ? (
                        <Circle
                          key={id}
                          x={s.x + s.w / 2}
                          y={s.y + s.w / 2}
                          radius={s.w / 2}
                          {...common}
                          onDragMove={(e) => {
                            // Konva.Circle expone su CENTRO como x/y, no
                            // el top-left como Rect. Convertimos a
                            // top-left antes de computeSnap, sino el
                            // snap queda desfasado por el radio.
                            const cx = e.target.x();
                            const cy = e.target.y();
                            const newBox = {
                              x: cx - s.w / 2,
                              y: cy - s.w / 2,
                              w: s.w,
                              h: s.w,
                            };
                            const others = gatherSnapTargets(cfg);
                            const snap = computeSnap(
                              newBox,
                              others,
                              cfg.canvas.w,
                              cfg.canvas.h,
                              `shape.${sid}`,
                            );
                            if (snap.x !== newBox.x) e.target.x(snap.x + s.w / 2);
                            if (snap.y !== newBox.y) e.target.y(snap.y + s.w / 2);
                            setGuides(snap.guides);
                          }}
                          onDragEnd={(e) => {
                            patchShape(sid, {
                              x: e.target.x() - s.w / 2,
                              y: e.target.y() - s.w / 2,
                            });
                            setGuides([]); // sin esto las guías quedan visibles
                          }}
                        />
                      ) : (
                        <Rect
                          key={id}
                          x={s.x}
                          y={s.y}
                          width={s.w}
                          height={s.h}
                          cornerRadius={s.borderRadius ?? 0}
                          {...common}
                          {...handlers}
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
                      const handlers = makeDragHandlers(
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
                          draggable
                          {...handlers}
                        />
                      );
                    }
                    return null;
                  })}
                </Group>
                {/* Smart guides — siempre encima del contenido. */}
                {guides.map((g, idx) =>
                  g.type === 'v' ? (
                    <Line
                      key={`g-${idx}`}
                      points={[g.value, 0, g.value, cfg.canvas.h]}
                      stroke="#EC4899"
                      strokeWidth={1.5}
                      dash={[6, 4]}
                      listening={false}
                    />
                  ) : (
                    <Line
                      key={`g-${idx}`}
                      points={[0, g.value, cfg.canvas.w, g.value]}
                      stroke="#EC4899"
                      strokeWidth={1.5}
                      dash={[6, 4]}
                      listening={false}
                    />
                  ),
                )}
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
function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const grouped = useMemo(() => {
    const out: Record<FontOption['category'], FontOption[]> = {
      sans: [],
      serif: [],
      display: [],
      handwriting: [],
      mono: [],
    };
    for (const f of FONT_OPTIONS) out[f.category].push(f);
    return out;
  }, []);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input text-sm"
      style={{ fontFamily: value }}
    >
      {(Object.keys(grouped) as FontOption['category'][]).map((cat) => (
        <optgroup key={cat} label={FONT_CATEGORY_LABELS[cat]}>
          {grouped[cat].map((o) => (
            <option key={o.label} value={o.value} style={{ fontFamily: o.value }}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
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
    return s.type === 'rect' ? '▭ Rectángulo' : '◯ Círculo';
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
    return `${p.emojis.join('')} Patrón`;
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
          <NumberRow
            label="Ángulo"
            value={bg.angle}
            min={0}
            max={360}
            step={5}
            onChange={(v) => onChange({ angle: v })}
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

  return (
    <Section title="Tamaño y resolución" icon="📐">
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

/** Render de un ImageLayer libre. Maneja carga async de la URL. */
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
  const handlers = makeHandlers(
    { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
    onMove,
  );
  return (
    <KonvaImage
      image={img}
      x={layer.x}
      y={layer.y}
      width={layer.w}
      height={layer.h}
      opacity={layer.opacity ?? 1}
      rotation={layer.rotation ?? 0}
      draggable
      {...handlers}
    />
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
        const emoji = layer.emojis[i % layer.emojis.length];
        out.push({ x, y, emoji, rot: layer.rotation });
        i++;
      }
    }
    return out;
  }, [layer, canvasW, canvasH]);

  return (
    <Group opacity={layer.opacity} listening={false}>
      {cells.map((c, idx) => (
        <Text
          key={idx}
          text={c.emoji}
          x={c.x}
          y={c.y}
          fontSize={layer.size}
          rotation={c.rot}
        />
      ))}
    </Group>
  );
}

/** Upload + lista de imágenes libres. Reemplaza la sección "Formas". */
function ImagesSection({
  images,
  onAdd,
  onPatch,
  onRemove,
}: {
  images: ImageLayer[];
  onAdd: (dataUrl: string, w: number, h: number) => void;
  onPatch: (id: string, patch: Partial<ImageLayer>) => void;
  onRemove: (id: string) => void;
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

  return (
    <Section title="Imágenes" icon="🖼️" defaultOpen={images.length > 0}>
      <label
        htmlFor="image-layer-upload"
        className="w-full block text-center cursor-pointer text-xs px-2 py-3 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
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
                <span className="text-xs flex-1 truncate">Imagen</span>
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
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Generador de patrones con emojis. */
function PatternsSection({
  patterns,
  onAdd,
  onPatch,
  onRemove,
}: {
  patterns: PatternLayer[];
  onAdd: (emojis: string[]) => void;
  onPatch: (id: string, patch: Partial<PatternLayer>) => void;
  onRemove: (id: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [draftEmojis, setDraftEmojis] = useState<string[]>(['🍪', '☕']);

  function commit() {
    onAdd(draftEmojis);
    setDraftEmojis(['🍪', '☕']);
    setPicking(false);
  }

  return (
    <Section title="Patrones" icon="✨" defaultOpen={patterns.length > 0}>
      {!picking ? (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="w-full text-xs px-2 py-3 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
        >
          + Generar patrón con emojis
        </button>
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
                <span className="text-base">{p.emojis.join('')}</span>
                <span className="text-xs flex-1">Patrón</span>
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
