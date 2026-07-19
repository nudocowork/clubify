// Academia interactiva — registro canónico de módulos que pueden tener un
// video-tutorial. La clave (`key`) debe coincidir con ACADEMY_MODULE_KEYS del
// backend. Este registro alimenta la página /admin/academia; el botón contextual
// (<AcademyButton moduleKey="...">) se coloca UNA vez en el header de cada módulo.
//
// Agregar un módulo nuevo: sumar su entrada aquí + su clave en el backend +
// colocar el botón en el header del módulo (una sola vez).
export type AcademyModuleDef = {
  key: string;
  /** Nombre del módulo mostrado en la config y usado como título por defecto del popup. */
  label: string;
  /** Dónde aparece el botón (referencia para el admin en la config). */
  where: string;
};

export const ACADEMY_MODULES: AcademyModuleDef[] = [
  { key: 'wallet', label: 'Tarjetas Wallet', where: 'Al lado de “Configura tu logo”' },
  { key: 'clientes', label: 'Clientes', where: 'Al lado del buscador por nombre' },
  { key: 'push', label: 'Push', where: 'Al lado del selector de ubicación' },
  { key: 'reviews', label: 'Reseñas de Google', where: 'Al lado de “Gestionar sedes”' },
  { key: 'agenda', label: 'Agenda del Día', where: 'Al lado del selector “Todas las sedes”' },
  { key: 'plano', label: 'Plano de Mesas', where: 'Al lado del selector “Todas las sedes”' },
  { key: 'eventos', label: 'Eventos', where: 'Al lado del botón “Nuevo evento”' },
  { key: 'reservas-online', label: 'Reservas Online', where: 'Al lado del buscador' },
  { key: 'reportes', label: 'Reportes', where: 'Al lado del selector “Todas las sedes”' },
  { key: 'qr', label: 'QR (Menú, Mostrador, Descuento, InfoLink)', where: 'Al lado del buscador' },
  { key: 'menu', label: 'Menú', where: 'Al lado del botón “Pedidos Delivery”' },
  { key: 'menu-libro', label: 'Menú Libro', where: 'Al lado del buscador' },
  { key: 'traducciones', label: 'Traducciones', where: 'Al lado del buscador' },
  { key: 'pedidos', label: 'Pedidos', where: 'Al lado del buscador' },
  { key: 'equipo', label: 'Equipo de Trabajo', where: 'Al lado de “Invitar al Equipo”' },
  { key: 'configuracion', label: 'Configuración', where: 'Al lado del buscador' },
  { key: 'referidos', label: 'Referidos', where: 'Al lado del buscador' },
];

export const ACADEMY_MODULE_LABEL: Record<string, string> = Object.fromEntries(
  ACADEMY_MODULES.map((m) => [m.key, m.label]),
);

/**
 * Extrae el ID de video de una URL de YouTube (watch?v=, youtu.be/, /embed/,
 * /shorts/, con parámetros). Devuelve null si no reconoce el formato.
 */
export function parseYouTubeId(url: string): string | null {
  const u = (url || '').trim();
  if (!u) return null;
  // ID directo (11 chars) pegado sin URL
  if (/^[a-zA-Z0-9_-]{11}$/.test(u)) return u;
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/, // watch?v=ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})/, // youtu.be/ID
    /\/embed\/([a-zA-Z0-9_-]{11})/, // /embed/ID
    /\/shorts\/([a-zA-Z0-9_-]{11})/, // /shorts/ID
    /\/live\/([a-zA-Z0-9_-]{11})/, // /live/ID
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return m[1];
  }
  return null;
}

/** URL de embed (nocookie, sin autoplay hasta el clic) a partir de una URL/ID. */
export function youTubeEmbedUrl(url: string): string | null {
  const id = parseYouTubeId(url);
  if (!id) return null;
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}
