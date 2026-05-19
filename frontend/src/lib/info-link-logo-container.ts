/**
 * Config visual del contenedor del logo del InfoLink.
 *
 * Cada InfoLink puede tener un `theme.logoContainer` con esta estructura.
 * Si está ausente, los shells usan su default histórico (look propio del
 * template). Si está presente, los shells la honran y dejan el resto del
 * estilo intacto.
 *
 * Pensado para que el dueño pueda dar al logo el "vibe" del negocio sin
 * tener que tocar 6 settings — los 4 presets cubren la mayoría de los
 * casos; los sliders abajo son para fine-tuning.
 */

import type { CSSProperties } from 'react';

export type LogoContainerPresetId =
  | 'minimalista'
  | 'premium'
  | 'dark'
  | 'glassmorphism';

export type LogoContainerShape = 'rounded' | 'circle';

export type LogoContainerConfig = {
  /** Identificador del preset desde el que el usuario partió, si arrancó
   *  con uno. Permite al editor resaltar el preset activo. Si está null,
   *  el usuario armó la config manual o no eligió ninguno. */
  preset: LogoContainerPresetId | null;
  /** Forma del contenedor. `circle` fuerza aspect 1:1 + radius 50% para
   *  un look tipo Apple/Airbnb. `rounded` respeta `borderRadius` y permite
   *  un rectángulo proporcional al logo. Default 'circle' para nuevos.
   *  Optional para retrocompat con configs viejos serializados sin shape —
   *  los helpers asumen 'circle' cuando ausente. */
  shape?: LogoContainerShape;
  /** Color de fondo del contenedor. Si bgOpacity < 1 se aplica como
   *  rgba — los presets pasan el hex y el editor lo modula. */
  bgColor: string;
  /** Opacidad del fondo (0..1). Útil para glassmorphism (~0.18) o para
   *  bajar el blanco a "casi transparente" sin perder contraste. */
  bgOpacity: number;
  /** Backdrop blur en px (0..30). Solo se nota cuando bgOpacity < 1 y
   *  hay imagen detrás. */
  backdropBlur: number;
  /** Radio de borde en px (0..40). */
  borderRadius: number;
  /** Padding horizontal interno (px). */
  paddingX: number;
  /** Padding vertical interno (px). */
  paddingY: number;
  /** Ancho máximo del contenedor en px (80..280). El logo se ajusta dentro
   *  con object-contain — nunca se recorta. */
  maxWidth: number;
  /** Ancho máximo del logo dentro del contenedor en px (40..240). Si
   *  maxWidth es 200 y este es 160, queda 20px de padding visual a cada
   *  lado además del padding declarado. */
  logoMaxWidth: number;
  /** Alto máximo del logo en px (40..180). */
  logoMaxHeight: number;
  /** Color y grosor del borde sólido. Si borderWidth=0, no se dibuja. */
  borderColor: string;
  borderWidth: number;
  /** Anillo extra (ring) — pensado para emular "white ring" tipo Instagram
   *  o un halo de marca. ringWidth=0 lo desactiva. */
  ringColor: string;
  ringWidth: number;
  /** Sombra predefinida del contenedor. 'glow' usa el color de marca. */
  shadow: 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'glow';
};

export const DEFAULT_LOGO_CONTAINER: LogoContainerConfig = {
  preset: null,
  shape: 'circle',
  bgColor: '#FFFFFF',
  bgOpacity: 1,
  backdropBlur: 0,
  borderRadius: 9999,
  paddingX: 18,
  paddingY: 18,
  maxWidth: 128,
  logoMaxWidth: 96,
  logoMaxHeight: 96,
  borderColor: '#000000',
  borderWidth: 0,
  ringColor: 'rgba(255,255,255,0.3)',
  ringWidth: 0,
  shadow: 'md',
};

export const LOGO_CONTAINER_PRESETS: Record<
  LogoContainerPresetId,
  { label: string; description: string; config: LogoContainerConfig }
> = {
  minimalista: {
    label: 'Minimalista',
    description: 'Círculo blanco sin sombra — solo el logo respirando',
    config: {
      ...DEFAULT_LOGO_CONTAINER,
      preset: 'minimalista',
      shape: 'circle',
      bgColor: '#FFFFFF',
      bgOpacity: 1,
      paddingX: 18,
      paddingY: 18,
      shadow: 'none',
      borderWidth: 0,
      ringWidth: 0,
    },
  },
  premium: {
    label: 'Premium',
    description: 'Círculo blanco con sombra suave y anillo blanco — look Airbnb/Apple',
    config: {
      ...DEFAULT_LOGO_CONTAINER,
      preset: 'premium',
      shape: 'circle',
      bgColor: '#FFFFFF',
      bgOpacity: 1,
      paddingX: 22,
      paddingY: 22,
      shadow: 'xl',
      borderWidth: 0,
      ringColor: 'rgba(255,255,255,0.6)',
      ringWidth: 4,
    },
  },
  dark: {
    label: 'Dark',
    description: 'Círculo oscuro con halo neón — vibe nocturno',
    config: {
      ...DEFAULT_LOGO_CONTAINER,
      preset: 'dark',
      shape: 'circle',
      bgColor: '#0A0A14',
      bgOpacity: 1,
      paddingX: 22,
      paddingY: 22,
      shadow: 'glow',
      borderColor: 'rgba(255,255,255,0.08)',
      borderWidth: 1,
      ringWidth: 0,
    },
  },
  glassmorphism: {
    label: 'Glassmorphism',
    description: 'Círculo translúcido con backdrop blur — vidrio esmerilado',
    config: {
      ...DEFAULT_LOGO_CONTAINER,
      preset: 'glassmorphism',
      shape: 'circle',
      bgColor: '#FFFFFF',
      bgOpacity: 0.18,
      backdropBlur: 18,
      paddingX: 22,
      paddingY: 22,
      shadow: 'lg',
      borderColor: 'rgba(255,255,255,0.45)',
      borderWidth: 1,
      ringWidth: 0,
    },
  },
};

/** Convierte hex (#RRGGBB) a rgba string con la opacidad indicada.
 *  Si ya es rgba/rgb, lo devuelve tal cual. Si es 'transparent', idem. */
function hexToRgba(hex: string, opacity: number): string {
  if (!hex || hex === 'transparent') return 'transparent';
  if (hex.startsWith('rgb')) return hex;
  const m = hex.replace('#', '');
  if (m.length !== 6 && m.length !== 3) return hex;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, opacity))})`;
}

/** Mapea el shadow preset a CSS box-shadow. 'glow' usa el primary del
 *  brand para que la sombra "se sienta de la marca" (estilo NEON). */
function shadowToCss(shadow: LogoContainerConfig['shadow'], primary: string): string {
  switch (shadow) {
    case 'none':
      return 'none';
    case 'sm':
      return '0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08)';
    case 'md':
      return '0 4px 6px -1px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.04)';
    case 'lg':
      return '0 10px 20px -8px rgba(0,0,0,0.18), 0 6px 12px -6px rgba(0,0,0,0.1)';
    case 'xl':
      return '0 20px 40px -16px rgba(0,0,0,0.28), 0 12px 24px -12px rgba(0,0,0,0.16)';
    case 'glow':
      return `0 0 40px ${primary}80, 0 0 80px ${primary}30`;
    default:
      return 'none';
  }
}

/** Devuelve los style + className para renderizar el contenedor del logo
 *  según la config. Se usa en los 5 shells. `primary` es el color de marca
 *  (necesario para 'glow' shadow). */
export function getLogoContainerProps(
  config: LogoContainerConfig | null | undefined,
  primary: string,
): { style: CSSProperties; className: string } {
  const cfg = config ?? DEFAULT_LOGO_CONTAINER;
  const isCircle = cfg.shape === 'circle';
  // En modo círculo forzamos width=height usando un tamaño cuadrado fijo
  // (maxWidth) y aspectRatio 1:1, sino el padding desigual rompe el círculo.
  const style: CSSProperties = {
    background: hexToRgba(cfg.bgColor, cfg.bgOpacity),
    borderRadius: isCircle ? '9999px' : `${cfg.borderRadius}px`,
    paddingLeft: `${cfg.paddingX}px`,
    paddingRight: `${cfg.paddingX}px`,
    paddingTop: `${cfg.paddingY}px`,
    paddingBottom: `${cfg.paddingY}px`,
    boxShadow: shadowToCss(cfg.shadow, primary),
    ...(isCircle
      ? {
          width: `${cfg.maxWidth}px`,
          height: `${cfg.maxWidth}px`,
          aspectRatio: '1 / 1',
        }
      : { maxWidth: `${cfg.maxWidth}px` }),
  };
  if (cfg.backdropBlur > 0) {
    (style as any).backdropFilter = `blur(${cfg.backdropBlur}px)`;
    (style as any).WebkitBackdropFilter = `blur(${cfg.backdropBlur}px)`;
  }
  if (cfg.borderWidth > 0) {
    style.border = `${cfg.borderWidth}px solid ${cfg.borderColor}`;
  }
  if (cfg.ringWidth > 0) {
    // Usamos box-shadow inset/offset cero para emular ring de Tailwind sin
    // que choque con la shadow principal — concatenamos.
    const ring = `0 0 0 ${cfg.ringWidth}px ${cfg.ringColor}`;
    style.boxShadow = `${ring}, ${style.boxShadow ?? 'none'}`;
  }
  return {
    style,
    className: isCircle
      ? 'flex items-center justify-center overflow-hidden flex-none'
      : 'flex items-center justify-center w-fit overflow-visible',
  };
}

/** Estilo del <img> interior. Garantiza object-contain + max dims para
 *  que el logo NUNCA se recorte. En modo círculo, el max sale del
 *  contenedor menos padding, no del logoMaxWidth declarado. */
export function getLogoImgStyle(
  config: LogoContainerConfig | null | undefined,
): CSSProperties {
  const cfg = config ?? DEFAULT_LOGO_CONTAINER;
  if (cfg.shape === 'circle') {
    // En círculo el ancho/alto disponible viene del container (maxWidth -
    // 2*padding). Usamos 100% para llenar el área disponible respetando
    // el padding del wrapper, manteniendo object-contain.
    return {
      maxWidth: '100%',
      maxHeight: '100%',
      width: 'auto',
      height: 'auto',
      objectFit: 'contain',
      display: 'block',
    };
  }
  return {
    maxWidth: `${cfg.logoMaxWidth}px`,
    maxHeight: `${cfg.logoMaxHeight}px`,
    width: 'auto',
    height: 'auto',
    objectFit: 'contain',
    display: 'block',
  };
}
