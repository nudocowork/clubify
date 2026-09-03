/* eslint-disable @next/next/no-img-element */
/* =====================================================================
 *  InfoLink · Motor de estilo de botón v2 (forma · colores · icono)
 * ---------------------------------------------------------------------
 *  Fuente ÚNICA de render para los botones "v2" (con forma/icono/colores
 *  por botón). Lo usan por igual: el render público (los 5 shells), el
 *  preview del editor y el panel de diseño. Así el preview = producción.
 *
 *  RETROCOMPAT (crítico, spec #20): `hasButtonStyleV2(b)` devuelve true
 *  SOLO si el botón tiene al menos un campo v2. Los botones existentes
 *  (sin campos nuevos) NUNCA pasan por este render → conservan su aspecto
 *  actual exacto en cada shell. Cero migración, cero cambio visual.
 * =================================================================== */
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { renderInfoLinkIcon } from './info-link-icons';

export type ButtonShape =
  | 'rect'
  | 'soft'
  | 'rounded'
  | 'semicircular'
  | 'pill'
  | 'custom';
export type IconType = 'none' | 'library' | 'image';
export type IconPosition = 'left' | 'center-left' | 'right';
export type IconContainerShape = 'none' | 'circle' | 'square' | 'rounded';
export type TextAlignment = 'left' | 'center' | 'right';

/** Campos NUEVOS, todos opcionales — se guardan en el `buttons` JSON que
 *  ya existe (sin migración ni cambio de DTO). */
export type InfoLinkButtonStyle = {
  buttonShape?: ButtonShape;
  borderRadius?: number;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  shadow?: boolean;
  glass?: boolean;
  iconType?: IconType;
  iconName?: string;
  customIconUrl?: string | null;
  iconPosition?: IconPosition;
  iconSize?: number;
  iconBackground?: string; // 'transparent' | 'white' | 'black' | '#hex'
  iconContainerShape?: IconContainerShape;
  iconColor?: string;
  textAlignment?: TextAlignment;
};

/** Los 18 campos v2. Si ninguno está presente → botón legacy. */
const V2_KEYS: (keyof InfoLinkButtonStyle)[] = [
  'buttonShape',
  'borderRadius',
  'backgroundColor',
  'textColor',
  'borderColor',
  'borderWidth',
  'opacity',
  'shadow',
  'glass',
  'iconType',
  'iconName',
  'customIconUrl',
  'iconPosition',
  'iconSize',
  'iconBackground',
  'iconContainerShape',
  'iconColor',
  'textAlignment',
];

/** ¿El botón usa el motor v2? true si tiene CUALQUIER campo v2 relevante.
 *  `opacity===1` e `iconType==='none'` no cuentan (son "sin efecto"). */
export function hasButtonStyleV2(b: Partial<InfoLinkButtonStyle> | null | undefined): boolean {
  if (!b) return false;
  for (const k of V2_KEYS) {
    const v = (b as any)[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'opacity' && v === 1) continue;
    if (k === 'iconType' && v === 'none') continue;
    return true;
  }
  return false;
}

/** Extrae SOLO los campos v2 de un botón (para pasarlos al render sin
 *  arrastrar type/url/etc.). Devuelve un objeto InfoLinkButtonStyle. */
export function pickButtonStyle(b: Partial<InfoLinkButtonStyle>): InfoLinkButtonStyle {
  const out: InfoLinkButtonStyle = {};
  for (const k of V2_KEYS) {
    const v = (b as any)[k];
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

const SHAPE_RADIUS: Record<Exclude<ButtonShape, 'custom'>, number> = {
  rect: 0,
  soft: 8,
  rounded: 16,
  semicircular: 28,
  pill: 999,
};

export function resolveButtonRadius(b: Partial<InfoLinkButtonStyle>): number {
  const shape = b.buttonShape ?? 'rounded';
  if (shape === 'custom') return b.borderRadius ?? 16;
  return SHAPE_RADIUS[shape];
}

function resolveIconBg(v: string | undefined): string {
  if (!v || v === 'transparent') return 'transparent';
  if (v === 'white') return '#ffffff';
  if (v === 'black') return '#000000';
  return v;
}

export type StyledButtonData = InfoLinkButtonStyle & {
  label: string;
  /** Texto pequeño bajo el título (ej. dirección de sede en MAPS). */
  subLabel?: string | null;
};

/**
 * Botón v2 completo. Renderiza `<a>` (público) o `<div>` (preview del
 * editor, `asDiv`). Toda la lógica visual vive aquí una sola vez.
 */
export function StyledButtonLink({
  b,
  primary,
  dark = false,
  href,
  newTab,
  onClick,
  asDiv = false,
  className = '',
}: {
  b: StyledButtonData;
  primary: string;
  dark?: boolean;
  href?: string;
  newTab?: boolean;
  onClick?: (e?: ReactMouseEvent) => void;
  asDiv?: boolean;
  className?: string;
}) {
  const radius = resolveButtonRadius(b);
  const align: TextAlignment = b.textAlignment ?? 'center';
  const pos: IconPosition = b.iconPosition ?? 'center-left';
  const glass = !!b.glass;

  // Color de texto por defecto: sólido → blanco; glass/transparente →
  // según fondo del shell (dark=blanco, claro=tinta).
  const defaultText = glass ? (dark ? '#ffffff' : '#15161f') : '#ffffff';
  const textColor = b.textColor || defaultText;

  const box: CSSProperties = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    minHeight: 56,
    padding: '10px 18px',
    borderRadius: radius,
    color: textColor,
    opacity: b.opacity ?? 1,
    overflow: 'hidden',
    textDecoration: 'none',
    boxSizing: 'border-box',
    border: '1px solid transparent',
  };
  if (glass) {
    box.background = dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)';
    box.backdropFilter = 'blur(14px)';
    box.WebkitBackdropFilter = 'blur(14px)';
    box.border = `1px solid ${dark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.12)'}`;
  } else {
    box.background = b.backgroundColor || primary;
    if (b.borderWidth) {
      box.border = `${b.borderWidth}px solid ${b.borderColor || primary}`;
    }
  }
  if (b.shadow) box.boxShadow = '0 10px 26px rgba(0,0,0,0.30)';

  // ---- Icono ----
  const iconType = b.iconType ?? 'none';
  const glyph = b.iconSize ?? 38;
  const containerShape = b.iconContainerShape ?? 'none';
  const hasContainer = containerShape !== 'none';
  const iconBg = resolveIconBg(b.iconBackground);
  const outer = hasContainer ? Math.round(glyph * 1.5) : glyph;

  let iconNode: ReactNode = null;
  if (iconType !== 'none') {
    const containerStyle: CSSProperties = {
      flex: 'none',
      width: outer,
      height: outer,
      display: 'grid',
      placeItems: 'center',
      overflow: 'hidden',
      background: iconBg,
    };
    if (containerShape === 'circle') containerStyle.borderRadius = '50%';
    else if (containerShape === 'rounded') containerStyle.borderRadius = Math.round(outer * 0.3);
    else if (containerShape === 'square') containerStyle.borderRadius = Math.round(outer * 0.2);
    else if (iconBg !== 'transparent') containerStyle.borderRadius = 8; // fondo sin forma → chip suave

    const inner: CSSProperties = { width: glyph, height: glyph, display: 'grid', placeItems: 'center' };
    let content: ReactNode = null;
    if (iconType === 'image' && b.customIconUrl) {
      content = (
        <img
          src={b.customIconUrl}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      );
    } else if (iconType === 'library') {
      content = renderInfoLinkIcon(b.iconName, b.iconColor);
    }
    iconNode = (
      <span style={containerStyle}>
        <span style={inner}>{content}</span>
      </span>
    );
  }

  // ---- Layout: icono + texto ----
  // Clave (spec #13): texto centrado con icono a la izquierda → el icono se
  // ancla ABSOLUTO a la izquierda y el título queda ópticamente centrado en
  // todo el ancho, sin que el icono lo desplace.
  type LayoutMode = 'plain' | 'right' | 'centered' | 'inflow';
  let mode: LayoutMode;
  if (!iconNode) mode = 'plain';
  else if (pos === 'right') mode = 'right';
  else if (pos === 'center-left' || align === 'center') mode = 'centered';
  else mode = 'inflow';

  let labelAlign: TextAlignment = align;
  if (mode === 'plain') {
    box.justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    labelAlign = align;
  } else if (mode === 'right') {
    box.justifyContent = 'space-between';
    labelAlign = align === 'right' ? 'right' : 'left';
  } else if (mode === 'centered') {
    const reserve = outer + 34;
    box.justifyContent = 'center';
    box.paddingLeft = reserve;
    box.paddingRight = reserve;
    labelAlign = 'center';
  } else {
    box.justifyContent = align === 'right' ? 'flex-end' : 'flex-start';
    labelAlign = align;
  }

  // ---- Label ----
  const labelBlock = (
    <span
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        gap: 2,
        textAlign: labelAlign,
      }}
    >
      <span
        style={{
          fontWeight: 680,
          fontSize: 15.5,
          lineHeight: 1.15,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {b.label}
      </span>
      {b.subLabel ? (
        <span
          style={{
            fontWeight: 500,
            fontSize: 11.5,
            opacity: 0.72,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {b.subLabel}
        </span>
      ) : null}
    </span>
  );

  let children: ReactNode;
  if (mode === 'plain') {
    children = labelBlock;
  } else if (mode === 'right') {
    children = (
      <>
        {labelBlock}
        {iconNode}
      </>
    );
  } else if (mode === 'centered') {
    children = (
      <>
        <span
          style={{
            position: 'absolute',
            left: pos === 'center-left' ? 22 : 16,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {iconNode}
        </span>
        {labelBlock}
      </>
    );
  } else {
    children = (
      <>
        <span style={{ marginRight: 14, display: 'grid', placeItems: 'center' }}>{iconNode}</span>
        {labelBlock}
      </>
    );
  }

  const tap =
    'cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent]';

  if (asDiv) {
    return (
      <div style={box} className={className}>
        {children}
      </div>
    );
  }
  return (
    <a
      href={href}
      target={newTab ? '_blank' : undefined}
      rel="noreferrer"
      onClick={onClick}
      style={box}
      className={`${tap} ${className}`}
    >
      {children}
    </a>
  );
}
