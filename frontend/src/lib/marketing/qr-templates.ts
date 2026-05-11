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
  QrConfig,
  QrPosterConfig,
  TextLayer,
} from './qr-poster-config';

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
    swatch: { from: '#6366F1', to: '#C026D3', text: '#FFFFFF' },
    overrides: {
      bg: { type: 'gradient', color1: '#6366F1', color2: '#C026D3', angle: 135 },
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
];

export function applyTemplate(
  current: QrPosterConfig,
  tpl: QrTemplate,
): QrPosterConfig {
  return {
    ...current,
    bg: tpl.overrides.bg,
    qr: { ...current.qr, ...tpl.overrides.qr },
    texts: {
      title: { ...current.texts.title, ...(tpl.overrides.texts.title ?? {}) },
      subtitle: {
        ...current.texts.subtitle,
        ...(tpl.overrides.texts.subtitle ?? {}),
      },
      cta: { ...current.texts.cta, ...(tpl.overrides.texts.cta ?? {}) },
      brand: { ...current.texts.brand, ...(tpl.overrides.texts.brand ?? {}) },
    },
  };
}
