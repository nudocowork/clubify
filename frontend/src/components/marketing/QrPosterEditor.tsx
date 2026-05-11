'use client';
/**
 * Editor visual de carteles QR. Konva-based (canvas) — solo client.
 * H2: canvas + sidebar de propiedades + preview realtime + persistencia
 * via PUT /qr-posters/by-type/:type. Export PNG/PDF llega en H3, drag &
 * drop libre y undo/redo en H6.
 */
import { useEffect, useRef, useState } from 'react';
import type Konva from 'konva';
import { Stage, Layer, Rect, Text, Image as KonvaImage } from 'react-konva';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import { api } from '@/lib/api';
import {
  type QrPosterConfig,
  type QrPosterType,
  type TextLayer,
  type BgConfig,
  FONT_OPTIONS,
  CANVAS_PRESETS,
  defaultConfig,
  normalizeConfig,
} from '@/lib/marketing/qr-poster-config';
import { QR_TEMPLATES, applyTemplate } from '@/lib/marketing/qr-templates';

type Props = {
  type: QrPosterType;
  /** URL destino del QR. String fijo o función que recibe el `meta`
   *  type-specific (cardId, promoCode, etc) y construye la URL. */
  qrUrl: string | ((meta: Record<string, any>) => string);
  /** Nombre del negocio — se usa como default del layer "brand". */
  brandName: string;
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

export default function QrPosterEditor({
  type,
  qrUrl,
  brandName,
  metaSlot,
}: Props) {
  const [cfg, setCfg] = useState<QrPosterConfig>(() => defaultConfig(brandName));
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [posterId, setPosterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
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
          setCfg(normalizeConfig(row.config, brandName));
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

  async function save() {
    setSaving(true);
    try {
      const row = await api<any>(`/qr-posters/by-type/${type}`, {
        method: 'PUT',
        body: JSON.stringify({ name: '', config: cfg }),
      });
      setPosterId(row.id);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2500);
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
    setCfg(defaultConfig(brandName));
    setPosterId(null);
  }

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

  if (loading) {
    return <div className="text-mute py-8 text-center">Cargando editor…</div>;
  }

  const bgFill = rectFillProps(cfg.bg, cfg.canvas.w, cfg.canvas.h);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-5">
      {/* ─────────────────────── Sidebar de propiedades ─────────────────────── */}
      <div className="space-y-4 lg:max-h-[calc(100vh-160px)] lg:overflow-y-auto lg:pr-2">
        {/* Slot type-specific (selector de card para Mostrador, código
            promo para Descuento, etc). Va arriba para que sea lo primero
            que el dueño configure. */}
        {metaSlot &&
          metaSlot(meta, (m) => setCfg((c) => ({ ...c, meta: m })))}
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
          {savedAt && (
            <div className="text-[11px] text-emerald-600 font-semibold">
              ✓ Guardado
            </div>
          )}
          <div className="text-[11px] text-mute">
            Los cambios se ven al instante en la vista derecha. Guardá para
            persistirlos.
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
          </Section>
        ))}

        {/* Tamaño de lienzo */}
        <Section title="Tamaño de lienzo">
          <div className="grid grid-cols-2 gap-2">
            {CANVAS_PRESETS.map((p) => {
              const active =
                cfg.canvas.w === p.w &&
                cfg.canvas.h === p.h &&
                cfg.canvas.mm?.w === p.mm.w &&
                cfg.canvas.mm?.h === p.mm.h;
              return (
                <button
                  key={p.label}
                  onClick={() =>
                    setCfg((c) => ({
                      ...c,
                      canvas: { w: p.w, h: p.h, mm: p.mm },
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
                <Rect
                  x={0}
                  y={0}
                  width={cfg.canvas.w}
                  height={cfg.canvas.h}
                  {...bgFill}
                />
                {qrImage && (
                  <KonvaImage
                    image={qrImage}
                    x={cfg.qr.x}
                    y={cfg.qr.y}
                    width={cfg.qr.size}
                    height={cfg.qr.size}
                  />
                )}
                {(['brand', 'title', 'subtitle', 'cta'] as const).map((k) => {
                  const t = cfg.texts[k];
                  return (
                    <Text
                      key={k}
                      text={t.text}
                      x={
                        t.align === 'center'
                          ? 0
                          : t.align === 'right'
                          ? 0
                          : t.x
                      }
                      y={t.y}
                      width={t.align === 'center' || t.align === 'right' ? cfg.canvas.w : undefined}
                      fontFamily={t.font}
                      fontSize={t.size}
                      fontStyle={t.weight >= 700 ? 'bold' : 'normal'}
                      fill={t.color}
                      align={t.align}
                    />
                  );
                })}
                <Text
                  text="Powered by Clubify"
                  x={0}
                  y={cfg.canvas.h - 60}
                  width={cfg.canvas.w}
                  fontFamily="Inter, system-ui, sans-serif"
                  fontSize={22}
                  fill={cfg.bg.type === 'solid' && cfg.bg.color1.toUpperCase() === '#FFFFFF' ? '#9CA3AF' : 'rgba(255,255,255,0.75)'}
                  align="center"
                />
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

