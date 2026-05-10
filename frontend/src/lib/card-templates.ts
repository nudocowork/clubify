/**
 * Plantillas pre-armadas de tarjetas de fidelización por rubro.
 * El dueño elige una en /app/cards/new (paso 1 del wizard) y todos los
 * campos se rellenan automáticamente — solo retoca lo que quiera.
 *
 * Mapeo a BUSINESS_CATEGORIES (categorySlug). Una categoría puede tener
 * varias plantillas (estampillas, descuento, etc.).
 */

export type CardType =
  | 'STAMPS'
  | 'POINTS'
  | 'DISCOUNT'
  | 'MEMBERSHIP'
  | 'COUPON'
  | 'GIFT'
  | 'MULTI'
  | 'CASHBACK'
  | 'VISITS'
  | 'HYBRID';

export type CardTemplate = {
  id: string;
  categorySlug: string;
  type: CardType;
  // Mostrado en el grid de plantillas
  displayName: string;
  // Valores que se inyectan al wizard de creación
  defaults: {
    name: string;
    rewardText: string;
    description?: string;
    terms?: string;
    primaryColor: string;
    secondaryColor: string;
    stampIcon?: string;
    stampsRequired?: number;
    discountPercent?: number;
    pointsPerCurrency?: number;
    cashbackPercent?: number;
    cashbackMinPurchase?: number;
    visitsRequired?: number;
    tiers?: Array<{
      name: string;
      threshold: number;
      perks?: string[];
      color?: string;
      icon?: string;
    }>;
    tierMetric?: 'spend' | 'visits' | 'stamps';
  };
};

export const CARD_TEMPLATES: CardTemplate[] = [
  // ─── Cafetería ───
  {
    id: 'cafe-8-sellos',
    categorySlug: 'coffee_shop',
    type: 'STAMPS',
    displayName: 'Café — 8 visitas, 1 gratis',
    defaults: {
      name: '8 cafés y el 9° es gratis',
      rewardText: '1 café gratis',
      primaryColor: '#7C5034',
      secondaryColor: '#3E2723',
      stampIcon: '☕',
      stampsRequired: 8,
    },
  },
  {
    id: 'cafe-discount-vip',
    categorySlug: 'coffee_shop',
    type: 'DISCOUNT',
    displayName: 'Cafetería VIP — 10% descuento',
    defaults: {
      name: 'Club VIP cafetería',
      rewardText: '10% en toda la barra',
      primaryColor: '#A0522D',
      secondaryColor: '#5D2E0E',
      discountPercent: 10,
    },
  },

  // ─── Restaurante ───
  {
    id: 'restaurant-10-platos',
    categorySlug: 'restaurant',
    type: 'STAMPS',
    displayName: 'Restaurante — 10 visitas, plato gratis',
    defaults: {
      name: '10 visitas, 1 plato gratis',
      rewardText: '1 plato principal a elección',
      primaryColor: '#B91C1C',
      secondaryColor: '#7F1D1D',
      stampIcon: '🍽',
      stampsRequired: 10,
    },
  },
  {
    id: 'restaurant-points',
    categorySlug: 'restaurant',
    type: 'POINTS',
    displayName: 'Restaurante — Puntos por consumo',
    defaults: {
      name: 'Puntos por cada visita',
      rewardText: '100 puntos = $20.000 en el menú',
      primaryColor: '#0F172A',
      secondaryColor: '#475569',
      pointsPerCurrency: 0.001,
    },
  },

  // ─── Panadería ───
  {
    id: 'bakery-7-sellos',
    categorySlug: 'bakery',
    type: 'STAMPS',
    displayName: 'Panadería — 7 productos, 1 gratis',
    defaults: {
      name: 'Compra 7 panes, llévate el 8°',
      rewardText: '1 producto a elección',
      primaryColor: '#D97706',
      secondaryColor: '#92400E',
      stampIcon: '🥐',
      stampsRequired: 7,
    },
  },

  // ─── Fast food ───
  {
    id: 'burger-6-sellos',
    categorySlug: 'fast_food',
    type: 'STAMPS',
    displayName: 'Hamburguesería — 6, 1 gratis',
    defaults: {
      name: '6 burgers y la 7ma gratis',
      rewardText: '1 burger sencilla',
      primaryColor: '#DC2626',
      secondaryColor: '#7F1D1D',
      stampIcon: '🍔',
      stampsRequired: 6,
    },
  },

  // ─── Heladería ───
  {
    id: 'icecream-5-sellos',
    categorySlug: 'ice_cream',
    type: 'STAMPS',
    displayName: 'Heladería — 5 helados, 1 gratis',
    defaults: {
      name: '5 helados, el 6° es gratis',
      rewardText: '1 helado de 1 sabor',
      primaryColor: '#EC4899',
      secondaryColor: '#A21CAF',
      stampIcon: '🍦',
      stampsRequired: 5,
    },
  },

  // ─── Bar ───
  {
    id: 'bar-8-sellos',
    categorySlug: 'bar',
    type: 'STAMPS',
    displayName: 'Bar — 8 visitas, trago gratis',
    defaults: {
      name: '8 visitas, 1 trago invita la casa',
      rewardText: '1 trago de la carta',
      primaryColor: '#1E1B4B',
      secondaryColor: '#312E81',
      stampIcon: '🍺',
      stampsRequired: 8,
    },
  },
  {
    id: 'bar-happy-hour',
    categorySlug: 'bar',
    type: 'DISCOUNT',
    displayName: 'Happy Hour — 20% off bebidas',
    defaults: {
      name: 'Happy Hour 20%',
      rewardText: '20% en bebidas hasta las 8pm',
      primaryColor: '#7C3AED',
      secondaryColor: '#4C1D95',
      discountPercent: 20,
    },
  },

  // ─── Barbería ───
  {
    id: 'barber-5-cortes',
    categorySlug: 'barbershop',
    type: 'STAMPS',
    displayName: 'Barbería — 5 cortes, el 6° gratis',
    defaults: {
      name: '5 cortes y el 6° es gratis',
      rewardText: '1 corte clásico',
      primaryColor: '#0F172A',
      secondaryColor: '#1E293B',
      stampIcon: '💈',
      stampsRequired: 5,
    },
  },

  // ─── Peluquería ───
  {
    id: 'hair-gift-card',
    categorySlug: 'hair_salon',
    type: 'GIFT',
    displayName: 'Peluquería — Tarjeta regalo',
    defaults: {
      name: 'Tarjeta de regalo peluquería',
      rewardText: 'Saldo para usar en cualquier servicio',
      primaryColor: '#EC4899',
      secondaryColor: '#831843',
    },
  },

  // ─── Belleza ───
  {
    id: 'beauty-discount',
    categorySlug: 'beauty_salon',
    type: 'DISCOUNT',
    displayName: 'Belleza — 10% en manicure',
    defaults: {
      name: 'Cliente VIP belleza',
      rewardText: '10% en manicure y pedicure',
      primaryColor: '#F472B6',
      secondaryColor: '#BE185D',
      discountPercent: 10,
    },
  },

  // ─── Spa ───
  {
    id: 'spa-5-sesiones',
    categorySlug: 'spa',
    type: 'STAMPS',
    displayName: 'Spa — 5 sesiones, 1 masaje gratis',
    defaults: {
      name: '5 sesiones, 1 masaje cortesía',
      rewardText: '1 masaje relajante 30 min',
      primaryColor: '#10B981',
      secondaryColor: '#065F46',
      stampIcon: '💆',
      stampsRequired: 5,
    },
  },

  // ─── Gym ───
  {
    id: 'gym-membership',
    categorySlug: 'gym',
    type: 'MEMBERSHIP',
    displayName: 'Gimnasio — Membresía mensual',
    defaults: {
      name: 'Miembro Premium',
      rewardText: 'Acceso ilimitado al gimnasio',
      primaryColor: '#22C55E',
      secondaryColor: '#15803D',
    },
  },

  // ─── Mascotas ───
  {
    id: 'pet-5-visitas',
    categorySlug: 'pet_shop',
    type: 'STAMPS',
    displayName: 'Veterinaria — 5 visitas, vacuna gratis',
    defaults: {
      name: '5 visitas, 1 vacuna sin costo',
      rewardText: '1 vacuna anual de cortesía',
      primaryColor: '#3B82F6',
      secondaryColor: '#1E40AF',
      stampIcon: '🐾',
      stampsRequired: 5,
    },
  },

  // ─── Lavandería ───
  {
    id: 'laundry-10-lavados',
    categorySlug: 'laundry',
    type: 'STAMPS',
    displayName: 'Lavandería — 10 lavados, 1 gratis',
    defaults: {
      name: '10 lavados, el 11° gratis',
      rewardText: '1 lavado completo',
      primaryColor: '#0EA5E9',
      secondaryColor: '#0C4A6E',
      stampIcon: '🧺',
      stampsRequired: 10,
    },
  },

  // ─── Autolavado ───
  {
    id: 'carwash-5-lavados',
    categorySlug: 'car_wash',
    type: 'STAMPS',
    displayName: 'Autolavado — 5 lavados, 1 gratis',
    defaults: {
      name: '5 lavados, el 6° gratis',
      rewardText: '1 lavado básico',
      primaryColor: '#1E40AF',
      secondaryColor: '#1E3A8A',
      stampIcon: '🚗',
      stampsRequired: 5,
    },
  },

  // ─── Floristería ───
  {
    id: 'florist-5-ramos',
    categorySlug: 'florist',
    type: 'STAMPS',
    displayName: 'Floristería — 5 ramos, 1 gratis',
    defaults: {
      name: '5 ramos, 1 cortesía',
      rewardText: '1 ramo pequeño a elección',
      primaryColor: '#F472B6',
      secondaryColor: '#BE185D',
      stampIcon: '💐',
      stampsRequired: 5,
    },
  },

  // ─── Tienda de ropa ───
  {
    id: 'clothing-discount-vip',
    categorySlug: 'clothing_store',
    type: 'DISCOUNT',
    displayName: 'Tienda — Cliente VIP 15%',
    defaults: {
      name: 'Cliente VIP — 15% descuento',
      rewardText: '15% en toda la tienda',
      primaryColor: '#7C3AED',
      secondaryColor: '#4C1D95',
      discountPercent: 15,
    },
  },

  // ─── Zapatería ───
  {
    id: 'shoe-5-stamps',
    categorySlug: 'shoe_store',
    type: 'STAMPS',
    displayName: 'Zapatería — Compra 5, lleva 1 gratis',
    defaults: {
      name: 'Cliente frecuente zapatería',
      rewardText: '1 par de medias o accesorio',
      primaryColor: '#374151',
      secondaryColor: '#111827',
      stampIcon: '👟',
      stampsRequired: 5,
    },
  },

  // ─── Mini market ───
  {
    id: 'mini-10-compras',
    categorySlug: 'mini_market',
    type: 'STAMPS',
    displayName: 'Tienda — 10 compras, 1 producto gratis',
    defaults: {
      name: '10 compras, 1 producto cortesía',
      rewardText: '1 producto del estante de ofertas',
      primaryColor: '#16A34A',
      secondaryColor: '#14532D',
      stampIcon: '🛒',
      stampsRequired: 10,
    },
  },

  // ─── Librería ───
  {
    id: 'bookstore-gift',
    categorySlug: 'bookstore',
    type: 'GIFT',
    displayName: 'Librería — Tarjeta regalo',
    defaults: {
      name: 'Tarjeta de regalo librería',
      rewardText: 'Saldo para libros y papelería',
      primaryColor: '#92400E',
      secondaryColor: '#451A03',
    },
  },

  // ─── Óptica ───
  {
    id: 'optical-coupon',
    categorySlug: 'optical',
    type: 'COUPON',
    displayName: 'Óptica — Cupón examen visual gratis',
    defaults: {
      name: 'Examen visual sin costo',
      rewardText: '1 examen visual gratis con tu compra',
      primaryColor: '#0EA5E9',
      secondaryColor: '#0C4A6E',
    },
  },

  // ─── Clínica dental ───
  {
    id: 'dental-discount',
    categorySlug: 'dental_clinic',
    type: 'DISCOUNT',
    displayName: 'Clínica dental — 10% limpieza',
    defaults: {
      name: '10% en limpieza dental',
      rewardText: '10% descuento en limpieza',
      primaryColor: '#06B6D4',
      secondaryColor: '#155E75',
      discountPercent: 10,
    },
  },

  // ─── Mecánica ───
  {
    id: 'mechanic-coupon',
    categorySlug: 'mechanic',
    type: 'COUPON',
    displayName: 'Taller — Aceite gratis al 5° servicio',
    defaults: {
      name: 'Aceite cortesía',
      rewardText: 'Cambio de aceite gratis',
      primaryColor: '#1F2937',
      secondaryColor: '#111827',
    },
  },

  // ─── Genéricas (other) ───
  {
    id: 'generic-stamps',
    categorySlug: 'other',
    type: 'STAMPS',
    displayName: 'Genérica — 10 visitas, 1 premio',
    defaults: {
      name: '10 visitas, 1 premio',
      rewardText: '1 producto o servicio gratis',
      primaryColor: '#6366F1',
      secondaryColor: '#3730A3',
      stampIcon: '⭐',
      stampsRequired: 10,
    },
  },
  {
    id: 'generic-points',
    categorySlug: 'other',
    type: 'POINTS',
    displayName: 'Genérica — Puntos por compra',
    defaults: {
      name: 'Puntos por cada compra',
      rewardText: '100 puntos = $10.000 de descuento',
      primaryColor: '#0EA5E9',
      secondaryColor: '#0369A1',
      pointsPerCurrency: 0.01,
    },
  },
  {
    id: 'generic-discount',
    categorySlug: 'other',
    type: 'DISCOUNT',
    displayName: 'Genérica — 10% off cliente VIP',
    defaults: {
      name: 'Cliente VIP — 10% off',
      rewardText: '10% en toda la tienda',
      primaryColor: '#F59E0B',
      secondaryColor: '#B45309',
      discountPercent: 10,
    },
  },

  // ─── Cashback (genéricas) ───
  {
    id: 'generic-cashback-5',
    categorySlug: 'other',
    type: 'CASHBACK',
    displayName: 'Cashback — 5% saldo en cada compra',
    defaults: {
      name: 'Cashback 5%',
      rewardText: 'Acumula saldo y úsalo cuando quieras',
      primaryColor: '#0F766E',
      secondaryColor: '#134E4A',
      cashbackPercent: 5,
      cashbackMinPurchase: 0,
    },
  },
  {
    id: 'restaurant-cashback-10',
    categorySlug: 'restaurant',
    type: 'CASHBACK',
    displayName: 'Restaurante — 10% cashback de la cuenta',
    defaults: {
      name: '10% cashback en cada visita',
      rewardText: 'Saldo que descuentas en próximas visitas',
      primaryColor: '#0E7490',
      secondaryColor: '#155E75',
      cashbackPercent: 10,
      cashbackMinPurchase: 30000,
    },
  },

  // ─── Visitas (frecuencia, no ticket) ───
  {
    id: 'gym-visits-20',
    categorySlug: 'gym',
    type: 'VISITS',
    displayName: 'Gym — 20 visitas, 1 mes gratis',
    defaults: {
      name: '20 visitas → 1 mes cortesía',
      rewardText: '1 mes de gimnasio sin costo',
      primaryColor: '#16A34A',
      secondaryColor: '#14532D',
      stampIcon: '💪',
      visitsRequired: 20,
    },
  },
  {
    id: 'yoga-visits-10',
    categorySlug: 'other',
    type: 'VISITS',
    displayName: 'Estudio — 10 clases, 1 gratis',
    defaults: {
      name: '10 clases, 1 cortesía',
      rewardText: '1 clase a elección',
      primaryColor: '#7C3AED',
      secondaryColor: '#4C1D95',
      stampIcon: '🧘',
      visitsRequired: 10,
    },
  },

  // ─── Híbridas (sellos + descuento + cashback) ───
  {
    id: 'hybrid-pro',
    categorySlug: 'other',
    type: 'HYBRID',
    displayName: 'Híbrida — Sellos + descuento VIP',
    defaults: {
      name: 'Premio cliente frecuente',
      rewardText: 'Gana sellos y disfruta descuento perpetuo',
      primaryColor: '#1E40AF',
      secondaryColor: '#1E3A8A',
      stampIcon: '⭐',
      stampsRequired: 10,
      discountPercent: 10,
    },
  },

  // ─── Membresías VIP con tiers ───
  {
    id: 'membership-tiers-vip',
    categorySlug: 'other',
    type: 'MEMBERSHIP',
    displayName: 'Membresía VIP — Silver / Gold / Black',
    defaults: {
      name: 'Membresía VIP',
      rewardText: 'Sube de nivel y desbloquea beneficios',
      primaryColor: '#0F172A',
      secondaryColor: '#1E293B',
      tierMetric: 'spend',
      tiers: [
        {
          name: 'Silver',
          threshold: 0,
          color: '#9CA3AF',
          icon: '🥈',
          perks: ['5% de descuento', 'Cumpleaños con regalo'],
        },
        {
          name: 'Gold',
          threshold: 500000,
          color: '#F59E0B',
          icon: '🥇',
          perks: ['10% de descuento', 'Atención prioritaria', 'Eventos privados'],
        },
        {
          name: 'Black',
          threshold: 2000000,
          color: '#111827',
          icon: '⚫',
          perks: ['15% de descuento', 'Concierge', 'Acceso ilimitado a beneficios'],
        },
      ],
    },
  },
];

export const TYPE_LABEL: Record<CardType, string> = {
  STAMPS: 'Sellos',
  POINTS: 'Puntos',
  DISCOUNT: 'Descuento',
  MEMBERSHIP: 'Suscripción',
  COUPON: 'Cupón',
  GIFT: 'Tarjeta de regalo',
  MULTI: 'Múltiple',
  CASHBACK: 'Cashback',
  VISITS: 'Visitas',
  HYBRID: 'Híbrida',
};

export const TYPE_EMOJI: Record<CardType, string> = {
  STAMPS: '☕',
  POINTS: '⭐',
  DISCOUNT: '%',
  MEMBERSHIP: '👑',
  COUPON: '🎟',
  GIFT: '🎁',
  MULTI: '✨',
  CASHBACK: '💰',
  VISITS: '🚶',
  HYBRID: '🔀',
};

export const TYPE_DESCRIPTION: Record<CardType, string> = {
  STAMPS: 'Acumula sellos por visita o compra y entrega un premio cada N sellos.',
  POINTS: 'Cliente acumula puntos según el monto de compra. Canjea por descuentos o productos.',
  DISCOUNT: 'Descuento fijo % en cada compra. Sin acumulación, beneficio inmediato.',
  MEMBERSHIP: 'Membresía/suscripción mensual o anual con beneficios exclusivos. Soporta tiers VIP (Silver/Gold/Black).',
  COUPON: 'Cupón único de regalo o promoción puntual (ej. "primera compra 50% off").',
  GIFT: 'Tarjeta con saldo precargado que el cliente compra o recibe como regalo.',
  MULTI: 'Combina varios mecanismos en una sola tarjeta (sellos + puntos + descuento).',
  CASHBACK: 'Devuelve un % en saldo de moneda por cada compra. El cliente lo usa contra pagos futuros.',
  VISITS: 'Punch card por frecuencia. Cada scan suma una visita, sin importar el ticket.',
  HYBRID: 'Combina sellos + descuento + cashback en una sola tarjeta. Pensada para clientes premium.',
};
