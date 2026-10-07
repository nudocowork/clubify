import { SECCIONES_ADMIN } from './secciones-admin';

/**
 * La marca que el panel está VIENDO, leída de la URL.
 *
 * El middleware reescribe `/admin/<marca>/<seccion>` a `/admin/<seccion>` y
 * pasa el slug al servidor por el header `x-wl-slug`. En el navegador la URL
 * conserva el slug, así que el cliente puede leerlo de ahí — y lo necesita:
 * el panel maestro (soyfidelity.com) no es dominio de ninguna marca, así que
 * resolver por host devuelve siempre Clubify.
 */


/** `/admin/sellea/map` → `"sellea"` · `/admin/map` → `null`. */
export function marcaDeLaRuta(pathname: string): string | null {
  const m = pathname.match(/^\/admin\/([^/]+)(?:\/|$)/);
  if (!m) return null;
  const slug = m[1].toLowerCase();
  return SECCIONES_ADMIN.has(slug) ? null : slug;
}
