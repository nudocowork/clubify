'use client';
/**
 * Editor visual de carteles QR. Konva-based (canvas) — solo client.
 * H2: canvas + sidebar de propiedades + preview realtime + persistencia
 * via PUT /qr-posters/by-type/:type. Export PNG/PDF llega en H3, drag &
 * drop libre y undo/redo en H6.
 */
import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import {
  Stage,
  Layer,
  Rect,
  Circle,
  Group,
  Text,
  Image as KonvaImage,
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
  type LayerId,
  FONT_OPTIONS,
  CANVAS_PRESETS,
  ICON_EMOJI_CATALOG,
  defaultConfig,
  normalizeConfig,
  effectiveLayerOrder,
  rescaleForCanvas,
} from '@/lib/marketing/qr-poster-config';
import { QR_TEMPLATES, applyTemplate } from '@/lib/marketing/qr-templates';

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
   *  QR Mostrador, input de código para QR Descuento, etc). Recibe el
   *  meta actual y un setter para actualizarlo en el config. */
  metaSlot?: (
    meta: Record<string, any>,
    setMeta: (m: Record<string, any>) => void,
  ) => React.ReactNode;
};

const STAGE_MAX_DISPLAY_W = 540; // px en pantalla; el canvas interno es 1080+

// Carga las Google Fonts una sola vez por sesión para que Konva las
// renderice con la familia correcta. Si la red está caída, fallback al
// system font sin romper el editor.
let fontsLoaded = false;
function ensureFontsLoaded() {
  if (typeof document === 'undefined' || fontsLoaded) return;
  fontsLoaded = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700;900&family=Montserrat:wght@400;600;700;900&family=Playfair+Display:wght@400;700;900&family=Poppins:wght@400;600;700;900&display=swap';
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

/** Carga una imagen HTTP/HTTPS (logo del tenant). Distinto de
 *  useImageFromDataUrl porque setea crossOrigin para que Konva pueda
 *  exportarla sin tainting el canvas (necesario para PNG/PDF export). */
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

/** Convierte el BgConfig a un fill que Konva entiende. Para gradientes
 *  retorna las props específicas que se setean en el Rect. */
function rectFillProps(bg: BgConfig, w: number, h: number) {
  if (bg.type === 'solid') return { fill: bg.color1 };
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
  };
}

// Tope de history para evitar uso desmedido de memoria. ~50 acciones es
// suficiente para flujos típicos de diseño; pisar entradas viejas es un
// trade-off aceptable.
const HISTORY_MAX = 50;

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

  /** Push de un nuevo cfg al history. Trunca la rama "redo" si estábamos
   *  parados en el medio. Caps a HISTORY_MAX. */
  function setCfg(
    updater: ((c: QrPosterConfig) => QrPosterConfig) | QrPosterConfig,
  ) {
    setHist((s) => {
      const current = s.history[s.idx];
      const next =
        typeof updater === 'function'
          ? (updater as (c: QrPosterConfig) => QrPosterConfig)(current)
          : updater;
      // Si no cambia nada, no pushear (evita ruido en undo/redo)
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

  /** Reemplaza el history entero — usado al cargar del backend o al
   *  resetear a defaults. No queda nada para "deshacer" hacia atrás. */
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const [stageWidth, setStageWidth] = useState(STAGE_MAX_DISPLAY_W);

  useEffect(() => {
    ensureFontsLoaded();
  }, []);

  // Cargar config persistido del backend al montar
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

  // URL efectiva del QR. Si qrUrl es función, la llamamos con el meta
  // type-specific actual (cardId, promoCode, etc).
  const meta = cfg.meta ?? {};
  const effectiveUrl = typeof qrUrl === 'function' ? qrUrl(meta) : qrUrl;

  // Regenerar QR cuando cambia url efectiva / colores / size
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

  // Responsive: ajusta el ancho del stage al container
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

  // Keyboard shortcuts: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;
      // Ignorar si el target es un input/textarea/select — el browser
      // tiene su propio undo nativo ahí
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Export a calidad imprenta. Konva.Stage.toDataURL respeta el scale
   * actual del stage — calculamos pixelRatio para que el output alcance
   * 300 DPI sobre el tamaño físico (mm) del preset. No mutamos el stage,
   * así no hay flicker en el preview.
   */
  async function doExport(kind: 'png' | 'jpg' | 'pdf') {
    const stage = stageRef.current;
    if (!stage) return;
    setExporting(kind);
    // Frame para que el spinner pinte antes de bloquear el thread con el render
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      const mm = cfg.canvas.mm ?? { w: 210, h: 297 };
      // 300 DPI = 11.811 px/mm
      const targetPxW = mm.w * 11.811;
      const pixelRatio = Math.max(1, targetPxW / stage.width());

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
  function patchLogo(patch: Partial<NonNullable<QrPosterConfig['logo']>>) {
    setCfg((c) => ({
      ...c,
      logo: c.logo ? { ...c.logo, ...patch } : c.logo,
    }));
  }
  function addShape(type: 'rect' | 'circle') {
    const id = newId();
    const newShape: ShapeLayer = {
      id,
      type,
      x: 200,
      y: 200,
      w: type === 'circle' ? 200 : 400,
      h: type === 'circle' ? 200 : 200,
      fill: '#3B82F6',
      opacity: 1,
      borderRadius: type === 'rect' ? 0 : undefined,
    };
    setCfg((c) => ({ ...c, shapes: [...(c.shapes ?? []), newShape] }));
  }
  function removeShape(id: string) {
    setCfg((c) => ({
      ...c,
      shapes: (c.shapes ?? []).filter((s) => s.id !== id),
      layerOrder: c.layerOrder?.filter((lid) => lid !== `shape.${id}`),
    }));
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

  if (loading) {
    return <div className="text-mute py-8 text-center">Cargando editor…</div>;
  }

  const bgFill = rectFillProps(cfg.bg, cfg.canvas.w, cfg.canvas.h);
  const layerOrder = effectiveLayerOrder(cfg);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
      {/* ─────────────────────── Sidebar de propiedades ─────────────────────── */}
      <div className="space-y-4 lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto lg:pr-2">
        {/* Slot type-specific (selector de card para Mostrador, código
            promo para Descuento, etc). Va arriba para que sea lo primero
            que el dueño configure. */}
        {metaSlot &&
          metaSlot(meta, (m) => setCfg((c) => ({ ...c, meta: m })))}

        {/* QR dinámico: comunica visualmente que el QR sigue funcionando
            aunque cambie el menú/wallet/reseñas del tenant. La URL apunta
            a slugs estables, no IDs efímeros. */}
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
            Arrastrá los elementos directamente en el canvas para moverlos.
            ⌘Z para deshacer.
          </div>
        </div>

        {/* Export imprenta */}
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
              onClick={() => doExport('png')}
            />
            <ExportButton
              label="JPG"
              hint="Liviano"
              busy={exporting === 'jpg'}
              disabled={!!exporting}
              onClick={() => doExport('jpg')}
            />
            <ExportButton
              label="PDF"
              hint="Imprenta"
              busy={exporting === 'pdf'}
              disabled={!!exporting}
              onClick={() => doExport('pdf')}
            />
          </div>
          <div className="text-[11px] text-mute leading-relaxed">
            Calidad imprenta: 300 DPI sobre {cfg.canvas.mm?.w ?? 210}×
            {cfg.canvas.mm?.h ?? 297} mm.
          </div>
        </div>

        {/* Templates prediseñados */}
        <Section title="Templates">
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
          <div className="text-[10px] text-mute mt-2 leading-relaxed">
            Aplicar un template cambia colores, fuentes y copy. Tu canvas y
            posiciones se mantienen.
          </div>
        </Section>

        {/* Fondo */}
        <Section title="Fondo">
          <div className="flex gap-2">
            <Toggle
              active={cfg.bg.type === 'solid'}
              onClick={() =>
                setCfg((c) => ({
                  ...c,
                  bg:
                    c.bg.type === 'solid'
                      ? c.bg
                      : { type: 'solid', color1: c.bg.color1 },
                }))
              }
            >
              Sólido
            </Toggle>
            <Toggle
              active={cfg.bg.type === 'gradient'}
              onClick={() =>
                setCfg((c) => ({
                  ...c,
                  bg:
                    c.bg.type === 'gradient'
                      ? c.bg
                      : {
                          type: 'gradient',
                          color1: c.bg.color1,
                          color2: '#4ADE80',
                          angle: 135,
                        },
                }))
              }
            >
              Gradiente
            </Toggle>
          </div>
          <ColorRow
            label="Color 1"
            value={cfg.bg.color1}
            onChange={(v) =>
              setCfg((c) => ({ ...c, bg: { ...c.bg, color1: v } }))
            }
          />
          {cfg.bg.type === 'gradient' && (
            <>
              <ColorRow
                label="Color 2"
                value={cfg.bg.color2}
                onChange={(v) =>
                  setCfg((c) => ({
                    ...c,
                    bg: { ...(c.bg as any), color2: v },
                  }))
                }
              />
              <NumberRow
                label="Ángulo"
                value={cfg.bg.angle}
                min={0}
                max={360}
                step={5}
                onChange={(v) =>
                  setCfg((c) => ({ ...c, bg: { ...(c.bg as any), angle: v } }))
                }
              />
            </>
          )}
        </Section>

        {/* QR */}
        <Section title="QR">
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
            label="Color QR"
            value={cfg.qr.fg}
            onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, fg: v } }))}
          />
          <ColorRow
            label="Fondo QR"
            value={cfg.qr.bg}
            onChange={(v) => setCfg((c) => ({ ...c, qr: { ...c.qr, bg: v } }))}
          />
          <OpacityRow
            value={cfg.qr.opacity ?? 1}
            onChange={(v) =>
              setCfg((c) => ({ ...c, qr: { ...c.qr, opacity: v } }))
            }
          />
        </Section>

        {/* Textos */}
        {(['title', 'subtitle', 'cta', 'brand'] as const).map((key) => (
          <Section key={key} title={LAYER_LABELS[key]}>
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
                max={140}
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
            <OpacityRow
              value={cfg.texts[key].opacity ?? 1}
              onChange={(v) => patchText(key, { opacity: v })}
            />
          </Section>
        ))}

        {/* Tamaño de lienzo */}
        <Section title="Tamaño de lienzo">
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
                      ...rescaleForCanvas(c, { w: p.w, h: p.h, mm: p.mm }),
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
        </Section>

        {/* Logo */}
        <Section title="Logo del negocio">
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

        {/* Iconos (emoji) */}
        <Section title="Iconos">
          <div className="text-[10px] text-mute mb-1.5">
            Tocá un emoji para agregarlo al cartel. Después lo arrastrás y
            redimensionás.
          </div>
          <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
            {ICON_EMOJI_CATALOG.map((group) => (
              <div key={group.group}>
                <div className="text-[10px] text-mute mb-0.5 font-semibold">
                  {group.group}
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.emojis.map((e) => (
                    <button
                      key={e}
                      onClick={() => addIcon(e)}
                      className="text-xl hover:bg-bg2 rounded p-1 transition"
                      title={`Agregar ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {(cfg.icons ?? []).length > 0 && (
            <div className="border-t border-line pt-2 mt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Iconos agregados
              </div>
              {(cfg.icons ?? []).map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-2 bg-bg2/40 rounded p-1.5"
                >
                  <span className="text-xl">{i.emoji}</span>
                  <input
                    type="number"
                    value={i.size}
                    min={20}
                    max={400}
                    step={10}
                    onChange={(e) =>
                      patchIcon(i.id, { size: Number(e.target.value) })
                    }
                    className="input text-xs w-[60px]"
                    title="Tamaño"
                  />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={i.opacity ?? 1}
                    onChange={(e) =>
                      patchIcon(i.id, { opacity: Number(e.target.value) })
                    }
                    className="flex-1 accent-brand"
                    title="Opacidad"
                  />
                  <button
                    onClick={() => removeIcon(i.id)}
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

        {/* Formas */}
        <Section title="Formas">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => addShape('rect')}
              className="text-xs px-2 py-2 rounded-lg border-2 border-line hover:border-brand transition"
            >
              ▭ Rectángulo
            </button>
            <button
              onClick={() => addShape('circle')}
              className="text-xs px-2 py-2 rounded-lg border-2 border-line hover:border-brand transition"
            >
              ◯ Círculo
            </button>
          </div>
          {(cfg.shapes ?? []).length > 0 && (
            <div className="border-t border-line pt-2 mt-2 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
                Formas agregadas
              </div>
              {(cfg.shapes ?? []).map((s) => (
                <div key={s.id} className="bg-bg2/40 rounded p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1">
                      {s.type === 'rect' ? '▭ Rectángulo' : '◯ Círculo'}
                    </span>
                    <button
                      onClick={() => removeShape(s.id)}
                      className="text-mute hover:text-red-500 text-xs"
                      title="Eliminar"
                    >
                      ✕
                    </button>
                  </div>
                  <ColorRow
                    label="Relleno"
                    value={s.fill}
                    onChange={(v) => patchShape(s.id, { fill: v })}
                  />
                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberRow
                      label={s.type === 'circle' ? 'Diám' : 'Ancho'}
                      value={s.w}
                      min={20}
                      max={1200}
                      step={10}
                      onChange={(v) => patchShape(s.id, { w: v })}
                    />
                    {s.type === 'rect' && (
                      <NumberRow
                        label="Alto"
                        value={s.h}
                        min={20}
                        max={1200}
                        step={10}
                        onChange={(v) => patchShape(s.id, { h: v })}
                      />
                    )}
                  </div>
                  {s.type === 'rect' && (
                    <NumberRow
                      label="Esquinas"
                      value={s.borderRadius ?? 0}
                      min={0}
                      max={200}
                      step={5}
                      onChange={(v) =>
                        patchShape(s.id, { borderRadius: v })
                      }
                    />
                  )}
                  <OpacityRow
                    value={s.opacity ?? 1}
                    onChange={(v) => patchShape(s.id, { opacity: v })}
                  />
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Capas (z-index) */}
        <Section title="Capas">
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
                        <Rect
                          key="bg"
                          x={0}
                          y={0}
                          width={cfg.canvas.w}
                          height={cfg.canvas.h}
                          listening={false}
                          {...bgFill}
                        />
                      );
                    }
                    if (id === 'qr') {
                      if (!qrImage) return null;
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
                          onDragEnd={(e) => {
                            const nx = e.target.x();
                            const ny = e.target.y();
                            setCfg((c) => ({
                              ...c,
                              qr: { ...c.qr, x: nx, y: ny },
                            }));
                          }}
                        />
                      );
                    }
                    if (id === 'logo') {
                      if (!cfg.logo || !logoImage) return null;
                      return (
                        <KonvaImage
                          key="logo"
                          image={logoImage}
                          x={cfg.logo.x}
                          y={cfg.logo.y}
                          width={cfg.logo.size}
                          height={cfg.logo.size}
                          opacity={cfg.logo.opacity ?? 1}
                          draggable
                          onDragEnd={(e) =>
                            patchLogo({ x: e.target.x(), y: e.target.y() })
                          }
                        />
                      );
                    }
                    if (id.startsWith('text.')) {
                      const key = id.slice(5) as keyof QrPosterConfig['texts'];
                      const t = cfg.texts[key];
                      if (!t) return null;
                      const isFullWidth =
                        t.align === 'center' || t.align === 'right';
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
                          draggable
                          dragBoundFunc={(pos) => ({
                            x: isFullWidth ? 0 : pos.x,
                            y: pos.y,
                          })}
                          onDragEnd={(e) => {
                            const ny = e.target.y();
                            const nx = isFullWidth ? t.x : e.target.x();
                            patchText(key, { x: nx, y: ny });
                          }}
                        />
                      );
                    }
                    if (id === 'footer') {
                      return (
                        <Text
                          key="footer"
                          text="Powered by Clubify"
                          x={0}
                          y={cfg.canvas.h - 60}
                          width={cfg.canvas.w}
                          fontFamily="Inter, system-ui, sans-serif"
                          fontSize={22}
                          fill={
                            cfg.bg.type === 'solid' &&
                            cfg.bg.color1.toUpperCase() === '#FFFFFF'
                              ? '#9CA3AF'
                              : 'rgba(255,255,255,0.75)'
                          }
                          align="center"
                          listening={false}
                        />
                      );
                    }
                    if (id.startsWith('shape.')) {
                      const sid = id.slice(6);
                      const s = cfg.shapes?.find((sh) => sh.id === sid);
                      if (!s) return null;
                      const common = {
                        fill: s.fill,
                        opacity: s.opacity ?? 1,
                        stroke: s.stroke,
                        strokeWidth: s.strokeWidth ?? 0,
                        draggable: true,
                        onDragEnd: (e: any) =>
                          patchShape(sid, {
                            x: e.target.x(),
                            y: e.target.y(),
                          }),
                      };
                      return s.type === 'circle' ? (
                        <Circle
                          key={id}
                          x={s.x + s.w / 2}
                          y={s.y + s.w / 2}
                          radius={s.w / 2}
                          {...common}
                          onDragEnd={(e: any) =>
                            patchShape(sid, {
                              x: e.target.x() - s.w / 2,
                              y: e.target.y() - s.w / 2,
                            })
                          }
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
                        />
                      );
                    }
                    if (id.startsWith('icon.')) {
                      const iid = id.slice(5);
                      const i = cfg.icons?.find((ic) => ic.id === iid);
                      if (!i) return null;
                      return (
                        <Text
                          key={id}
                          text={i.emoji}
                          x={i.x}
                          y={i.y}
                          fontSize={i.size}
                          opacity={i.opacity ?? 1}
                          draggable
                          onDragEnd={(e) =>
                            patchIcon(iid, {
                              x: e.target.x(),
                              y: e.target.y(),
                            })
                          }
                        />
                      );
                    }
                    return null;
                  })}
                </Group>
              </Layer>
            </Stage>
          </div>
          <div className="text-[11px] text-mute mt-3 text-center">
            Tamaño real: {cfg.canvas.w} × {cfg.canvas.h} px
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {title}
      </div>
      {children}
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

/** Label legible para cada LayerId en el panel "Capas". Para shapes e
 *  iconos devuelve el tipo + un preview del contenido. */
function layerLabel(id: LayerId, cfg: QrPosterConfig): string | null {
  if (id === 'bg') return 'Fondo';
  if (id === 'qr') return 'Código QR';
  if (id === 'logo') return cfg.logo ? 'Logo' : null;
  if (id === 'footer') return 'Pie "Powered by Clubify"';
  if (id === 'text.title') return `Título: ${cfg.texts.title.text || ''}`;
  if (id === 'text.subtitle')
    return `Subtítulo: ${cfg.texts.subtitle.text || ''}`;
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
  return null;
}

function OpacityRow({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-mute w-[64px]">Opacidad</label>
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

function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input text-sm"
      style={{ fontFamily: value }}
    >
      {FONT_OPTIONS.map((o) => (
        <option key={o.label} value={o.value} style={{ fontFamily: o.value }}>
          {o.label}
        </option>
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

