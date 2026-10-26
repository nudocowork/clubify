// Academia interactiva — registro canónico de módulos que pueden tener un
// video-tutorial. La clave (`key`) debe coincidir con ACADEMY_MODULE_KEYS del
// backend. Este registro alimenta la página /admin/academia; el botón contextual
// lo pinta la barra superior del panel, junto al buscador, cuando la página lo
// declara con <PanelHeader tutorial="..."> (ver components/PanelHeader).
//
// Agregar un módulo nuevo: sumar su entrada aquí + su clave en el backend +
// pasar `tutorial="<clave>"` al <PanelHeader> de la página del módulo.
export type AcademyModuleDef = {
  key: string;
  /** Nombre del módulo mostrado en la config y usado como título por defecto del popup. */
  label: string;
  /** Dónde aparece el botón (referencia para el admin en la config). */
  where: string;
};

export const ACADEMY_MODULES: AcademyModuleDef[] = [
  { key: 'dashboard', label: 'Panel (Dashboard)', where: 'Barra superior, junto al buscador' },
  { key: 'wallet', label: 'Tarjetas Wallet', where: 'Barra superior, junto al buscador' },
  { key: 'clientes', label: 'Clientes', where: 'Barra superior, junto al buscador' },
  { key: 'push', label: 'Push', where: 'Barra superior, junto al buscador' },
  { key: 'reviews', label: 'Reseñas de Google', where: 'Barra superior, junto al buscador' },
  { key: 'agenda', label: 'Agenda del Día', where: 'Barra superior, junto al buscador' },
  { key: 'plano', label: 'Plano de Mesas', where: 'Barra superior, junto al buscador' },
  { key: 'eventos', label: 'Eventos', where: 'Barra superior, junto al buscador' },
  { key: 'reservas-online', label: 'Reservas Online', where: 'Barra superior, junto al buscador' },
  { key: 'reportes', label: 'Reportes', where: 'Barra superior, junto al buscador' },
  { key: 'qr', label: 'QR (Menú, Mostrador, Descuento, InfoLink)', where: 'Barra superior, junto al buscador' },
  { key: 'infolink', label: 'InfoLink', where: 'Barra superior, junto al buscador' },
  { key: 'menu', label: 'Menú', where: 'Barra superior, junto al buscador' },
  { key: 'menu-libro', label: 'Menú Libro', where: 'Barra superior, junto al buscador' },
  { key: 'traducciones', label: 'Traducciones', where: 'Barra superior, junto al buscador' },
  { key: 'pedidos', label: 'Pedidos', where: 'Barra superior, junto al buscador' },
  { key: 'equipo', label: 'Equipo de Trabajo', where: 'Barra superior, junto al buscador' },
  { key: 'configuracion', label: 'Configuración', where: 'Barra superior, junto al buscador' },
  { key: 'referidos', label: 'Referidos', where: 'Barra superior, junto al buscador' },
  { key: 'historial-sellos', label: 'Historial de sellos', where: 'Barra superior, junto al buscador' },
  { key: 'alianzas', label: 'Alianzas', where: 'Barra superior, junto al buscador' },
  { key: 'club', label: 'Tarjeta de Club', where: 'Barra superior, junto al buscador' },
  { key: 'servicios', label: 'Servicios y agenda', where: 'Barra superior, junto al buscador' },
  { key: 'configura-menu', label: 'Configura tu menú', where: 'Barra superior, junto al buscador' },
  { key: 'promociones', label: 'Promociones', where: 'Barra superior, junto al buscador' },
  { key: 'analitica', label: 'Analítica', where: 'Barra superior, junto al buscador' },
  { key: 'estadisticas', label: 'Estadísticas', where: 'Barra superior, junto al buscador' },
  { key: 'ubicaciones', label: 'Ubicaciones / Sedes', where: 'Barra superior, junto al buscador' },
  { key: 'automatizaciones', label: 'Automatizaciones', where: 'Barra superior, junto al buscador' },
  { key: 'mensajes', label: 'Mensajes', where: 'Barra superior, junto al buscador' },
  { key: 'insignias', label: 'Insignias', where: 'Barra superior, junto al buscador' },
  { key: 'suscripcion', label: 'Suscripción y facturación', where: 'Barra superior, junto al buscador' },
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
