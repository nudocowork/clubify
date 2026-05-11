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
  /** w/h son px internos del lienzo Konva (definen aspecto + precisión
   *  de layout). mm es la medida física para imprenta — se usa al
   *  exportar para calcular pixelRatio = 300 DPI. */
  canvas: { w: number; h: number; mm?: { w: number; h: number } };
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

export type CanvasPreset = {
  label: string;
  w: number;
  h: number;
  mm: { w: number; h: number };
};

export const CANVAS_PRESETS: CanvasPreset[] = [
  { label: 'A4 vertical', w: 1080, h: 1528, mm: { w: 210, h: 297 } },
  { label: 'A4 horizontal', w: 1528, h: 1080, mm: { w: 297, h: 210 } },
  { label: 'Carta US', w: 1080, h: 1397, mm: { w: 215.9, h: 279.4 } },
  { label: 'A3 poster', w: 1080, h: 1528, mm: { w: 297, h: 420 } },
  { label: 'Cuadrado', w: 1080, h: 1080, mm: { w: 210, h: 210 } },
  { label: 'Vertical alto', w: 1080, h: 1920, mm: { w: 148, h: 263 } },
  { label: 'Sticker 10cm', w: 1080, h: 1080, mm: { w: 100, h: 100 } },
  { label: 'Acrílico 10×15', w: 1080, h: 1528, mm: { w: 100, h: 150 } },
];

/** Pixel ratio para que el export a 300 DPI alcance la resolución física
 *  del preset. Si no hay mm definidos, asumimos A4 vertical. */
export function pixelRatioFor300Dpi(canvas: QrPosterConfig['canvas']): number {
  const mm = canvas.mm ?? { w: 210, h: 297 };
  // 300 DPI → 11.811 px/mm
  const targetW = mm.w * 11.811;
  return Math.max(1, targetW / canvas.w);
}

export function defaultConfig(brandName: string): QrPosterConfig {
  const w = 1080;
  const h = 1528;
  const qrSize = 560;
  const qrX = (w - qrSize) / 2;
  return {
    canvas: { w, h, mm: { w: 210, h: 297 } },
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
