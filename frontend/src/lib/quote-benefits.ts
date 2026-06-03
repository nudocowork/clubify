// Beneficios por plan reutilizables entre el wizard, el preview y el PDF
// de la cotización. Mantener UNA fuente de verdad aquí: cualquier cambio en
// la descripción de qué incluye Elite/Pro se refleja en los 3 lugares.

export type QuotePlan = 'ELITE' | 'PRO';

export type PlanBenefit = {
  icon: string; // emoji
  title: string;
  description: string;
};

// Beneficios incluidos en Elite (4). Pro hereda TODOS estos + los extras.
export const ELITE_BENEFITS: PlanBenefit[] = [
  {
    icon: '🎟️',
    title: 'Tarjetas de fidelización',
    description:
      'Sellos, puntos, cashback o visitas en Apple/Google Wallet, sin app que descargar.',
  },
  {
    icon: '📱',
    title: 'Menú digital',
    description:
      'Catálogo visual con fotos, precios y modificadores, accesible por QR desde la mesa.',
  },
  {
    icon: '🔗',
    title: 'Infolinks',
    description:
      'Mini-sitio del negocio con horarios, ubicación, redes, equipo y promociones activas.',
  },
  {
    icon: '⭐',
    title: 'Reseñas de Google',
    description:
      'Filtro inteligente: 4-5★ van directo a Google; 1-3★ se capturan como feedback privado.',
  },
];

// Beneficios adicionales SOLO del plan Pro.
export const PRO_EXTRA_BENEFITS: PlanBenefit[] = [
  {
    icon: '🤖',
    title: 'Automatizaciones WhatsApp',
    description:
      'Mensajes automáticos: bienvenida, cumpleaños, inactividad, cerca de recompensa.',
  },
  {
    icon: '🛵',
    title: 'Menú delivery',
    description:
      'Catálogo extendido con domicilio: zonas, costos y tiempos de entrega configurables.',
  },
  {
    icon: '💬',
    title: 'Toma de pedidos por WhatsApp',
    description:
      'El cliente arma su pedido en el menú y llega completo al WhatsApp del local.',
  },
  {
    icon: '📋',
    title: 'Administrativo',
    description:
      'Recordatorios automáticos a empleados + gestión de proveedores y órdenes de compra.',
  },
];

export function getPlanBenefits(plan: QuotePlan): PlanBenefit[] {
  return plan === 'ELITE'
    ? ELITE_BENEFITS
    : [...ELITE_BENEFITS, ...PRO_EXTRA_BENEFITS];
}

// Para la tabla comparativa (Fase 4): cada feature dice en qué planes está
// incluida. El orden importa — así se renderiza en el comparativo.
export const COMPARISON_FEATURES: { label: string; elite: boolean; pro: boolean }[] = [
  { label: 'Tarjetas de fidelización', elite: true, pro: true },
  { label: 'Menú digital', elite: true, pro: true },
  { label: 'Infolinks', elite: true, pro: true },
  { label: 'Reseñas de Google', elite: true, pro: true },
  { label: 'Automatizaciones WhatsApp', elite: false, pro: true },
  { label: 'Menú delivery', elite: false, pro: true },
  { label: 'Toma de pedidos por WhatsApp', elite: false, pro: true },
  { label: 'Administrativo (recordatorios + proveedores)', elite: false, pro: true },
];
