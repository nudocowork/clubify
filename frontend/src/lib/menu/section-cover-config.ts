/**
 * Config visual de la portada de una sección de menú.
 *
 * Cada Category puede tener un coverConfig JSON con esta estructura.
 * Se persiste en backend (Category.coverConfig JSONB, ver Fase 1).
 * Si una categoría no tiene coverConfig, el storefront usa el
 * fallback legacy (imageUrl como bg + nombre centrado).
 *
 * Esta estructura es más simple que QrPosterConfig — no necesita
 * Konva ni capas drag/drop. La portada es un banner con
 * propiedades fijas (imagen + overlay + título + tagline) editable
 * desde un panel de controles. El render es CSS puro (sin canvas).
 */

export type CoverAlign = 'left' | 'center' | 'right';
export type CoverVerticalAlign = 'top' | 'middle' | 'bottom';

export type CoverTextStyle = {
  /** Color del texto en hex (#RRGGBB). */
  color: string;
  /** Familia tipográfica — debe ser un value válido de FONT_OPTIONS. */
  fontFamily: string;
  /** Peso (100..900). */
  fontWeight: number;
  /** Tamaño en px (mobile reference, escala responsive). */
  fontSize: number;
  /** Letter-spacing en em. Default 0. */
  letterSpacing?: number;
  /** Line-height multiplicador. Default 1.1. */
  lineHeight?: number;
  /** Sombra de texto. null = sin sombra. */
  shadow?: {
    color: string;
    blur: number;
    offsetY: number;
  } | null;
  /** Transformación. 'none' default. */
  transform?: 'none' | 'uppercase' | 'lowercase';
};

export type CoverOverlay = {
  /** Color del overlay (puede ser gradiente — frontend interpreta).
   *  Soporta:
   *  - hex sólido: "#000000"
   *  - css gradient: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.7) 100%)" */
  color: string;
  /** 0..1, multiplica el alpha del overlay sólido. Si color es gradient, este valor se ignora. */
  opacity: number;
};

export type SectionCoverConfig = {
  /** Versión del schema — bumpear cuando hay breaking changes. */
  version: 1;
  /** URL de la imagen de fondo (R2 o externa). Puede ser null para
   *  cubrir solo con color sólido (bgColor) o gradient via overlay. */
  bgImageUrl: string | null;
  /** Color de fondo si bgImageUrl es null. Default '#1a1a1a'. */
  bgColor: string;
  /** Ajuste de imagen al banner. */
  bgFit: 'cover' | 'contain';
  /** Posición de la imagen (object-position CSS). */
  bgPosition: 'center' | 'top' | 'bottom' | 'left' | 'right';
  /** Overlay encima de la imagen para darle contraste al texto.
   *  null = sin overlay. */
  overlay: CoverOverlay | null;
  /** Alto del banner en px (mobile reference). 160-400. */
  height: number;
  /** Border radius en px del contenedor. 0-32. */
  borderRadius: number;
  /** Alineación horizontal del bloque de texto dentro del banner. */
  align: CoverAlign;
  /** Alineación vertical del bloque de texto. */
  verticalAlign: CoverVerticalAlign;
  /** Padding interno horizontal (px). */
  paddingX: number;
  /** Padding interno vertical (px). */
  paddingY: number;
  /** Estilo del título principal (nombre de la sección). */
  title: CoverTextStyle;
  /** Estilo del tagline opcional. Si null, no se renderea. */
  tagline: CoverTextStyle | null;
  /** Si el template tiene una "etiqueta" arriba del título (ej:
   *  "ESPECIAL DEL DÍA"), va acá. Opcional. */
  badge: CoverTextStyle | null;
  /** Texto del badge si está activo. */
  badgeText: string | null;
};

export const DEFAULT_COVER_CONFIG: SectionCoverConfig = {
  version: 1,
  bgImageUrl: null,
  bgColor: '#1a1a1a',
  bgFit: 'cover',
  bgPosition: 'center',
  overlay: {
    color: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.65) 100%)',
    opacity: 1,
  },
  height: 220,
  borderRadius: 16,
  align: 'left',
  verticalAlign: 'bottom',
  paddingX: 24,
  paddingY: 24,
  title: {
    color: '#FFFFFF',
    fontFamily: '"Playfair Display", Georgia, serif',
    fontWeight: 700,
    fontSize: 32,
    letterSpacing: -0.02,
    lineHeight: 1.05,
    shadow: { color: 'rgba(0,0,0,0.4)', blur: 8, offsetY: 2 },
    transform: 'none',
  },
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
  badge: null,
  badgeText: null,
};

/** Normaliza un coverConfig venido de la DB (puede ser null o tener
 *  campos viejos). Garantiza que el resultado matchea el schema actual. */
export function normalizeCoverConfig(
  raw: unknown,
): SectionCoverConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_COVER_CONFIG;
  const r = raw as Partial<SectionCoverConfig>;
  return {
    ...DEFAULT_COVER_CONFIG,
    ...r,
    title: { ...DEFAULT_COVER_CONFIG.title, ...(r.title ?? {}) },
    tagline:
      r.tagline === null
        ? null
        : { ...DEFAULT_COVER_CONFIG.tagline!, ...(r.tagline ?? {}) },
    badge: r.badge ?? null,
    overlay:
      r.overlay === null
        ? null
        : { ...DEFAULT_COVER_CONFIG.overlay!, ...(r.overlay ?? {}) },
  };
}
