/** Cuánto tiempo se recuerda que a este cliente ya se le enseñó el aviso. */
const HORAS = 24;

/**
 * ¿Ya se le enseñó este aviso a este cliente?
 *
 * Antes la marca vivía en `sessionStorage`, que es POR PESTAÑA: el mismo aviso
 * volvía a salir en la página del link, otra vez en el menú y otra vez cada vez
 * que el cliente abría una pestaña nueva. Un cliente que compara dos productos
 * en dos pestañas lo veía tres veces en un minuto.
 *
 * Con `localStorage` y caducidad se le enseña una vez al día: sigue cumpliendo
 * su función —que se entere de que hay tarjeta— sin volverse un estorbo.
 *
 * Todo va envuelto en try/catch: en modo privado el acceso puede lanzar, y un
 * aviso repetido es mucho menos grave que un menú que no carga.
 */
export function avisoYaVisto(clave: string): boolean {
  const k = `clubify:aviso:${clave}`;
  try {
    const v = localStorage.getItem(k);
    if (!v) return false;
    const cuando = Number(v);
    if (!Number.isFinite(cuando)) return false;
    if (Date.now() - cuando > HORAS * 3600 * 1000) {
      localStorage.removeItem(k);
      return false;
    }
    return true;
  } catch {
    try {
      return sessionStorage.getItem(k) === '1';
    } catch {
      return false;
    }
  }
}

export function marcarAvisoVisto(clave: string): void {
  const k = `clubify:aviso:${clave}`;
  try {
    localStorage.setItem(k, String(Date.now()));
  } catch {
    try {
      sessionStorage.setItem(k, '1');
    } catch {
      /* nada que hacer: se le volverá a enseñar, que es lo de antes */
    }
  }
}
