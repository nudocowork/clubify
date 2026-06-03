/**
 * Misma lista que frontend/src/lib/business-categories.ts. Se duplica
 * intencionalmente para que el backend no dependa del frontend (NestJS
 * no comparte el espacio de imports). Si agregas una categoría aquí,
 * agrégala también en el archivo del frontend con los mismos modules.
 */

export type BusinessModule =
  | 'cards'
  | 'customers'
  | 'scanner'
  | 'push'
  | 'menu'
  | 'orders'
  | 'analytics'
  | 'staff'
  | 'info_links'
  | 'services';

export type BusinessCategory = {
  slug: string;
  name: string;
  emoji: string;
  description: string;
  modules: BusinessModule[];
  catalogLabel: 'menu' | 'catalog' | 'services';
};

const BASE_LOYALTY: BusinessModule[] = [
  'cards',
  'customers',
  'scanner',
  'push',
  'analytics',
  'staff',
  'info_links',
];

export const BUSINESS_CATEGORIES: BusinessCategory[] = [
  { slug: 'restaurant', name: 'Restaurante', emoji: '🍽', description: 'Comida con menú, pedidos en mesa o delivery, fidelización por sellos.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'menu' },
  { slug: 'coffee_shop', name: 'Cafetería', emoji: '☕', description: 'Café, té, postres. Fidelización por sellos y pedidos en mesa.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'menu' },
  { slug: 'bakery', name: 'Panadería / Pastelería', emoji: '🥐', description: 'Productos horneados, pedidos para llevar, fidelización por compra.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'menu' },
  { slug: 'fast_food', name: 'Comida rápida', emoji: '🍔', description: 'Hamburguesas, pizzas, alitas. Pedidos rápidos para llevar/domicilio.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'menu' },
  { slug: 'ice_cream', name: 'Heladería', emoji: '🍦', description: 'Helados y postres. Sellos por compra y pedidos.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'menu' },
  { slug: 'bar', name: 'Bar / Cantina', emoji: '🍺', description: 'Bebidas y picadas. Pedidos en mesa, fidelización por visitas.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'menu' },
  { slug: 'florist', name: 'Floristería', emoji: '💐', description: 'Arreglos florales con catálogo y pedidos a domicilio.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'catalog' },
  { slug: 'car_wash', name: 'Autolavado', emoji: '🚗', description: 'Servicios de lavado y detallado. Fidelización por visitas (5+1, 10+1).', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'barbershop', name: 'Barbería', emoji: '💈', description: 'Cortes, barba, perfilado. Sellos por visita y promociones.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'hair_salon', name: 'Peluquería', emoji: '💇‍♀️', description: 'Corte, color, tratamientos. Fidelización por servicio.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'beauty_salon', name: 'Estética / Belleza', emoji: '💅', description: 'Manicure, pedicure, depilación, faciales.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'spa', name: 'Spa / Masajes', emoji: '💆', description: 'Masajes y terapias. Fidelización por sesiones.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'gym', name: 'Gimnasio', emoji: '🏋️', description: 'Membresías, control de asistencia, fidelización por permanencia.', modules: [...BASE_LOYALTY], catalogLabel: 'menu' },
  { slug: 'pet_shop', name: 'Veterinaria / Pet Shop', emoji: '🐾', description: 'Servicios veterinarios + productos para mascotas. Fidelización dual.', modules: [...BASE_LOYALTY, 'menu', 'services'], catalogLabel: 'services' },
  { slug: 'laundry', name: 'Lavandería', emoji: '🧺', description: 'Lavado, planchado y tintorería. Fidelización por visitas.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'optical', name: 'Óptica', emoji: '👓', description: 'Exámenes visuales y monturas. Catálogo + servicios.', modules: [...BASE_LOYALTY, 'menu', 'services'], catalogLabel: 'catalog' },
  { slug: 'dental_clinic', name: 'Clínica dental', emoji: '🦷', description: 'Tratamientos odontológicos y promociones por servicio.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'mechanic', name: 'Taller mecánico', emoji: '🔧', description: 'Servicios automotrices y fidelización por visita.', modules: [...BASE_LOYALTY, 'services'], catalogLabel: 'services' },
  { slug: 'clothing_store', name: 'Tienda de ropa', emoji: '👕', description: 'Catálogo de ropa, fidelización por compra.', modules: [...BASE_LOYALTY, 'menu'], catalogLabel: 'catalog' },
  { slug: 'shoe_store', name: 'Zapatería', emoji: '👟', description: 'Calzado, catálogo y fidelización.', modules: [...BASE_LOYALTY, 'menu'], catalogLabel: 'catalog' },
  { slug: 'boutique', name: 'Boutique / Accesorios', emoji: '👜', description: 'Productos exclusivos, catálogo y club VIP.', modules: [...BASE_LOYALTY, 'menu'], catalogLabel: 'catalog' },
  { slug: 'bookstore', name: 'Librería / Papelería', emoji: '📚', description: 'Libros, papelería. Catálogo + fidelización.', modules: [...BASE_LOYALTY, 'menu'], catalogLabel: 'catalog' },
  { slug: 'mini_market', name: 'Tienda / Minimercado', emoji: '🏪', description: 'Productos de consumo, pedidos y fidelización.', modules: [...BASE_LOYALTY, 'menu', 'orders'], catalogLabel: 'catalog' },
  { slug: 'other', name: 'Otro', emoji: '🏬', description: 'Negocio con todas las funciones disponibles.', modules: [...BASE_LOYALTY, 'menu', 'orders', 'services'], catalogLabel: 'menu' },
];

export const DEFAULT_CATEGORY_SLUG = 'restaurant';

export function isValidCategorySlug(slug: string): boolean {
  return BUSINESS_CATEGORIES.some((c) => c.slug === slug);
}

export function getCategoryBySlug(slug: string | null | undefined): BusinessCategory {
  const found = BUSINESS_CATEGORIES.find((c) => c.slug === slug);
  if (found) return found;
  return BUSINESS_CATEGORIES.find((c) => c.slug === DEFAULT_CATEGORY_SLUG)!;
}

/**
 * Devuelve el label de sección principal visible al usuario.
 * Prioridad: override custom del tenant → mapping de la categoría → "Menú".
 */
export function resolveMainSectionLabel(
  override: string | null | undefined,
  businessCategorySlug: string | null | undefined,
): string {
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }
  const cat = getCategoryBySlug(businessCategorySlug);
  switch (cat.catalogLabel) {
    case 'services':
      return 'Servicios';
    case 'catalog':
      return 'Catálogo';
    default:
      return 'Menú';
  }
}
