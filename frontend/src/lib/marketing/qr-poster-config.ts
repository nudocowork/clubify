/**
 * QR Poster — configuración compartida entre los 4 tipos (MENU,
 * COUNTER, DISCOUNT, REVIEWS). El JSON se persiste tal cual en
 * QrPoster.config (Prisma). El editor visual de Konva consume/produce
 * este shape. La URL destino del QR NO va acá — se calcula en render
 * time según el `type` para que el QR siga siendo dinámico.
 */

export type QrPosterType = 'MENU' | 'COUNTER' | 'DISCOUNT' | 'REVIEWS';

export type BgConfig =
  | { type: 'solid'; color1: string }
  | { type: 'gradient'; color1: string; color2: string; angle: number };

export type QrConfig = {
  x: number; // px from canvas top-left
  y: number;
  size: number; // square side in px
  fg: string; // dot/module color
  bg: string; // QR background (paper)
};

export type TextLayer = {
  text: string;
  x: number;
  y: number;
  /** Internal CSS font-family value, e.g. "Inter, system-ui, sans-serif" */
  font: string;
  /** Display label, e.g. "Inter" */
  fontLabel: string;
  size: number; // px
  color: string;
  weight: number; // 400 | 700 | 900
  align: 'left' | 'center' | 'right';
};

export type QrPosterConfig = {
  canvas: { w: number; h: number };
  bg: BgConfig;
  qr: QrConfig;
  texts: {
    title: TextLayer;
    subtitle: TextLayer;
    cta: TextLayer;
    brand: TextLayer & { auto: boolean };
  };
  /** Footer "Powered by Clubify" — siempre visible (no removible, ver
   *  feedback_clubify_branding_locked memory). */
  showClubifyFooter: true;
};

export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Inter', value: 'Inter, system-ui, sans-serif' },
  { label: 'Playfair Display', value: '"Playfair Display", Georgia, serif' },
  { label: 'Bebas Neue', value: '"Bebas Neue", Impact, sans-serif' },
  { label: 'Poppins', value: 'Poppins, sans-serif' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif' },
];

export const CANVAS_PRESETS: {
  label: string;
  w: number;
  h: number;
}[] = [
  { label: 'A4 vertical', w: 1080, h: 1528 },
  { label: 'Cuadrado', w: 1080, h: 1080 },
  { label: 'Vertical alto', w: 1080, h: 1920 },
  { label: 'Horizontal', w: 1528, h: 1080 },
];

export function defaultConfig(brandName: string): QrPosterConfig {
  const w = 1080;
  const h = 1528;
  const qrSize = 560;
  const qrX = (w - qrSize) / 2;
  return {
    canvas: { w, h },
    bg: { type: 'solid', color1: '#FFFFFF' },
    qr: {
      x: qrX,
      y: 620,
      size: qrSize,
      fg: '#0A0A0A',
      bg: '#FFFFFF',
    },
    texts: {
      title: {
        text: 'Escanea para ver',
        x: w / 2,
        y: 220,
        font: 'Inter, system-ui, sans-serif',
        fontLabel: 'Inter',
        size: 64,
        color: '#0A0A0A',
        weight: 700,
        align: 'center',
      },
      subtitle: {
        text: 'el menú y pedir',
        x: w / 2,
        y: 320,
        font: 'Inter, system-ui, sans-serif',
        fontLabel: 'Inter',
        size: 72,
        color: '#22C55E',
        weight: 900,
        align: 'center',
      },
      cta: {
        text: '↑ Apúntame con tu cámara',
        x: w / 2,
        y: 1240,
        font: 'Inter, system-ui, sans-serif',
        fontLabel: 'Inter',
        size: 36,
        color: '#0A0A0A',
        weight: 600,
        align: 'center',
      },
      brand: {
        text: brandName,
        x: w / 2,
        y: 120,
        font: 'Inter, system-ui, sans-serif',
        fontLabel: 'Inter',
        size: 42,
        color: '#0A0A0A',
        weight: 700,
        align: 'center',
        auto: true,
      },
    },
    showClubifyFooter: true,
  };
}

/**
 * Migración defensiva. Si en el futuro evoluciona el shape de config y
 * un tenant tiene un poster viejo, esta función completa los campos que
 * falten con defaults. Por ahora retorna el config tal cual si parece
 * válido.
 */
export function normalizeConfig(
  cfg: Partial<QrPosterConfig> | null | undefined,
  brandName: string,
): QrPosterConfig {
  const def = defaultConfig(brandName);
  if (!cfg || typeof cfg !== 'object') return def;
  return {
    canvas: cfg.canvas ?? def.canvas,
    bg: (cfg.bg as BgConfig) ?? def.bg,
    qr: { ...def.qr, ...(cfg.qr ?? {}) },
    texts: {
      title: { ...def.texts.title, ...(cfg.texts?.title ?? {}) },
      subtitle: { ...def.texts.subtitle, ...(cfg.texts?.subtitle ?? {}) },
      cta: { ...def.texts.cta, ...(cfg.texts?.cta ?? {}) },
      brand: { ...def.texts.brand, ...(cfg.texts?.brand ?? {}) },
    },
    showClubifyFooter: true,
  };
}
