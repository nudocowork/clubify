/**
 * Estilos visuales pre-armados para tarjetas wallet (Apple/Google).
 * Cada template setea los 6 colores que componen el wallet pass:
 * primary/secondary + stampActive/Inactive/Contour + centerBg.
 *
 * Pensado para el wizard de creación de cards (paso 4 "Diseño") —
 * el dueño elige un estilo en un click en vez de elegir 6 colores
 * a mano. Después puede ajustar individualmente con el ColorPicker.
 *
 * NO toca: stampIcon, heroImageUrl, fontFamily, copy. Esos quedan
 * con los defaults del template de la card (Step1 — los CardTemplate
 * por rubro) o se setean en otros pasos.
 */

export type WalletStyle = {
  id: string;
  name: string;
  /** Categoría visual sugerida (para agrupar/filtrar en el picker). */
  category: 'food' | 'fitness' | 'beauty' | 'service' | 'retail' | 'premium';
  /** Mini preview en el thumbnail del picker. */
  swatch: { from: string; to: string };
  /** Aplicable a wallet pass. */
  colors: {
    primaryColor: string;
    secondaryColor: string;
    stampActiveColor: string;
    stampInactiveColor: string;
    stampContourColor: string;
    centerBgColor: string;
  };
};

export const WALLET_STYLES: WalletStyle[] = [
  {
    id: 'cafe-mocha',
    name: 'Café Mocha',
    category: 'food',
    swatch: { from: '#4A2C20', to: '#A78A6C' },
    colors: {
      primaryColor: '#4A2C20',
      secondaryColor: '#A78A6C',
      stampActiveColor: '#F5EBDC',
      stampInactiveColor: '#3D2418',
      stampContourColor: '#A78A6C',
      centerBgColor: '#5A3528',
    },
  },
  {
    id: 'restaurante-burdeos',
    name: 'Restaurante Burdeos',
    category: 'food',
    swatch: { from: '#7B1F2B', to: '#E8C16F' },
    colors: {
      primaryColor: '#7B1F2B',
      secondaryColor: '#E8C16F',
      stampActiveColor: '#E8C16F',
      stampInactiveColor: '#5A1620',
      stampContourColor: '#E8C16F',
      centerBgColor: '#8E2533',
    },
  },
  {
    id: 'pasteleria-rosa',
    name: 'Pastelería Rosa',
    category: 'food',
    swatch: { from: '#FCE7F3', to: '#EC4899' },
    colors: {
      primaryColor: '#FCE7F3',
      secondaryColor: '#EC4899',
      stampActiveColor: '#EC4899',
      stampInactiveColor: '#FBCFE8',
      stampContourColor: '#BE185D',
      centerBgColor: '#FBCFE8',
    },
  },
  {
    id: 'boutique-pastel',
    name: 'Boutique Pastel',
    category: 'beauty',
    swatch: { from: '#FED7AA', to: '#FDBA74' },
    colors: {
      primaryColor: '#FED7AA',
      secondaryColor: '#9A3412',
      stampActiveColor: '#9A3412',
      stampInactiveColor: '#FFEDD5',
      stampContourColor: '#C2410C',
      centerBgColor: '#FFEDD5',
    },
  },
  {
    id: 'belleza-lila',
    name: 'Belleza Lila',
    category: 'beauty',
    swatch: { from: '#7C3AED', to: '#F3E8FF' },
    colors: {
      primaryColor: '#7C3AED',
      secondaryColor: '#F3E8FF',
      stampActiveColor: '#F3E8FF',
      stampInactiveColor: '#5B21B6',
      stampContourColor: '#A78BFA',
      centerBgColor: '#6D28D9',
    },
  },
  {
    id: 'fitness-electrico',
    name: 'Fitness Eléctrico',
    category: 'fitness',
    swatch: { from: '#06B6D4', to: '#3B82F6' },
    colors: {
      primaryColor: '#06B6D4',
      secondaryColor: '#3B82F6',
      stampActiveColor: '#FFFFFF',
      stampInactiveColor: '#0E7490',
      stampContourColor: '#67E8F9',
      centerBgColor: '#0891B2',
    },
  },
  {
    id: 'gym-volt',
    name: 'Gym Volt',
    category: 'fitness',
    swatch: { from: '#0A0A0A', to: '#A3E635' },
    colors: {
      primaryColor: '#0A0A0A',
      secondaryColor: '#A3E635',
      stampActiveColor: '#A3E635',
      stampInactiveColor: '#1F2937',
      stampContourColor: '#84CC16',
      centerBgColor: '#171717',
    },
  },
  {
    id: 'tech-minimalista',
    name: 'Tech Minimalista',
    category: 'service',
    swatch: { from: '#0F172A', to: '#E5E7EB' },
    colors: {
      primaryColor: '#0F172A',
      secondaryColor: '#E5E7EB',
      stampActiveColor: '#FFFFFF',
      stampInactiveColor: '#1E293B',
      stampContourColor: '#94A3B8',
      centerBgColor: '#1F2937',
    },
  },
  {
    id: 'gold-premium',
    name: 'Gold Premium',
    category: 'premium',
    swatch: { from: '#000000', to: '#D4AF37' },
    colors: {
      primaryColor: '#000000',
      secondaryColor: '#D4AF37',
      stampActiveColor: '#D4AF37',
      stampInactiveColor: '#1A1A1A',
      stampContourColor: '#FFD700',
      centerBgColor: '#0D0D0D',
    },
  },
  {
    id: 'tropical-vibes',
    name: 'Tropical Vibes',
    category: 'food',
    swatch: { from: '#F97316', to: '#10B981' },
    colors: {
      primaryColor: '#F97316',
      secondaryColor: '#10B981',
      stampActiveColor: '#FFFFFF',
      stampInactiveColor: '#C2410C',
      stampContourColor: '#FB923C',
      centerBgColor: '#EA580C',
    },
  },
  {
    id: 'eco-natural',
    name: 'Eco Natural',
    category: 'retail',
    swatch: { from: '#15803D', to: '#FAFAF9' },
    colors: {
      primaryColor: '#15803D',
      secondaryColor: '#FAFAF9',
      stampActiveColor: '#FAFAF9',
      stampInactiveColor: '#14532D',
      stampContourColor: '#86EFAC',
      centerBgColor: '#166534',
    },
  },
  {
    id: 'club-noche',
    name: 'Club Nocturno',
    category: 'service',
    swatch: { from: '#1E1B4B', to: '#EC4899' },
    colors: {
      primaryColor: '#1E1B4B',
      secondaryColor: '#EC4899',
      stampActiveColor: '#EC4899',
      stampInactiveColor: '#312E81',
      stampContourColor: '#F0ABFC',
      centerBgColor: '#2E1065',
    },
  },
];

export const WALLET_STYLE_CATEGORY_LABELS: Record<
  WalletStyle['category'],
  string
> = {
  food: 'Comida y bebida',
  fitness: 'Fitness',
  beauty: 'Belleza',
  service: 'Servicio',
  retail: 'Retail',
  premium: 'Premium',
};
