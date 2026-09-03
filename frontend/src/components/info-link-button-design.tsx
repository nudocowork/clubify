'use client';
/* =====================================================================
 *  InfoLink · Panel de diseño de botón (Forma · Colores · Efectos ·
 *  Icono · Texto). Aditivo — solo escribe campos v2 vía onPatch. El
 *  render vive en StyledButtonLink (fuente única). Colapsable por botón.
 * =================================================================== */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageUploader } from './ImageUploader';
import {
  StyledButtonLink,
  pickButtonStyle,
  type InfoLinkButtonStyle,
  type ButtonShape,
  type IconType,
  type IconPosition,
  type IconContainerShape,
  type TextAlignment,
} from './info-link-button-style';
import {
  INFO_LINK_ICONS,
  searchInfoLinkIcons,
  INFO_LINK_ICONS_BY_NAME,
} from './info-link-icons';

type PanelButton = InfoLinkButtonStyle & { label?: string };

/** Para el picker/preview del EDITOR (fondo claro): si el color del icono es
 *  casi blanco, lo mostramos oscuro para que sea visible. No afecta el render
 *  real del botón público. */
function visibleColor(c?: string): string {
  if (!c) return '#111827';
  const s = c.toLowerCase();
  if (s === '#fff' || s === '#ffffff' || s === 'white') return '#111827';
  return c;
}

// ---- Controles reutilizables ----
function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; t: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
              on
                ? 'bg-brand border-brand text-white'
                : 'bg-bg2 border-line text-mute hover:text-ink hover:border-line'
            }`}
          >
            {o.t}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  value,
  min,
  max,
  onChange,
  suffix = 'px',
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-brand"
      />
      <span className="text-[11px] font-bold tabular-nums text-mute w-12 text-right">
        {value} {suffix}
      </span>
    </div>
  );
}

function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value?: string;
  fallback: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-mute">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-7 rounded border border-line bg-transparent p-0.5 cursor-pointer"
        />
        {value ? (
          <button
            type="button"
            className="text-[10px] text-mute hover:text-bad"
            onClick={() => onChange(undefined)}
            title="Quitar"
          >
            ✕
          </button>
        ) : (
          <span className="text-[10px] text-mute/60 w-3" />
        )}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">
      {children}
    </div>
  );
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-lg border border-line bg-bg2 text-left"
    >
      <span className="text-[12px] font-medium">{label}</span>
      <span
        className={`relative w-9 h-5 rounded-full transition ${on ? 'bg-good' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function ButtonDesignPanel({
  b,
  primary,
  onPatch,
  onApplyAll,
}: {
  b: PanelButton;
  primary: string;
  onPatch: (patch: Partial<InfoLinkButtonStyle>) => void;
  onApplyAll: (style: InfoLinkButtonStyle) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');
  const [appliedAll, setAppliedAll] = useState(false);

  const shape: ButtonShape = b.buttonShape ?? 'rounded';
  const iconType: IconType = b.iconType ?? 'none';
  const style = pickButtonStyle(b);

  const clearDesign = () => {
    onPatch({
      buttonShape: undefined,
      borderRadius: undefined,
      backgroundColor: undefined,
      textColor: undefined,
      borderColor: undefined,
      borderWidth: undefined,
      opacity: undefined,
      shadow: undefined,
      glass: undefined,
      iconType: undefined,
      iconName: undefined,
      customIconUrl: undefined,
      iconPosition: undefined,
      iconSize: undefined,
      iconBackground: undefined,
      iconContainerShape: undefined,
      iconColor: undefined,
      textAlignment: undefined,
    });
  };

  const results = searchInfoLinkIcons(q);

  return (
    <div className="col-span-full border-t border-line2 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-[12px] font-semibold text-ink hover:text-brand transition"
      >
        <span>🎨 {t('bdToggle')}</span>
        <span className="text-mute">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {/* Preview inmediato del botón */}
          <div
            className="rounded-xl p-4"
            style={{ background: 'linear-gradient(135deg,#1a1430,#0b0a14)' }}
          >
            <StyledButtonLink
              b={{ ...style, label: b.label || t('bdSampleLabel') }}
              primary={primary}
              dark
              asDiv
            />
          </div>

          {/* FORMA */}
          <div>
            <FieldLabel>{t('bdShape')}</FieldLabel>
            <Seg<ButtonShape>
              value={shape}
              onChange={(v) => onPatch({ buttonShape: v })}
              options={[
                { v: 'rect', t: t('bdShapeRect') },
                { v: 'soft', t: t('bdShapeSoft') },
                { v: 'rounded', t: t('bdShapeRounded') },
                { v: 'semicircular', t: t('bdShapeSemi') },
                { v: 'pill', t: t('bdShapePill') },
                { v: 'custom', t: t('bdShapeCustom') },
              ]}
            />
            {shape === 'custom' && (
              <div className="mt-2">
                <FieldLabel>{t('bdRadius')}</FieldLabel>
                <Slider
                  value={b.borderRadius ?? 16}
                  min={0}
                  max={50}
                  onChange={(v) => onPatch({ borderRadius: v })}
                />
              </div>
            )}
          </div>

          {/* COLORES */}
          <div className="space-y-1.5">
            <FieldLabel>{t('bdColors')}</FieldLabel>
            <ColorRow
              label={t('bdBg')}
              value={b.backgroundColor}
              fallback={primary}
              onChange={(v) => onPatch({ backgroundColor: v })}
            />
            <ColorRow
              label={t('bdText')}
              value={b.textColor}
              fallback="#ffffff"
              onChange={(v) => onPatch({ textColor: v })}
            />
            <ColorRow
              label={t('bdBorderColor')}
              value={b.borderColor}
              fallback={primary}
              onChange={(v) =>
                onPatch({
                  borderColor: v,
                  borderWidth: v ? b.borderWidth || 2 : undefined,
                })
              }
            />
          </div>

          {/* EFECTOS */}
          <div className="space-y-2">
            <FieldLabel>{t('bdEffects')}</FieldLabel>
            <Toggle
              label={t('bdGlass')}
              on={!!b.glass}
              onChange={(v) => onPatch({ glass: v || undefined })}
            />
            <Toggle
              label={t('bdShadow')}
              on={!!b.shadow}
              onChange={(v) => onPatch({ shadow: v || undefined })}
            />
          </div>

          {/* ICONO */}
          <div>
            <FieldLabel>{t('bdIcon')}</FieldLabel>
            <Seg<IconType>
              value={iconType}
              onChange={(v) => {
                if (v === 'none') onPatch({ iconType: undefined });
                else if (v === 'library')
                  onPatch({
                    iconType: 'library',
                    iconName: b.iconName || INFO_LINK_ICONS[0].name,
                  });
                else onPatch({ iconType: 'image' });
              }}
              options={[
                { v: 'none', t: t('bdIconNone') },
                { v: 'library', t: t('bdIconLibrary') },
                { v: 'image', t: t('bdIconUpload') },
              ]}
            />

            {iconType === 'library' && (
              <div className="mt-2 flex items-center gap-2">
                <div className="w-10 h-10 rounded-lg bg-bg2 border border-line grid place-items-center overflow-hidden">
                  <span className="w-6 h-6 grid place-items-center">
                    {b.iconName &&
                      INFO_LINK_ICONS_BY_NAME[b.iconName]?.render(
                        visibleColor(b.iconColor),
                      )}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setPickerOpen(true)}
                >
                  {t('bdIconChoose')}
                </button>
              </div>
            )}

            {iconType === 'image' && (
              <div className="mt-2">
                <ImageUploader
                  value={b.customIconUrl ?? null}
                  onChange={(url) => onPatch({ customIconUrl: url })}
                  folder="info-link-icons"
                  crop={false}
                  minDimensionWarn={false}
                  maxSizeMb={5}
                />
                <div className="text-[10px] text-mute mt-1">{t('bdUploadHint')}</div>
              </div>
            )}

            {/* Sub-opciones del icono (aplican a library e image) */}
            {iconType !== 'none' && (
              <div className="mt-3 space-y-3 border-l-2 border-line2 pl-3">
                <div>
                  <FieldLabel>{t('bdIconPosition')}</FieldLabel>
                  <Seg<IconPosition>
                    value={b.iconPosition ?? 'center-left'}
                    onChange={(v) => onPatch({ iconPosition: v })}
                    options={[
                      { v: 'left', t: t('bdPosLeft') },
                      { v: 'center-left', t: t('bdPosCenterLeft') },
                      { v: 'right', t: t('bdPosRight') },
                    ]}
                  />
                </div>
                <div>
                  <FieldLabel>{t('bdIconSize')}</FieldLabel>
                  <Slider
                    value={b.iconSize ?? 38}
                    min={20}
                    max={60}
                    onChange={(v) => onPatch({ iconSize: v })}
                  />
                </div>
                <div>
                  <FieldLabel>{t('bdIconContainer')}</FieldLabel>
                  <Seg<IconContainerShape>
                    value={b.iconContainerShape ?? 'none'}
                    onChange={(v) => onPatch({ iconContainerShape: v })}
                    options={[
                      { v: 'none', t: t('bdContNone') },
                      { v: 'circle', t: t('bdContCircle') },
                      { v: 'square', t: t('bdContSquare') },
                      { v: 'rounded', t: t('bdContRounded') },
                    ]}
                  />
                </div>
                <ColorRow
                  label={t('bdIconBg')}
                  value={
                    b.iconBackground && b.iconBackground !== 'transparent'
                      ? b.iconBackground
                      : undefined
                  }
                  fallback="#ffffff"
                  onChange={(v) => onPatch({ iconBackground: v ?? 'transparent' })}
                />
                {iconType === 'library' && (
                  <ColorRow
                    label={t('bdIconColor')}
                    value={b.iconColor}
                    fallback="#ffffff"
                    onChange={(v) => onPatch({ iconColor: v })}
                  />
                )}
              </div>
            )}
          </div>

          {/* TEXTO */}
          <div>
            <FieldLabel>{t('bdTextAlign')}</FieldLabel>
            <Seg<TextAlignment>
              value={b.textAlignment ?? 'center'}
              onChange={(v) => onPatch({ textAlignment: v })}
              options={[
                { v: 'left', t: t('bdAlignLeft') },
                { v: 'center', t: t('bdAlignCenter') },
                { v: 'right', t: t('bdAlignRight') },
              ]}
            />
          </div>

          {/* ACCIONES */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                // Uniformidad = forma/colores/efectos/layout del icono, pero
                // cada botón conserva SU icono propio (no clonamos el icono).
                const s = pickButtonStyle(b);
                delete s.iconType;
                delete s.iconName;
                delete s.customIconUrl;
                onApplyAll(s);
                setAppliedAll(true);
                setTimeout(() => setAppliedAll(false), 1800);
              }}
            >
              {appliedAll ? `✓ ${t('bdApplyAllDone')}` : t('bdApplyAll')}
            </button>
            <button
              type="button"
              className="text-xs text-mute hover:text-bad underline"
              onClick={clearDesign}
            >
              {t('bdReset')}
            </button>
          </div>
        </div>
      )}

      {/* Modal biblioteca de iconos */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-ink/60 flex items-center justify-center p-4"
          onClick={() => setPickerOpen(false)}
        >
          <div
            className="bg-bg rounded-2xl shadow-xl w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-base m-0">{t('bdIconLibrary')}</h3>
              <button
                onClick={() => setPickerOpen(false)}
                className="text-mute hover:text-ink p-1"
              >
                ✕
              </button>
            </div>
            <input
              className="input w-full mb-3"
              placeholder={t('bdIconSearch')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
            <div className="grid grid-cols-4 gap-2 max-h-[340px] overflow-y-auto">
              {results.map((ic) => {
                const on = b.iconName === ic.name;
                return (
                  <button
                    key={ic.name}
                    type="button"
                    onClick={() => {
                      onPatch({ iconType: 'library', iconName: ic.name });
                      setPickerOpen(false);
                    }}
                    className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition ${
                      on
                        ? 'border-brand bg-brand-soft'
                        : 'border-line hover:border-brand bg-bg2'
                    }`}
                    title={ic.label}
                  >
                    <span className="w-7 h-7 grid place-items-center">
                      {ic.render(visibleColor(ic.defaultColor))}
                    </span>
                    <span className="text-[9px] text-mute truncate w-full text-center">
                      {ic.label}
                    </span>
                  </button>
                );
              })}
              {results.length === 0 && (
                <div className="col-span-4 text-center text-mute text-sm py-6">
                  {t('bdIconEmpty')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
