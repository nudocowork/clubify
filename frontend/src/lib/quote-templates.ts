// Plantillas de cotización para el módulo SuperAdmin · Cotizaciones.
// Cada plantilla preselecciona paleta + textos sugeridos para que el asesor
// genere propuestas visualmente diferenciadas según el rubro del prospect.
// El slug se persiste en `Quote.templateSlug` y se usa para filtrar/agrupar
// en el CRM. Si más adelante se quiere agregar plantillas por categoría
// hay que agregarlas aquí — no hay tabla en DB.

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
    slug: 'bakery',
    name: 'Panadería',
    emoji: '🥐',
    accent: '#B45309',
    tagline: 'Fidelización + menú visual para panaderías y pastelerías',
    highlights: [
      'Tarjeta de sellos: por 10 panes compra el 11 gratis',
      'Catálogo visual con fotos de productos del día',
      'Recordatorios automáticos: "tu pedido está listo"',
    ],
  },
  {
    slug: 'beauty_salon',
    name: 'Estética / Peluquería',
    emoji: '💇',
    accent: '#DB2777',
    tagline: 'Fidelización + reseñas + agenda para estéticas y peluquerías',
    highlights: [
      'Cliente acumula visitas y desbloquea servicios bonus',
      'Reseñas Google filtradas para subir el rating',
      'Recordatorio automático antes de cada cita',
    ],
  },
  {
    slug: 'pet_shop',
    name: 'Veterinaria / Pet Shop',
    emoji: '🐾',
    accent: '#0EA5E9',
    tagline: 'Tarjeta + recordatorios + delivery para veterinarias',
    highlights: [
      'Tarjeta por mascota con historial de servicios',
      'Recordatorio de vacunas/baños vía WhatsApp automático',
      'Pedidos de alimento balanceado al WA del local',
    ],
  },
  {
    slug: 'car_wash',
    name: 'Autolavado',
    emoji: '🚗',
    accent: '#0891B2',
    tagline: 'Tarjeta de visitas + menú de servicios para autolavados',
    highlights: [
      'Tarjeta de visitas: cada 10 lavados, 1 gratis',
      'Menú de servicios con fotos y precios visibles',
      'Booking por WhatsApp para evitar esperas',
    ],
  },
  {
    slug: 'optical',
    name: 'Óptica',
    emoji: '👓',
    accent: '#7C3AED',
    tagline: 'Programa de fidelización + catálogo visual para ópticas',
    highlights: [
      'Catálogo de monturas con fotos y precios',
      'Recordatorio automático: "tu control visual anual"',
      'Reseñas Google para subir el rating del local',
    ],
  },
  {
    slug: 'dental',
    name: 'Clínica dental',
    emoji: '🦷',
    accent: '#0F766E',
    tagline: 'Tarjeta paciente + agenda + reseñas para clínicas dentales',
    highlights: [
      'Tarjeta paciente con historial de visitas',
      'Recordatorios automáticos de limpieza semestral',
      'Filtro Google: 5★ públicas, ≤3★ feedback privado',
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
