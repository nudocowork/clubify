// Plantillas de cotización para el módulo SuperAdmin · Cotizaciones.
// Cada plantilla preselecciona paleta + textos sugeridos para que el asesor
// genere propuestas visualmente diferenciadas según el rubro del prospect.
// El slug se persiste en `Quote.templateSlug` y se usa para filtrar/agrupar
// en el CRM. Si más adelante se quiere agregar plantillas por categoría
// hay que agregarlas acá — no hay tabla en DB.

export type QuoteTemplate = {
  slug: string;
  name: string;
  emoji: string;
  // Color acento para el preview/PDF (paleta breve sin chocar con brand).
  accent: string;
  // 1 línea descriptiva visible en la card de selección.
  tagline: string;
  // Frases comerciales tipo "hook" que el asesor puede mostrar al cliente.
  // Se renderizan como bullets en el preview de la propuesta.
  highlights: string[];
};

export const QUOTE_TEMPLATES: QuoteTemplate[] = [
  {
    slug: 'restaurant',
    name: 'Restaurante',
    emoji: '🍽️',
    accent: '#E11D48',
    tagline: 'Para restaurantes que quieren llenar mesas con clientes recurrentes',
    highlights: [
      'Convierte cada comida en un sello digital que invita a volver',
      'Menú QR sin app, listo en 5 minutos',
      'Recibe pedidos de delivery directo al WhatsApp del local',
    ],
  },
  {
    slug: 'coffee_shop',
    name: 'Cafetería',
    emoji: '☕',
    accent: '#92400E',
    tagline: 'Programa de fidelización + menú visual para cafeterías',
    highlights: [
      '10 cafés y el 11 va por la casa, todo digital',
      'Catálogo con fotos y modificadores (leche, tamaño, sabor)',
      'Reseñas Google con un solo toque',
    ],
  },
  {
    slug: 'cowork',
    name: 'Cowork',
    emoji: '💼',
    accent: '#4F46E5',
    tagline: 'Membresías visibles, comunicación con miembros y delivery interno',
    highlights: [
      'Tarjeta de membresía digital en Apple/Google Wallet',
      'Infolinks: agenda, eventos, mapa de salas y reglas',
      'Pedidos de cafetería interna por WhatsApp',
    ],
  },
  {
    slug: 'gym',
    name: 'Gimnasio',
    emoji: '🏋️',
    accent: '#16A34A',
    tagline: 'Seguimiento de visitas, recordatorios y reseñas para gym/box',
    highlights: [
      'Tarjeta de visitas: ideal para clases y check-in diario',
      'Recordatorios automáticos por WhatsApp a inactivos',
      'Reseñas Google filtradas (5★ públicas, 1-3★ privadas)',
    ],
  },
  {
    slug: 'barber_shop',
    name: 'Barbería',
    emoji: '💈',
    accent: '#0F172A',
    tagline: 'Fidelización + agenda + reseñas para barberías y peluquerías',
    highlights: [
      'Tarjeta de sellos (10 cortes y el 11 gratis) digital',
      'Infolinks con horarios, equipo y promos',
      'WhatsApp del local con auto-respuestas y recordatorios',
    ],
  },
  {
    slug: 'other',
    name: 'Otro rubro',
    emoji: '✨',
    accent: '#6366F1',
    tagline: 'Plantilla neutra que funciona para cualquier negocio local',
    highlights: [
      'Programa de fidelización 100% digital',
      'Comunicación con clientes vía WhatsApp',
      'Infolinks: catálogo, ubicación, contacto y promos',
    ],
  },
];

export function getQuoteTemplateBySlug(slug: string | null | undefined) {
  if (!slug) return null;
  return QUOTE_TEMPLATES.find((t) => t.slug === slug) ?? null;
}
