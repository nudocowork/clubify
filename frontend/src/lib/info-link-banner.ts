/**
 * Config visual del banner (hero image) del InfoLink.
 *
 * Se persiste en `link.theme.bannerConfig`. Si está null/ausente, los
 * shells que renderean hero usan el default histórico (foto a cover sin
 * overlay). Si está presente, el shell honra overlay, posición, zoom
 * y blur — pensado para que el dueño ajuste su foto y el contenido que
 * va encima (logo, nombre, descripción, botones) quede legible.
 */

import type { CSSProperties } from 'react';

export type BannerOverlayType = 'none' | 'solid' | 'gradient';
export type BannerPosition =
  | 'center'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'custom';
export type BannerPresetId = 'limpio' | 'oscuro' | 'cinematico' | 'blur';

export type BannerConfig = {
  preset: BannerPresetId | null;
  /** Posición de la imagen dentro del frame. 'custom' usa offsetX/Y. */
  position: BannerPosition;
  /** Offset X cuando position='custom'. -50 a 50 (porcentaje). */
  offsetX: number;
  /** Offset Y cuando position='custom'. -50 a 50 (porcentaje). */
  offsetY: number;
  /** Zoom de la imagen. 1.0 = sin zoom, 2.0 = 200%. Acepta hasta 3.0. */
  scale: number;
  /** Blur en px (0..20). 0 = sin blur. */
  blur: number;
  /** Configuración del overlay sobre la imagen. */
  overlay: {
    type: BannerOverlayType;
    /** Color sólido (hex). Se usa cuando type='solid'. */
    color: string;
    /** Opacidad del overlay sólido (0..1). */
    opacity: number;
    /** Color "from" del gradient. */
    gradientFrom: string;
    /** Color "to" del gradient. */
    gradientTo: string;
    /** Ángulo del gradient (0..360 grados). 180 = vertical top→bottom. */
    gradientAngle: number;
    /** Opacidad global del gradient (multiplica el alpha de from/to). */
    gradientOpacity: number;
  };
};

export const DEFAULT_BANNER_CONFIG: BannerConfig = {
  preset: null,
  position: 'center',
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  blur: 0,
  overlay: {
    type: 'none',
    color: '#000000',
    opacity: 0.4,
    gradientFrom: 'rgba(0,0,0,0)',
    gradientTo: 'rgba(0,0,0,0.7)',
    gradientAngle: 180,
    gradientOpacity: 1,
  },
};

export const BANNER_PRESETS: Record<
  BannerPresetId,
  { label: string; description: string; config: BannerConfig }
> = {
  limpio: {
    label: 'Limpio',
    description: 'Foto sin overlay ni blur, posición centrada',
    config: {
      ...DEFAULT_BANNER_CONFIG,
      preset: 'limpio',
      overlay: { ...DEFAULT_BANNER_CONFIG.overlay, type: 'none' },
    },
  },
  oscuro: {
    label: 'Oscuro para lectura',
    description: 'Overlay negro 45% — texto blanco encima se lee perfecto',
    config: {
      ...DEFAULT_BANNER_CONFIG,
      preset: 'oscuro',
      overlay: {
        ...DEFAULT_BANNER_CONFIG.overlay,
        type: 'solid',
        color: '#000000',
        opacity: 0.45,
      },
    },
  },
  cinematico: {
    label: 'Cinemático',
    description: 'Gradient negro desde abajo — efecto "póster de película"',
    config: {
      ...DEFAULT_BANNER_CONFIG,
      preset: 'cinematico',
      overlay: {
        ...DEFAULT_BANNER_CONFIG.overlay,
        type: 'gradient',
        gradientFrom: 'rgba(0,0,0,0)',
        gradientTo: 'rgba(0,0,0,0.85)',
        gradientAngle: 180,
        gradientOpacity: 1,
      },
    },
  },
  blur: {
    label: 'Blur de fondo',
    description: 'Foto desenfocada + overlay claro — ideal con logo prominente',
    config: {
      ...DEFAULT_BANNER_CONFIG,
      preset: 'blur',
      blur: 10,
      scale: 1.15,
      overlay: {
        ...DEFAULT_BANNER_CONFIG.overlay,
        type: 'solid',
        color: '#FFFFFF',
        opacity: 0.25,
      },
    },
  },
};

/** Mapea position al string CSS background-position. */
export function positionToCss(cfg: BannerConfig): string {
  if (cfg.position === 'custom') {
    // CSS background-position en % funciona inverso a "offset": 0% = left
    // edge align, 100% = right edge align. Le sumamos 50% para que 0
    // sea centrado, -50 sea bien a la izquierda, +50 a la derecha.
    const xPct = Math.max(0, Math.min(100, 50 + cfg.offsetX));
    const yPct = Math.max(0, Math.min(100, 50 + cfg.offsetY));
    return `${xPct}% ${yPct}%`;
  }
  switch (cfg.position) {
    case 'top':
      return 'center top';
    case 'bottom':
      return 'center bottom';
    case 'left':
      return 'left center';
    case 'right':
      return 'right center';
    case 'center':
    default:
      return 'center center';
  }
}

/** Construye el style inline del DIV de fondo (no del overlay).
 *  Aplica imagen + posición + scale (vía background-size) + blur. */
export function getBannerBackgroundStyle(
  imageUrl: string | null,
  config: BannerConfig | null | undefined,
  fallbackBg: string,
): CSSProperties {
  const cfg = config ?? DEFAULT_BANNER_CONFIG;
  if (!imageUrl) {
    return { background: fallbackBg };
  }
  // background-size: cover * scale. Para escalar manteniendo cover, usamos
  // por ej. 'auto' + ajustamos via 'background-size' explícito como pct.
  const sizePct = Math.round(cfg.scale * 100);
  const style: CSSProperties = {
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: cfg.scale === 1 ? 'cover' : `${sizePct}% auto`,
    backgroundPosition: positionToCss(cfg),
    backgroundRepeat: 'no-repeat',
  };
  if (cfg.blur > 0) {
    (style as any).filter = `blur(${cfg.blur}px)`;
    // Compensamos el "edge bleed" del blur con scale visual extra; pero
    // como background-size ya escala, usamos transform: scale en el caller
    // si quiere. Acá dejamos solo el filter para minimizar capas.
  }
  return style;
}

/** Devuelve el CSS background del overlay (a renderear como capa
 *  encima de la imagen). Si type='none', retorna 'transparent' — el
 *  caller puede omitir el div para optimizar. */
export function getBannerOverlayBackground(
  config: BannerConfig | null | undefined,
): string {
  const cfg = config ?? DEFAULT_BANNER_CONFIG;
  const ov = cfg.overlay;
  if (ov.type === 'none') return 'transparent';
  if (ov.type === 'gradient') {
    // gradientFrom/To se asumen ya con alpha — gradientOpacity multiplica
    // por simplicidad solo aplicamos opacity al elemento con un wrapper.
    return `linear-gradient(${ov.gradientAngle}deg, ${ov.gradientFrom}, ${ov.gradientTo})`;
  }
  // solid
  const m = ov.color.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (full.length !== 6) return ov.color;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, ov.opacity))})`;
}
