/**
 * Catálogo de templates prediseñados para el editor QR. Hardcoded en
 * frontend (no DB) — son "skins" estilísticos que el dueño aplica con
 * un click. Cuando se aplica, se mergea sobre el config actual: cambian
 * estilo (bg, colores, fuentes, copy sugerido) pero PRESERVAN el canvas,
 * posiciones de los elementos y meta type-specific del usuario.
 *
 * Para agregar más templates en el futuro, solo añadir entradas acá. Si
 * llega un pedido de "templates editables por super admin", migrar a
 * tabla Prisma `QrPosterTemplate` siguiendo el shape de QrTemplate.
 */
import type {
  BgConfig,
  CanvasConfig,
  CustomTextLayer,
  QrConfig,
  QrPosterConfig,
  ShapeLayer,
  TextLayer,
} from './qr-poster-config';
import { rescaleForCanvas } from './qr-poster-config';

export type QrTemplateCategory =
  | 'food'
  | 'fitness'
  | 'beauty'
  | 'service'
  | 'generic';

export type QrTemplate = {
  id: string;
  name: string;
  category: QrTemplateCategory;
  /** Mini-swatch para renderizar la tarjeta del template en la galería. */
  swatch: { from: string; to?: string; text: string };
  overrides: {
    bg: BgConfig;
    qr: Partial<QrConfig>;
    texts: {
      title?: Partial<TextLayer>;
      subtitle?: Partial<TextLayer>;
      cta?: Partial<TextLayer>;
      brand?: Partial<TextLayer>;
    };
    /** Shapes a inyectar EN BLOQUE — reemplazan las shapes actuales.
     *  Útil para templates con layouts pre-armados (sticker promo,
     *  fondo curvo, etc). El template los inyecta con IDs propios. */
    shapes?: ShapeLayer[];
    /** Cajas de texto extra que vienen con el template — además de
     *  los 4 fijos (title/subtitle/cta/brand). */
    customTexts?: CustomTextLayer[];
    /** Canvas ideal del template — si está definido, applyTemplate
     *  cambia el canvas Y reescala todos los elementos del current.
     *  Sin esto los templates con shapes coordeadas a 1900×1000
     *  quedan desbordados al aplicarse sobre un canvas distinto. */
    canvas?: CanvasConfig;
  };
};

const INTER = 'Inter, system-ui, sans-serif';
const PLAYFAIR = '"Playfair Display", Georgia, serif';
const BEBAS = '"Bebas Neue", Impact, sans-serif';
const POPPINS = 'Poppins, sans-serif';
// const MONTSERRAT = 'Montserrat, sans-serif';

export const QR_TEMPLATES: QrTemplate[] = [
  {
    id: 'minimal-white',
    name: 'Minimalista',
    category: 'generic',
    swatch: { from: '#FFFFFF', text: '#0A0A0A' },
    overrides: {
      bg: { type: 'solid', color1: '#FFFFFF' },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#0A0A0A', font: INTER, fontLabel: 'Inter', weight: 700 },
        subtitle: { color: '#0A0A0A', font: INTER, fontLabel: 'Inter', weight: 900 },
        cta: { color: '#6B7280', font: INTER, fontLabel: 'Inter', weight: 500 },
        brand: { color: '#0A0A0A', font: INTER, fontLabel: 'Inter', weight: 700 },
      },
    },
  },
  {
    id: 'cafe-aroma',
    name: 'Café Aroma',
    category: 'food',
    swatch: { from: '#F5E6D3', to: '#A0522D', text: '#3E2723' },
    overrides: {
      bg: {
        type: 'gradient',
        color1: '#F5E6D3',
        color2: '#D2691E',
        angle: 135,
      },
      qr: { fg: '#3E2723', bg: '#FFF8E7' },
      texts: {
        title: { color: '#3E2723', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700 },
        subtitle: { color: '#6B3410', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 900, text: 'nuestro menú' },
        cta: { color: '#3E2723', font: INTER, fontLabel: 'Inter', weight: 600, text: 'Escaneá con tu cámara ↑' },
        brand: { color: '#3E2723', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700 },
      },
    },
  },
  {
    id: 'restaurante-premium',
    name: 'Restaurante Premium',
    category: 'food',
    swatch: { from: '#0A0A0A', to: '#D4AF37', text: '#D4AF37' },
    overrides: {
      bg: { type: 'solid', color1: '#0A0A0A' },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#D4AF37', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700, text: 'Bienvenidos' },
        subtitle: { color: '#FFFFFF', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 900, text: 'Carta digital' },
        cta: { color: '#D4AF37', font: INTER, fontLabel: 'Inter', weight: 500 },
        brand: { color: '#D4AF37', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700 },
      },
    },
  },
  {
    id: 'cowork-tech',
    name: 'Cowork Tech',
    category: 'service',
    swatch: { from: '#6366F1', to: '#A855F7', text: '#FFFFFF' },
    overrides: {
      bg: { type: 'gradient', color1: '#6366F1', color2: '#A855F7', angle: 135 },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 700 },
        subtitle: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 900 },
        cta: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 500 },
        brand: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 700 },
      },
    },
  },
  {
    id: 'gym-power',
    name: 'Gym Power',
    category: 'fitness',
    swatch: { from: '#0A0A0A', to: '#EF4444', text: '#EF4444' },
    overrides: {
      bg: { type: 'solid', color1: '#0A0A0A' },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#FFFFFF', font: BEBAS, fontLabel: 'Bebas Neue', weight: 700, text: 'ENTRENÁ' },
        subtitle: { color: '#EF4444', font: BEBAS, fontLabel: 'Bebas Neue', weight: 900, text: 'COMO UN CAMPEÓN' },
        cta: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 700, text: 'ESCANEÁ Y RESERVÁ' },
        brand: { color: '#EF4444', font: BEBAS, fontLabel: 'Bebas Neue', weight: 700 },
      },
    },
  },
  {
    id: 'barberia-vintage',
    name: 'Barbería Vintage',
    category: 'beauty',
    swatch: { from: '#F5E6D3', to: '#8B4513', text: '#3E2723' },
    overrides: {
      bg: { type: 'solid', color1: '#F5E6D3' },
      qr: { fg: '#3E2723', bg: '#FFF8E7' },
      texts: {
        title: { color: '#3E2723', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700, text: 'Reservá tu turno' },
        subtitle: { color: '#8B4513', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 900, text: 'sin esperar' },
        cta: { color: '#3E2723', font: INTER, fontLabel: 'Inter', weight: 500 },
        brand: { color: '#3E2723', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700 },
      },
    },
  },
  {
    id: 'premium-dorado',
    name: 'Premium Dorado',
    category: 'generic',
    swatch: { from: '#1A1A1A', to: '#D4AF37', text: '#D4AF37' },
    overrides: {
      bg: { type: 'gradient', color1: '#1A1A1A', color2: '#3A2F1A', angle: 135 },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#D4AF37', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700 },
        subtitle: { color: '#FFFFFF', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 900 },
        cta: { color: '#D4AF37', font: INTER, fontLabel: 'Inter', weight: 500 },
        brand: { color: '#D4AF37', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 700 },
      },
    },
  },
  {
    id: 'moderno-verde',
    name: 'Moderno Verde',
    category: 'generic',
    swatch: { from: '#22C55E', to: '#86EFAC', text: '#FFFFFF' },
    overrides: {
      bg: { type: 'gradient', color1: '#22C55E', color2: '#4ADE80', angle: 135 },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 700 },
        subtitle: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 900 },
        cta: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 600 },
        brand: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 700 },
      },
    },
  },
  {
    id: 'elegante-tipo',
    name: 'Elegante Tipográfico',
    category: 'generic',
    swatch: { from: '#FFFFFF', to: '#0A0A0A', text: '#0A0A0A' },
    overrides: {
      bg: { type: 'solid', color1: '#FAFAFA' },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#0A0A0A', font: BEBAS, fontLabel: 'Bebas Neue', weight: 700, size: 88 },
        subtitle: { color: '#0A0A0A', font: PLAYFAIR, fontLabel: 'Playfair Display', weight: 400 },
        cta: { color: '#6B7280', font: INTER, fontLabel: 'Inter', weight: 500 },
        brand: { color: '#0A0A0A', font: BEBAS, fontLabel: 'Bebas Neue', weight: 700 },
      },
    },
  },
  {
    id: 'sticker-rosa',
    name: 'Sticker Rosa',
    category: 'beauty',
    swatch: { from: '#EC4899', to: '#F472B6', text: '#FFFFFF' },
    overrides: {
      bg: { type: 'gradient', color1: '#EC4899', color2: '#F472B6', angle: 135 },
      qr: { fg: '#831843', bg: '#FFFFFF' },
      texts: {
        title: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 700 },
        subtitle: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 900 },
        cta: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 600 },
        brand: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 700 },
      },
    },
  },
  {
    id: 'cafe-cozy',
    name: 'Cafetería Cozy',
    category: 'food',
    swatch: { from: '#FB923C', to: '#F59E0B', text: '#FFFFFF' },
    overrides: {
      bg: { type: 'gradient', color1: '#FB923C', color2: '#F59E0B', angle: 135 },
      qr: { fg: '#7C2D12', bg: '#FFFFFF' },
      texts: {
        title: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 700 },
        subtitle: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 900 },
        cta: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 600 },
        brand: { color: '#FFFFFF', font: POPPINS, fontLabel: 'Poppins', weight: 700 },
      },
    },
  },
  {
    id: 'fitness-electric',
    name: 'Fitness Eléctrico',
    category: 'fitness',
    swatch: { from: '#3B82F6', to: '#06B6D4', text: '#FFFFFF' },
    overrides: {
      bg: { type: 'gradient', color1: '#3B82F6', color2: '#06B6D4', angle: 135 },
      qr: { fg: '#0A0A0A', bg: '#FFFFFF' },
      texts: {
        title: { color: '#FFFFFF', font: BEBAS, fontLabel: 'Bebas Neue', weight: 700, text: 'ACTIVÁ' },
        subtitle: { color: '#FFFFFF', font: BEBAS, fontLabel: 'Bebas Neue', weight: 900, text: 'TU MEMBRESÍA' },
        cta: { color: '#FFFFFF', font: INTER, fontLabel: 'Inter', weight: 600 },
        brand: { color: '#FFFFFF', font: BEBAS, fontLabel: 'Bebas Neue', weight: 700 },
      },
    },
  },
  // ─────────────────────────────────────────────────────────────
  // Nudo Cookie — promo descuento con sticker tipo cafetería boutique.
  // Replica el diseño marrón curvo + cream square + burst 10% off del
  // input visual de referencia. Layout horizontal premium.
  // ─────────────────────────────────────────────────────────────
  {
    id: 'nudo-cookie',
    name: 'Nudo Cookie',
    category: 'food',
    swatch: { from: '#4A2C20', to: '#A78A6C', text: '#F5EBDC' },
    overrides: {
      // Canvas horizontal 1920×1080 — coords del template dimensionadas
      // a este tamaño. applyTemplate cambia el canvas + reescala los
      // elementos del cliente para que todo entre cuando se aplica.
      canvas: {
        w: 1920,
        h: 1080,
        mm: { w: 297, h: 167 },
        dpi: 300,
      },
      bg: { type: 'solid', color1: '#FFFFFF' },
      qr: {
        x: 230,
        y: 400,
        size: 360,
        fg: '#3D2418',
        bg: '#F5EBDC',
        padding: 20,
        paddingColor: '#F5EBDC',
        cornerRadius: 12,
      },
      texts: {
        // Marca arriba a la izquierda. El cliente debería sustituir el
        // brandName del tenant; queda como anchor.
        brand: {
          color: '#F5EBDC',
          font: '"Bebas Neue", Impact, sans-serif',
          fontLabel: 'Bebas Neue',
          weight: 700,
          size: 56,
          x: 140,
          y: 80,
          align: 'left',
        },
        // "Escanea" — handwritten grande
        title: {
          color: '#F5EBDC',
          font: 'Pacifico, cursive',
          fontLabel: 'Pacifico',
          weight: 400,
          size: 120,
          text: 'Escanea',
          x: 720,
          y: 280,
          align: 'left',
        },
        // "y obten un" — bajada del título
        subtitle: {
          color: '#F5EBDC',
          font: INTER,
          fontLabel: 'Inter',
          weight: 400,
          size: 48,
          text: 'y obten un',
          x: 740,
          y: 420,
          align: 'left',
        },
        // "En tu primera compra"
        cta: {
          color: '#F5EBDC',
          font: INTER,
          fontLabel: 'Inter',
          weight: 700,
          size: 56,
          text: 'En tu primera\ncompra',
          x: 700,
          y: 620,
          align: 'left',
          lineHeight: 1.1,
        },
      },
      // Layout pre-armado: fondo marrón curvo (rounded rect grande) +
      // círculo grande a la izq (la "bump") + cream square para el QR
      // + burst sticker "10% OFF" a la derecha.
      shapes: [
        // 1. Background curvo principal — rounded rect marrón grande
        {
          id: 'nudo-bg-main',
          type: 'roundedRect',
          x: 280,
          y: 60,
          w: 1520,
          h: 880,
          fill: '#4A2C20',
          borderRadius: 80,
          opacity: 1,
        },
        // 2. Círculo grande a la izquierda — la "bump" del diseño
        {
          id: 'nudo-circle-bump',
          type: 'circle',
          x: 60,
          y: 60,
          w: 880,
          h: 880,
          fill: '#4A2C20',
          opacity: 1,
        },
        // 3. Cream square para el QR — fondo claro del bloque QR
        {
          id: 'nudo-qr-bg',
          type: 'roundedRect',
          x: 200,
          y: 370,
          w: 420,
          h: 420,
          fill: '#F5EBDC',
          borderRadius: 16,
          opacity: 1,
        },
        // 4. Burst sticker promocional — "10% OFF"
        {
          id: 'nudo-burst-10-off',
          type: 'burst',
          x: 1480,
          y: 200,
          w: 360,
          h: 360,
          fill: '#A78A6C',
          points: 18,
          innerRadiusFactor: 0.84,
          rotation: -8,
          innerText: {
            text: '10%\noff',
            color: '#F5EBDC',
            size: 76,
            font: INTER,
            weight: 900,
            lineHeight: 0.95,
          },
        },
      ],
    },
  },
];

export function applyTemplate(
  current: QrPosterConfig,
  tpl: QrTemplate,
): QrPosterConfig {
  // Si el template trae canvas, cambiamos el canvas primero. Aplicamos
  // rescaleForCanvas para que elementos EXISTENTES (logo, etc) se
  // reposicionen al nuevo tamaño. DESPUÉS las shapes/customTexts del
  // template se inyectan SIN re-escalar (sus coords ya están en el
  // sistema de coords del nuevo canvas).
  let base = current;
  if (tpl.overrides.canvas) {
    base = rescaleForCanvas(current, {
      w: tpl.overrides.canvas.w,
      h: tpl.overrides.canvas.h,
      mm: tpl.overrides.canvas.mm,
      dpi: tpl.overrides.canvas.dpi,
    });
  }
  return {
    ...base,
    bg: tpl.overrides.bg,
    qr: { ...base.qr, ...tpl.overrides.qr },
    texts: {
      title: { ...base.texts.title, ...(tpl.overrides.texts.title ?? {}) },
      subtitle: {
        ...base.texts.subtitle,
        ...(tpl.overrides.texts.subtitle ?? {}),
      },
      cta: { ...base.texts.cta, ...(tpl.overrides.texts.cta ?? {}) },
      brand: { ...base.texts.brand, ...(tpl.overrides.texts.brand ?? {}) },
    },
    // Templates con shapes/customTexts (ej "Nudo Cookie") REEMPLAZAN
    // los existentes para que el layout pre-armado se vea bien.
    ...(tpl.overrides.shapes ? { shapes: tpl.overrides.shapes } : {}),
    ...(tpl.overrides.customTexts
      ? { customTexts: tpl.overrides.customTexts }
      : {}),
  };
}
