/**
 * QR Poster — configuración compartida entre los 4 tipos (MENU,
 * COUNTER, DISCOUNT, REVIEWS). El JSON se persiste tal cual en
 * QrPoster.config (Prisma). El editor visual de Konva consume/produce
 * este shape. La URL destino del QR NO va acá — se calcula en render
 * time según el `type` para que el QR siga siendo dinámico.
 */

export type QrPosterType = 'MENU' | 'COUNTER' | 'DISCOUNT' | 'REVIEWS';

/** Configuración de fondo. Puede ser sólido, gradiente o imagen.
 *  Las tres variantes admiten ajustes finos comunes (opacity, overlay,
 *  blur) para que el dueño componga fondos visualmente ricos. */
export type BgConfig =
  | {
      type: 'solid';
      color1: string;
      /** 0..1 — opacidad global del fondo (default 1). */
      opacity?: number;
    }
  | {
      type: 'gradient';
      /** Subtipo del gradiente. 'linear' usa angle (0-360) para
       *  dirección. 'radial' crece del centro hacia afuera. 'diagonal'
       *  es un alias preset de linear con angle=135. */
      subtype?: 'linear' | 'radial' | 'diagonal';
      color1: string;
      color2: string;
      angle: number;
      opacity?: number;
    }
  | {
      type: 'image';
      url: string;
      /** Zoom relativo (1 = cover por defecto). 1.5 = imagen 50% más
       *  grande, útil para enfocar una parte específica. */
      zoom?: number;
      /** Offset relativo al canvas (px). Permite encuadrar la imagen. */
      offsetX?: number;
      offsetY?: number;
      /** Filtro de blur en px (0..40). Útil para que las capas de texto
       *  encima sean legibles. */
      blur?: number;
      /** Color de overlay encima de la imagen (alpha en hex8 o nombre).
       *  null/undefined = sin overlay. */
      overlayColor?: string | null;
      /** Opacidad del overlay (0..1). */
      overlayOpacity?: number;
      opacity?: number;
    };

export type QrConfig = {
  x: number; // px from canvas top-left
  y: number;
  size: number; // square side in px
  fg: string; // dot/module color
  bg: string; // QR background (paper)
  /** 0..1 — opacidad del QR (default 1) */
  opacity?: number;
};

export type TextLayer = {
  /** Soporta saltos de línea con "\n". El UI usa <textarea> para que
   *  el cliente pueda dar ENTER. Konva.Text renderea cada línea. */
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
  align: 'left' | 'center' | 'right' | 'justify';
  /** 0..1 — opacidad del texto (default 1) */
  opacity?: number;
  /** Grados (-180..180). Default 0. */
  rotation?: number;
  /** Multiplicador del alto de línea. 1 = lineHeight = size px,
   *  1.2 = 20% más (default), 1.5 para textos espaciados. */
  lineHeight?: number;
  /** Ancho de la caja de texto en px. Si null, usa todo el ancho del
   *  canvas (para centrar/justificar a página). Si seteado, el texto
   *  se alinea DENTRO de la caja anclada en (x, y). */
  boxWidth?: number | null;
  /** Sombra del texto. */
  shadow?: {
    color: string;
    blur: number; // px
    offsetX: number;
    offsetY: number;
    opacity?: number;
  } | null;
  /** Espaciado entre letras en px. Default 0. */
  letterSpacing?: number;
};

/** Caja de texto libre que el usuario agrega manualmente. Igual que
 *  TextLayer pero con id propio + flags de UX (locked/hidden) para que
 *  el editor permita gestionar muchos sin romper el resto del flujo.
 *  Los 4 textos fijos (title/subtitle/cta/brand) siguen existiendo
 *  como antes para backward-compat — esto es ADICIONAL. */
export type CustomTextLayer = TextLayer & {
  id: string;
  /** Si true, no se puede mover/editar desde el canvas (sí desde el
   *  sidebar). UX típica de Canva/Figma. */
  locked?: boolean;
  /** Si true, no se renderea — pero se conserva en el cfg. */
  hidden?: boolean;
};

/** Layer del logo del negocio (opcional). Se pinta como imagen Konva. */
export type LogoLayer = {
  url: string;
  x: number;
  y: number;
  size: number; // ancho/alto en px (logo cuadrado)
  opacity?: number;
  rotation?: number;
};

/** Formas standalone — rectángulo o círculo decorativos. Cada una con
 *  su id estable para drag-reorder en el panel de capas.
 *  DEPRECATED: el editor ya no expone "Formas" en UI. Mantenemos el
 *  tipo + render para que posters viejos sigan visualizándose. */
export type ShapeLayer = {
  id: string;
  type: 'rect' | 'circle';
  x: number;
  y: number;
  /** Ancho (rect) o diámetro (circle). h se usa solo en rect. */
  w: number;
  h: number;
  fill: string;
  opacity?: number;
  /** Solo rect — radio de esquinas. */
  borderRadius?: number;
  stroke?: string;
  strokeWidth?: number;
};

/** Capa de "icono" — emoji renderizado como Konva.Text (sin
 *  rasterización SVG, más simple y portable). */
export type IconLayer = {
  id: string;
  emoji: string;
  x: number;
  y: number;
  size: number;
  opacity?: number;
  rotation?: number;
};

/** Capa de imagen libre subida por el dueño. Reemplaza a "Forma".
 *  La URL puede ser data URL (base64) o URL externa (R2). Si externa,
 *  Konva carga con crossOrigin=anonymous para que el export funcione. */
export type ImageLayer = {
  id: string;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity?: number;
  rotation?: number;
  /** Si true, mantenemos el aspecto al redimensionar manualmente. */
  keepAspect?: boolean;
  /** Rect del source de la imagen a usar (px sobre la imagen original).
   *  Sirve para crop — Konva.Image acepta `crop` con este shape. Si
   *  null, se usa toda la imagen. */
  crop?: { x: number; y: number; width: number; height: number } | null;
  /** Modo de ajuste cuando el aspect del rect no matchea con el aspect
   *  del crop (o de la imagen). 'cover' = llena el rect, 'contain' =
   *  ajusta dentro, 'fill' = estira. Default 'cover'. */
  fit?: 'cover' | 'contain' | 'fill';
};

/** Patrón generado a partir de uno o varios emojis. Se renderiza
 *  tileado sobre toda la superficie del lienzo (o sobre un área
 *  delimitada). Pensado para usarse como decoración detrás del QR. */
export type PatternLayer = {
  id: string;
  /** Emojis que componen el patrón. Se intercalan en grid. */
  emojis: string[];
  /** Tamaño de cada emoji en px. */
  size: number;
  /** Distancia entre celdas en px (gap). 0 = celdas adyacentes. */
  gap: number;
  /** 0..1 — opacidad global. */
  opacity: number;
  /** Rotación de cada emoji individualmente (grados). */
  rotation: number;
  /** Densidad: 0..1 — probabilidad de pintar cada celda. 1 = pintar
   *  todas, 0.5 = saltear la mitad (efecto disperso). */
  density: number;
  /** Si false, el patrón cubre solo un sub-rect. Si true (default),
   *  cubre todo el canvas. */
  fullCanvas?: boolean;
  /** Cuando fullCanvas=false, área a cubrir. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Seed determinístico para que la densidad sub-1 sea estable entre
   *  renders (sino cada drag re-randomiza el patrón). */
  seed?: number;
};

/** ID estable de cada capa para el sistema de z-order. Los texts/qr/bg
 *  son fijos (un solo elemento); shapes/icons/images/patterns usan id
 *  dinámico. */
export type LayerId =
  | 'bg'
  | 'qr'
  | 'logo'
  | 'text.title'
  | 'text.subtitle'
  | 'text.cta'
  | 'text.brand'
  | 'footer'
  | `shape.${string}`
  | `icon.${string}`
  | `image.${string}`
  | `pattern.${string}`
  | `customText.${string}`;

export type CanvasConfig = {
  /** Ancho/alto del lienzo Konva en px. */
  w: number;
  h: number;
  /** Medida física para imprenta. Si está, se usa al exportar para
   *  calcular el pixelRatio que alcance el DPI configurado. */
  mm?: { w: number; h: number };
  /** DPI de exportación. Default 300. Mayor = archivo más pesado pero
   *  más nítido al imprimir grande. */
  dpi?: number;
};

export type QrPosterConfig = {
  canvas: CanvasConfig;
  /** Si 'circle', el canvas se clipea a una circunferencia centrada —
   *  útil para imprentar carteles circulares (acrílico, sticker). */
  clipShape?: 'circle';
  bg: BgConfig;
  qr: QrConfig;
  /** Logo del negocio. Null = no mostrar. */
  logo?: LogoLayer | null;
  shapes?: ShapeLayer[];
  icons?: IconLayer[];
  images?: ImageLayer[];
  patterns?: PatternLayer[];
  /** Cajas de texto libres agregadas por el usuario (item 4 del spec).
   *  Independientes de los 4 textos fijos. */
  customTexts?: CustomTextLayer[];
  texts: {
    title: TextLayer;
    subtitle: TextLayer;
    cta: TextLayer;
    brand: TextLayer & { auto: boolean };
  };
  /** Orden visual de las capas (back → front). Si falta, se usa el
   *  orden default basado en los tipos. */
  layerOrder?: LayerId[];
  /** Footer "Powered by Clubify" — siempre visible (no removible, ver
   *  feedback_clubify_branding_locked memory). */
  showClubifyFooter: true;
  /** Datos opaque type-specific (cardId para COUNTER, promoCode para
   *  DISCOUNT, etc). Persisten en config.meta JSON; el editor los trata
   *  como caja negra. */
  meta?: Record<string, any>;
};

/** Orden default de capas (back → front). Si la config no tiene
 *  layerOrder explícito, se calcula esto. Los patterns van inmediatamente
 *  después del bg para que actúen como decoración de fondo. Las imágenes
 *  libres y formas (deprecated) van detrás de los textos. */
export function defaultLayerOrder(cfg: QrPosterConfig): LayerId[] {
  const patternIds: LayerId[] = (cfg.patterns ?? []).map(
    (p) => `pattern.${p.id}` as LayerId,
  );
  const shapeIds: LayerId[] = (cfg.shapes ?? []).map(
    (s) => `shape.${s.id}` as LayerId,
  );
  const imageIds: LayerId[] = (cfg.images ?? []).map(
    (i) => `image.${i.id}` as LayerId,
  );
  const iconIds: LayerId[] = (cfg.icons ?? []).map(
    (i) => `icon.${i.id}` as LayerId,
  );
  const customTextIds: LayerId[] = (cfg.customTexts ?? []).map(
    (t) => `customText.${t.id}` as LayerId,
  );
  return [
    'bg',
    ...patternIds,
    ...shapeIds,
    ...imageIds,
    'qr',
    'logo',
    'text.brand',
    'text.title',
    'text.subtitle',
    'text.cta',
    ...customTextIds,
    ...iconIds,
    'footer',
  ];
}

/** Filtra el layerOrder guardado para incluir solo IDs que aún existen
 *  en cfg (un shape borrado no debería seguir apareciendo). Y appendea
 *  IDs nuevos que el user agregó después de que se guardó layerOrder. */
export function effectiveLayerOrder(cfg: QrPosterConfig): LayerId[] {
  const defaultOrder = defaultLayerOrder(cfg);
  if (!cfg.layerOrder) return defaultOrder;
  const validSet = new Set(defaultOrder);
  const filtered = cfg.layerOrder.filter((id) => validSet.has(id));
  const filteredSet = new Set(filtered);
  for (const id of defaultOrder) {
    if (!filteredSet.has(id)) filtered.push(id);
  }
  return filtered;
}

export type FontOption = {
  label: string;
  value: string;
  /** Pesos disponibles para esta familia en la URL de Google Fonts. */
  weights: number[];
  /** Categoría tipográfica para agrupar en el picker. */
  category: 'sans' | 'serif' | 'display' | 'handwriting' | 'mono';
};

/** Biblioteca de tipografías. Cubre los estilos más usados en
 *  cartelería (sans neutras, serif elegantes, display impactantes,
 *  handwriting, mono). Se cargan dinámicamente desde Google Fonts —
 *  ver ensureFontsLoaded() en QrPosterEditor. */
export const FONT_OPTIONS: FontOption[] = [
  // Sans-serif (uso general)
  { label: 'Inter', value: 'Inter, system-ui, sans-serif', weights: [400, 600, 700, 900], category: 'sans' },
  { label: 'Poppins', value: 'Poppins, sans-serif', weights: [400, 600, 700, 900], category: 'sans' },
  { label: 'Montserrat', value: 'Montserrat, sans-serif', weights: [400, 600, 700, 900], category: 'sans' },
  { label: 'Manrope', value: 'Manrope, sans-serif', weights: [400, 600, 700, 800], category: 'sans' },
  { label: 'DM Sans', value: '"DM Sans", sans-serif', weights: [400, 700, 900], category: 'sans' },
  { label: 'Plus Jakarta Sans', value: '"Plus Jakarta Sans", sans-serif', weights: [400, 600, 700, 800], category: 'sans' },
  { label: 'Outfit', value: 'Outfit, sans-serif', weights: [400, 600, 700, 900], category: 'sans' },
  { label: 'Sora', value: 'Sora, sans-serif', weights: [400, 600, 700, 800], category: 'sans' },
  { label: 'Work Sans', value: '"Work Sans", sans-serif', weights: [400, 600, 700, 900], category: 'sans' },
  { label: 'Nunito', value: 'Nunito, sans-serif', weights: [400, 700, 900], category: 'sans' },
  { label: 'Raleway', value: 'Raleway, sans-serif', weights: [400, 600, 700, 900], category: 'sans' },
  { label: 'Lato', value: 'Lato, sans-serif', weights: [400, 700, 900], category: 'sans' },
  { label: 'Oswald', value: 'Oswald, sans-serif', weights: [400, 600, 700], category: 'sans' },

  // Serif (elegancia, lujo)
  { label: 'Playfair Display', value: '"Playfair Display", Georgia, serif', weights: [400, 700, 900], category: 'serif' },
  { label: 'Lora', value: 'Lora, serif', weights: [400, 600, 700], category: 'serif' },
  { label: 'Merriweather', value: 'Merriweather, serif', weights: [400, 700, 900], category: 'serif' },
  { label: 'Cormorant Garamond', value: '"Cormorant Garamond", serif', weights: [400, 600, 700], category: 'serif' },
  { label: 'Libre Baskerville', value: '"Libre Baskerville", serif', weights: [400, 700], category: 'serif' },
  { label: 'EB Garamond', value: '"EB Garamond", serif', weights: [400, 600, 700], category: 'serif' },
  { label: 'DM Serif Display', value: '"DM Serif Display", serif', weights: [400], category: 'serif' },

  // Display (impactantes, para títulos grandes)
  { label: 'Bebas Neue', value: '"Bebas Neue", Impact, sans-serif', weights: [400], category: 'display' },
  { label: 'Anton', value: 'Anton, sans-serif', weights: [400], category: 'display' },
  { label: 'Archivo Black', value: '"Archivo Black", sans-serif', weights: [400], category: 'display' },
  { label: 'Russo One', value: '"Russo One", sans-serif', weights: [400], category: 'display' },
  { label: 'Black Ops One', value: '"Black Ops One", sans-serif', weights: [400], category: 'display' },
  { label: 'Righteous', value: 'Righteous, sans-serif', weights: [400], category: 'display' },
  { label: 'Bangers', value: 'Bangers, sans-serif', weights: [400], category: 'display' },
  { label: 'Fredoka', value: 'Fredoka, sans-serif', weights: [400, 600, 700], category: 'display' },
  { label: 'Permanent Marker', value: '"Permanent Marker", sans-serif', weights: [400], category: 'display' },

  // Handwriting / script
  { label: 'Pacifico', value: 'Pacifico, cursive', weights: [400], category: 'handwriting' },
  { label: 'Caveat', value: 'Caveat, cursive', weights: [400, 700], category: 'handwriting' },
  { label: 'Dancing Script', value: '"Dancing Script", cursive', weights: [400, 700], category: 'handwriting' },
  { label: 'Great Vibes', value: '"Great Vibes", cursive', weights: [400], category: 'handwriting' },
  { label: 'Satisfy', value: 'Satisfy, cursive', weights: [400], category: 'handwriting' },
  { label: 'Kalam', value: 'Kalam, cursive', weights: [400, 700], category: 'handwriting' },
  { label: 'Shadows Into Light', value: '"Shadows Into Light", cursive', weights: [400], category: 'handwriting' },

  // Mono
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace', weights: [400, 600, 700], category: 'mono' },
  { label: 'Fira Code', value: '"Fira Code", monospace', weights: [400, 600, 700], category: 'mono' },
  { label: 'Space Mono', value: '"Space Mono", monospace', weights: [400, 700], category: 'mono' },
];

/** Categorías tipográficas con su label en español. */
export const FONT_CATEGORY_LABELS: Record<FontOption['category'], string> = {
  sans: 'Sans-serif',
  serif: 'Serif',
  display: 'Display',
  handwriting: 'Manuscrita',
  mono: 'Monoespaciada',
};

/** Construye la URL de Google Fonts para cargar TODAS las fuentes
 *  declaradas en FONT_OPTIONS con sus pesos. Una sola request al
 *  CDN, los browsers cachean. */
export function googleFontsUrl(): string {
  // Nombres de Google: usar el label pero remover comillas y reemplazar
  // espacios por '+'. Filtrar Inter porque ya viene system-friendly y
  // las system fonts (system-ui, monospace, etc).
  const families = FONT_OPTIONS.map((f) => {
    const name = f.label;
    if (f.weights.length === 1 && f.weights[0] === 400) {
      return `family=${name.replace(/ /g, '+')}`;
    }
    return `family=${name.replace(/ /g, '+')}:wght@${f.weights.join(';')}`;
  }).join('&');
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

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
  { label: 'Circular 10cm', w: 1080, h: 1080, mm: { w: 100, h: 100 } },
  { label: 'Circular 15cm', w: 1080, h: 1080, mm: { w: 150, h: 150 } },
];

/** Catálogo curado de emojis quick-pick. Para búsqueda completa se
 *  usa la biblioteca extendida en emoji-library.ts. */
export const ICON_EMOJI_CATALOG: { group: string; emojis: string[] }[] = [
  {
    group: 'Comida & bebida',
    emojis: ['☕', '🍕', '🍔', '🍟', '🌮', '🍣', '🍰', '🍦', '🍷', '🍺', '🥗', '🍲'],
  },
  {
    group: 'Fitness & belleza',
    emojis: ['💪', '🏋️', '🧘', '💆', '💇', '💅', '✂️', '💄', '🌸', '✨'],
  },
  {
    group: 'Marketing & promos',
    emojis: ['🎁', '🏷️', '💰', '💸', '🎉', '🎊', '⭐', '🌟', '🔥', '💎', '🏆', '🎯'],
  },
  {
    group: 'Acciones',
    emojis: ['📱', '📲', '👇', '👆', '👉', '👈', '✅', '🆕', '⚡', '🚀', '❤️', '✨'],
  },
];

/** Pixel ratio para que el export alcance el DPI físico requerido. */
/** Estimación del bounding box VISUAL real de un TextLayer, considerando
 *  multilínea (split por "\n") + lineHeight + alineación. Es heurístico
 *  (no usa Konva.Text.measureSize) — sirve para smart guides + snap.
 *  Para la medición precisa al exportar se usa Konva directo.
 *
 *  Devuelve la box del CONTENIDO visual del texto, NO el ancho de la
 *  caja contenedora completa (boxWidth/canvas.w). Esto hace que los
 *  guides snapean al centro REAL del texto, no a la caja.
 */
export function estimateTextBox(
  t: TextLayer,
  canvasW: number,
): { x: number; y: number; w: number; h: number } {
  const lineHeight = t.lineHeight ?? 1.2;
  const lines = (t.text || ' ').split('\n');
  // Width aprox de cada línea: chars * size * 0.5 (heurística genérica
  // que se queda corta para tipografías mono pero alcanza para guides).
  const widestLine = lines.reduce((max, line) => {
    const w = Math.max(t.size, line.length * t.size * 0.5);
    return Math.max(max, w);
  }, 0);
  const totalH = lines.length * t.size * lineHeight;

  // Box X: depende de la alineación. Si el texto está centrado/justificado
  // dentro de una boxWidth (o full canvas), su X visual se calcula desde
  // el anclaje y la alineación.
  const containerW = t.boxWidth ?? canvasW;
  const containerX = t.boxWidth != null ? t.x : 0;
  let visualX = containerX;
  if (t.align === 'center') {
    visualX = containerX + (containerW - widestLine) / 2;
  } else if (t.align === 'right') {
    visualX = containerX + containerW - widestLine;
  }
  // Para 'justify' sin width definida, usa todo el ancho del contenedor
  if (t.align === 'justify') {
    visualX = containerX;
    return { x: visualX, y: t.y, w: containerW, h: totalH };
  }
  return { x: visualX, y: t.y, w: widestLine, h: totalH };
}

export function pixelRatioForDpi(canvas: CanvasConfig): number {
  const mm = canvas.mm ?? { w: 210, h: 297 };
  const dpi = canvas.dpi ?? 300;
  // 1 inch = 25.4 mm → factor px/mm = dpi / 25.4
  const pxPerMm = dpi / 25.4;
  const targetW = mm.w * pxPerMm;
  return Math.max(1, targetW / canvas.w);
}

/** Alias backward-compat (algunos call-sites antiguos usaban este nombre). */
export function pixelRatioFor300Dpi(canvas: CanvasConfig): number {
  return pixelRatioForDpi({ ...canvas, dpi: 300 });
}

/** Re-escala todas las posiciones del cfg a un canvas nuevo, manteniendo
 *  cada elemento en la misma posición RELATIVA. Tamaños se preservan
 *  para que el texto/QR no se distorsione. Si después del re-escalado
 *  algún elemento queda fuera del canvas, se clampea al borde. */
export function rescaleForCanvas(
  cfg: QrPosterConfig,
  newCanvas: { w: number; h: number; mm?: { w: number; h: number }; dpi?: number },
): QrPosterConfig {
  const sx = newCanvas.w / cfg.canvas.w;
  const sy = newCanvas.h / cfg.canvas.h;
  const clampX = (x: number, elemW = 0) =>
    Math.max(0, Math.min(newCanvas.w - elemW, x));
  const clampY = (y: number, elemH = 0) =>
    Math.max(0, Math.min(newCanvas.h - elemH, y));

  return {
    ...cfg,
    canvas: { ...newCanvas, dpi: newCanvas.dpi ?? cfg.canvas.dpi },
    qr: {
      ...cfg.qr,
      x: clampX(Math.round(cfg.qr.x * sx), cfg.qr.size),
      y: clampY(Math.round(cfg.qr.y * sy), cfg.qr.size),
    },
    logo: cfg.logo
      ? {
          ...cfg.logo,
          x: clampX(Math.round(cfg.logo.x * sx), cfg.logo.size),
          y: clampY(Math.round(cfg.logo.y * sy), cfg.logo.size),
        }
      : cfg.logo,
    texts: {
      title: {
        ...cfg.texts.title,
        x: Math.round(cfg.texts.title.x * sx),
        y: clampY(Math.round(cfg.texts.title.y * sy), cfg.texts.title.size),
      },
      subtitle: {
        ...cfg.texts.subtitle,
        x: Math.round(cfg.texts.subtitle.x * sx),
        y: clampY(
          Math.round(cfg.texts.subtitle.y * sy),
          cfg.texts.subtitle.size,
        ),
      },
      cta: {
        ...cfg.texts.cta,
        x: Math.round(cfg.texts.cta.x * sx),
        y: clampY(Math.round(cfg.texts.cta.y * sy), cfg.texts.cta.size),
      },
      brand: {
        ...cfg.texts.brand,
        x: Math.round(cfg.texts.brand.x * sx),
        y: clampY(Math.round(cfg.texts.brand.y * sy), cfg.texts.brand.size),
      },
    },
    shapes: (cfg.shapes ?? []).map((s) => ({
      ...s,
      x: clampX(Math.round(s.x * sx), s.w),
      y: clampY(Math.round(s.y * sy), s.h),
    })),
    icons: (cfg.icons ?? []).map((i) => ({
      ...i,
      x: clampX(Math.round(i.x * sx), i.size),
      y: clampY(Math.round(i.y * sy), i.size),
    })),
    images: (cfg.images ?? []).map((im) => ({
      ...im,
      x: clampX(Math.round(im.x * sx), im.w),
      y: clampY(Math.round(im.y * sy), im.h),
    })),
    patterns: (cfg.patterns ?? []).map((p) => ({
      ...p,
      x: p.x !== undefined ? clampX(Math.round(p.x * sx), p.w ?? 0) : p.x,
      y: p.y !== undefined ? clampY(Math.round(p.y * sy), p.h ?? 0) : p.y,
    })),
    customTexts: (cfg.customTexts ?? []).map((t) => ({
      ...t,
      x: Math.round(t.x * sx),
      y: clampY(Math.round(t.y * sy), t.size),
      ...(t.boxWidth != null ? { boxWidth: Math.round(t.boxWidth * sx) } : {}),
    })),
  };
}

export function defaultConfig(brandName: string): QrPosterConfig {
  const w = 1080;
  const h = 1528;
  const qrSize = 560;
  const qrX = (w - qrSize) / 2;
  return {
    canvas: { w, h, mm: { w: 210, h: 297 }, dpi: 300 },
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
    canvas: cfg.canvas
      ? { ...cfg.canvas, dpi: cfg.canvas.dpi ?? 300 }
      : def.canvas,
    clipShape: cfg.clipShape,
    bg: (cfg.bg as BgConfig) ?? def.bg,
    qr: { ...def.qr, ...(cfg.qr ?? {}) },
    logo: cfg.logo ?? null,
    shapes: Array.isArray(cfg.shapes) ? cfg.shapes : [],
    icons: Array.isArray(cfg.icons) ? cfg.icons : [],
    images: Array.isArray(cfg.images) ? cfg.images : [],
    patterns: Array.isArray(cfg.patterns) ? cfg.patterns : [],
    customTexts: Array.isArray(cfg.customTexts) ? cfg.customTexts : [],
    texts: {
      title: { ...def.texts.title, ...(cfg.texts?.title ?? {}) },
      subtitle: { ...def.texts.subtitle, ...(cfg.texts?.subtitle ?? {}) },
      cta: { ...def.texts.cta, ...(cfg.texts?.cta ?? {}) },
      brand: { ...def.texts.brand, ...(cfg.texts?.brand ?? {}) },
    },
    layerOrder: Array.isArray(cfg.layerOrder) ? cfg.layerOrder : undefined,
    showClubifyFooter: true,
    meta: cfg.meta ?? {},
  };
}
