'use client';

import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_COVER_CONFIG,
  normalizeCoverConfig,
  type SectionCoverConfig,
  type CoverAlign,
  type CoverVerticalAlign,
  type CoverTextStyle,
} from '@/lib/menu/section-cover-config';
import {
  SECTION_COVER_TEMPLATES,
  SECTION_COVER_CATEGORY_LABELS,
  type SectionCoverTemplate,
} from '@/lib/menu/section-cover-templates';
import { SectionCoverPreview } from './SectionCoverPreview';
import { FONT_OPTIONS, FONT_CATEGORY_LABELS } from '@/lib/marketing/qr-poster-config';

/**
 * Editor visual de portadas de sección de menú.
 *
 * UI a 2 columnas:
 * - Izquierda: panel de controles (tabs Templates / Imagen / Texto /
 *   Layout / Overlay).
 * - Derecha: preview en vivo en frame mobile (360px).
 *
 * Reusa el catálogo FONT_OPTIONS del módulo marketing (125 fuentes
 * cargadas globalmente desde layout.tsx).
 *
 * Props:
 * - title: nombre actual de la sección (para preview, no edita aquí).
 * - tagline: subtítulo opcional (el dueño puede setearlo aparte en el
 *   panel admin — este editor solo controla el ESTILO del tagline).
 * - value: SectionCoverConfig actual (o null si nunca editó).
 * - onChange: callback con el nuevo config.
 * - onUpload: para subir imagen de fondo. Recibe File, devuelve URL.
 *   El consumer es responsable de subir a R2/storage.
 */
export function SectionCoverEditor({
  title,
  tagline,
  value,
  onChange,
  onUpload,
}: {
  title: string;
  tagline?: string | null;
  value: SectionCoverConfig | unknown;
  onChange: (config: SectionCoverConfig) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const [tab, setTab] = useState<
    'templates' | 'imagen' | 'texto' | 'layout' | 'overlay'
  >('templates');

  // Normalizamos el value al iniciar — soporta null o config raw.
  const cfg = normalizeCoverConfig(value);

  function patch(p: Partial<SectionCoverConfig>) {
    onChange({ ...cfg, ...p });
  }
  function patchTitle(p: Partial<CoverTextStyle>) {
    onChange({ ...cfg, title: { ...cfg.title, ...p } });
  }
  function patchTagline(p: Partial<CoverTextStyle>) {
    if (!cfg.tagline) return;
    onChange({ ...cfg, tagline: { ...cfg.tagline, ...p } });
  }
  function patchOverlay(p: Partial<NonNullable<SectionCoverConfig['overlay']>>) {
    if (!cfg.overlay) return;
    onChange({ ...cfg, overlay: { ...cfg.overlay, ...p } });
  }

  function applyTemplate(t: SectionCoverTemplate) {
    // Preservamos bgImageUrl actual (el dueño no quiere perder su
    // foto cuando cambia de template).
    onChange({ ...t.config, bgImageUrl: cfg.bgImageUrl });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-6">
      {/* Panel de controles */}
      <div className="space-y-3">
        <TabBar tab={tab} onChange={setTab} />

        {tab === 'templates' && (
          <TemplatesPanel onApply={applyTemplate} current={cfg} />
        )}
        {tab === 'imagen' && (
          <ImagePanel cfg={cfg} patch={patch} onUpload={onUpload} />
        )}
        {tab === 'texto' && (
          <TextPanel
            cfg={cfg}
            patch={patch}
            patchTitle={patchTitle}
            patchTagline={patchTagline}
          />
        )}
        {tab === 'layout' && <LayoutPanel cfg={cfg} patch={patch} />}
        {tab === 'overlay' && (
          <OverlayPanel cfg={cfg} patch={patch} patchOverlay={patchOverlay} />
        )}
      </div>

      {/* Preview mobile */}
      <div className="lg:sticky lg:top-4">
        <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2 text-center">
          Vista mobile
        </div>
        <div
          className="bg-bg2 rounded-2xl shadow-md p-2 mx-auto"
          style={{ width: 320 }}
        >
          <SectionCoverPreview
            config={cfg}
            title={title}
            tagline={tagline}
            scale={(320 - 16) / 360}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────

function TabBar({
  tab,
  onChange,
}: {
  tab: string;
  onChange: (t: any) => void;
}) {
  const tabs: { id: string; label: string; icon: string }[] = [
    { id: 'templates', label: 'Estilos', icon: '✨' },
    { id: 'imagen', label: 'Imagen', icon: '🖼️' },
    { id: 'texto', label: 'Texto', icon: '🔤' },
    { id: 'layout', label: 'Layout', icon: '📐' },
    { id: 'overlay', label: 'Overlay', icon: '🌗' },
  ];
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`whitespace-nowrap text-xs font-semibold px-3 py-2 rounded-t-lg border-b-2 transition ${
            tab === t.id
              ? 'text-brand border-brand bg-brand-soft/40'
              : 'text-mute border-transparent hover:text-ink'
          }`}
        >
          <span className="mr-1">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Templates picker ───────────────────────────────────────────────

function TemplatesPanel({
  onApply,
  current,
}: {
  onApply: (t: SectionCoverTemplate) => void;
  current: SectionCoverConfig;
}) {
  const [category, setCategory] = useState<
    SectionCoverTemplate['category'] | 'all'
  >('all');
  const filtered =
    category === 'all'
      ? SECTION_COVER_TEMPLATES
      : SECTION_COVER_TEMPLATES.filter((t) => t.category === category);

  return (
    <div className="space-y-3">
      <p className="text-xs text-mute">
        Elige un estilo base y luego ajusta los detalles en los otros tabs.
      </p>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <CategoryPill
          active={category === 'all'}
          onClick={() => setCategory('all')}
        >
          Todos
        </CategoryPill>
        {(
          Object.keys(SECTION_COVER_CATEGORY_LABELS) as SectionCoverTemplate['category'][]
        ).map((c) => (
          <CategoryPill
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
          >
            {SECTION_COVER_CATEGORY_LABELS[c]}
          </CategoryPill>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {filtered.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onApply(t)}
            className="text-left rounded-xl overflow-hidden border border-line hover:border-brand transition"
            title={t.name}
          >
            <div
              className="h-20 w-full"
              style={{
                background: `linear-gradient(135deg, ${t.swatch.from}, ${t.swatch.to})`,
              }}
            />
            <div className="px-2 py-1.5 bg-bg">
              <div className="text-[12px] font-semibold leading-tight">
                {t.name}
              </div>
              <div className="text-[10px] text-mute mt-0.5">
                {SECTION_COVER_CATEGORY_LABELS[t.category]}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CategoryPill({
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
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-bg2 text-ink border-line hover:border-brand/50'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Image panel ─────────────────────────────────────────────────────

function ImagePanel({
  cfg,
  patch,
  onUpload,
}: {
  cfg: SectionCoverConfig;
  patch: (p: Partial<SectionCoverConfig>) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !onUpload) return;
    setUploading(true);
    try {
      const url = await onUpload(f);
      patch({ bgImageUrl: url });
    } catch (err: any) {
      alert(`Error al subir imagen: ${err?.message ?? 'desconocido'}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-[11px] font-semibold text-mute uppercase tracking-wider">
          Imagen de fondo
        </label>
        {cfg.bgImageUrl ? (
          <div className="mt-1.5 space-y-2">
            <div className="relative rounded-lg overflow-hidden border border-line bg-bg2/40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cfg.bgImageUrl}
                alt="Fondo"
                className="w-full h-24 object-cover"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn btn-secondary text-xs flex-1"
                disabled={uploading}
              >
                Cambiar
              </button>
              <button
                type="button"
                onClick={() => patch({ bgImageUrl: null })}
                className="btn btn-secondary text-xs"
              >
                Quitar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-1.5 w-full text-center text-xs px-3 py-4 rounded-lg border-2 border-dashed border-line hover:border-brand transition"
            disabled={uploading}
          >
            {uploading ? 'Subiendo…' : '+ Subir imagen (JPG/PNG/WebP)'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFile}
          className="hidden"
        />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-mute uppercase tracking-wider">
          Color de fondo (sin imagen)
        </label>
        <input
          type="color"
          className="input h-10 mt-1.5 p-1 w-full"
          value={cfg.bgColor}
          onChange={(e) => patch({ bgColor: e.target.value })}
        />
      </div>

      <SelectRow
        label="Ajuste"
        value={cfg.bgFit}
        onChange={(v) => patch({ bgFit: v as any })}
        options={[
          { value: 'cover', label: 'Cubrir (recortar)' },
          { value: 'contain', label: 'Contener (todo visible)' },
        ]}
      />

      <SelectRow
        label="Posición"
        value={cfg.bgPosition}
        onChange={(v) => patch({ bgPosition: v as any })}
        options={[
          { value: 'center', label: 'Centro' },
          { value: 'top', label: 'Arriba' },
          { value: 'bottom', label: 'Abajo' },
          { value: 'left', label: 'Izquierda' },
          { value: 'right', label: 'Derecha' },
        ]}
      />
    </div>
  );
}

// ─── Text panel ──────────────────────────────────────────────────────

function TextPanel({
  cfg,
  patch,
  patchTitle,
  patchTagline,
}: {
  cfg: SectionCoverConfig;
  patch: (p: Partial<SectionCoverConfig>) => void;
  patchTitle: (p: Partial<CoverTextStyle>) => void;
  patchTagline: (p: Partial<CoverTextStyle>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-[11px] font-semibold text-mute uppercase tracking-wider">
          Título (nombre de la sección)
        </div>
        <FontPicker
          value={cfg.title.fontFamily}
          onChange={(v) => patchTitle({ fontFamily: v })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberRow
            label="Tamaño"
            value={cfg.title.fontSize}
            min={14}
            max={72}
            onChange={(v) => patchTitle({ fontSize: v })}
          />
          <SelectRow
            label="Peso"
            value={String(cfg.title.fontWeight)}
            onChange={(v) => patchTitle({ fontWeight: Number(v) })}
            options={[
              { value: '400', label: '400 — normal' },
              { value: '500', label: '500 — medio' },
              { value: '600', label: '600 — semi' },
              { value: '700', label: '700 — bold' },
              { value: '900', label: '900 — black' },
            ]}
          />
        </div>
        <ColorRow
          label="Color"
          value={cfg.title.color}
          onChange={(v) => patchTitle({ color: v })}
        />
        <SelectRow
          label="Mayúsculas"
          value={cfg.title.transform ?? 'none'}
          onChange={(v) => patchTitle({ transform: v as any })}
          options={[
            { value: 'none', label: 'Normal' },
            { value: 'uppercase', label: 'MAYÚSCULAS' },
            { value: 'lowercase', label: 'minúsculas' },
          ]}
        />
      </div>

      <div className="space-y-2 pt-3 border-t border-line">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-mute uppercase tracking-wider">
            Subtítulo (tagline)
          </div>
          <Toggle
            on={!!cfg.tagline}
            onChange={(on) => {
              if (on) {
                patch({
                  tagline: {
                    color: 'rgba(255,255,255,0.85)',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    fontWeight: 400,
                    fontSize: 14,
                    letterSpacing: 0,
                    lineHeight: 1.4,
                    shadow: null,
                    transform: 'none',
                  },
                });
              } else {
                patch({ tagline: null });
              }
            }}
          />
        </div>
        {cfg.tagline && (
          <>
            <FontPicker
              value={cfg.tagline.fontFamily}
              onChange={(v) => patchTagline({ fontFamily: v })}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberRow
                label="Tamaño"
                value={cfg.tagline.fontSize}
                min={10}
                max={28}
                onChange={(v) => patchTagline({ fontSize: v })}
              />
              <SelectRow
                label="Peso"
                value={String(cfg.tagline.fontWeight)}
                onChange={(v) => patchTagline({ fontWeight: Number(v) })}
                options={[
                  { value: '400', label: '400' },
                  { value: '500', label: '500' },
                  { value: '600', label: '600' },
                  { value: '700', label: '700' },
                ]}
              />
            </div>
            <ColorRow
              label="Color"
              value={cssToHex(cfg.tagline.color)}
              onChange={(v) => patchTagline({ color: v })}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Layout panel ────────────────────────────────────────────────────

function LayoutPanel({
  cfg,
  patch,
}: {
  cfg: SectionCoverConfig;
  patch: (p: Partial<SectionCoverConfig>) => void;
}) {
  return (
    <div className="space-y-3">
      <NumberRow
        label="Altura del banner (px)"
        value={cfg.height}
        min={140}
        max={400}
        step={10}
        onChange={(v) => patch({ height: v })}
      />
      <NumberRow
        label="Bordes redondeados (px)"
        value={cfg.borderRadius}
        min={0}
        max={32}
        step={2}
        onChange={(v) => patch({ borderRadius: v })}
      />
      <SelectRow
        label="Alineación horizontal"
        value={cfg.align}
        onChange={(v) => patch({ align: v as CoverAlign })}
        options={[
          { value: 'left', label: 'Izquierda' },
          { value: 'center', label: 'Centro' },
          { value: 'right', label: 'Derecha' },
        ]}
      />
      <SelectRow
        label="Alineación vertical"
        value={cfg.verticalAlign}
        onChange={(v) => patch({ verticalAlign: v as CoverVerticalAlign })}
        options={[
          { value: 'top', label: 'Arriba' },
          { value: 'middle', label: 'Medio' },
          { value: 'bottom', label: 'Abajo' },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberRow
          label="Padding X (px)"
          value={cfg.paddingX}
          min={8}
          max={48}
          step={4}
          onChange={(v) => patch({ paddingX: v })}
        />
        <NumberRow
          label="Padding Y (px)"
          value={cfg.paddingY}
          min={8}
          max={48}
          step={4}
          onChange={(v) => patch({ paddingY: v })}
        />
      </div>
    </div>
  );
}

// ─── Overlay panel ───────────────────────────────────────────────────

function OverlayPanel({
  cfg,
  patch,
  patchOverlay,
}: {
  cfg: SectionCoverConfig;
  patch: (p: Partial<SectionCoverConfig>) => void;
  patchOverlay: (p: any) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-mute uppercase tracking-wider">
          Overlay encima de la imagen
        </div>
        <Toggle
          on={!!cfg.overlay}
          onChange={(on) => {
            if (on) {
              patch({
                overlay: {
                  color:
                    'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)',
                  opacity: 1,
                },
              });
            } else {
              patch({ overlay: null });
            }
          }}
        />
      </div>
      {cfg.overlay && (
        <>
          <p className="text-[11px] text-mute">
            Mejora el contraste del texto sobre fotos claras. Prueba los
            presets:
          </p>
          <div className="grid grid-cols-2 gap-2">
            <PresetButton
              label="Oscuro inferior"
              onClick={() =>
                patchOverlay({
                  color:
                    'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.7) 100%)',
                })
              }
            />
            <PresetButton
              label="Oscuro full"
              onClick={() =>
                patchOverlay({ color: 'rgba(0,0,0,0.5)' })
              }
            />
            <PresetButton
              label="Claro inferior"
              onClick={() =>
                patchOverlay({
                  color:
                    'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.7) 100%)',
                })
              }
            />
            <PresetButton
              label="Diagonal color"
              onClick={() =>
                patchOverlay({
                  color:
                    'linear-gradient(135deg, rgba(99,102,241,0.5) 0%, rgba(236,72,153,0.3) 100%)',
                })
              }
            />
          </div>
          <NumberRow
            label="Opacidad"
            value={Math.round(cfg.overlay.opacity * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => patchOverlay({ opacity: v / 100 })}
            suffix="%"
          />
        </>
      )}
    </div>
  );
}

// ─── Form primitives ────────────────────────────────────────────────

function NumberRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-mute font-medium">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-brand"
        />
        <span className="text-xs text-ink tabular-nums w-12 text-right">
          {value}
          {suffix ?? ''}
        </span>
      </div>
    </label>
  );
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-mute font-medium">{label}</span>
      <select
        className="input mt-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
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
    <label className="block">
      <span className="text-[11px] text-mute font-medium">{label}</span>
      <input
        type="color"
        className="input h-10 mt-1 p-1 w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full transition ${
        on ? 'bg-brand' : 'bg-bg2 border border-line'
      }`}
      aria-label="Toggle"
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition ${
          on ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}

function PresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] px-2 py-2 rounded-lg border border-line hover:border-brand transition"
    >
      {label}
    </button>
  );
}

function FontPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  // Agrupa fuentes por categoría con <optgroup>.
  return (
    <label className="block">
      <span className="text-[11px] text-mute font-medium">Tipografía</span>
      <select
        className="input mt-1 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: value }}
      >
        {(
          Object.keys(FONT_CATEGORY_LABELS) as Array<
            keyof typeof FONT_CATEGORY_LABELS
          >
        ).map((cat) => {
          const opts = FONT_OPTIONS.filter((f) => f.category === cat);
          if (opts.length === 0) return null;
          return (
            <optgroup key={cat} label={FONT_CATEGORY_LABELS[cat]}>
              {opts.map((f) => (
                <option
                  key={f.value}
                  value={f.value}
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}

/** Convierte color CSS (rgba/hex/rgb) a hex para <input type=color>.
 *  Si no puede, devuelve fallback negro. */
function cssToHex(css: string): string {
  if (/^#[0-9a-f]{6}$/i.test(css)) return css;
  // Match rgba(R, G, B, A) o rgb(R, G, B)
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const r = Number(m[1]).toString(16).padStart(2, '0');
    const g = Number(m[2]).toString(16).padStart(2, '0');
    const b = Number(m[3]).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return '#000000';
}

export type { SectionCoverConfig };
