/**
 * Normaliza lo que el negocio escribió en el campo de Instagram.
 *
 * En el panel se puede escribir de tres formas —`@negocio`, `negocio` o la URL
 * entera— y las tres son razonables desde el lado de quien la escribe. Puestas
 * tal cual en un `href`, las dos primeras el navegador las resuelve como ruta
 * RELATIVA: el cliente pulsaba el icono de Instagram y aterrizaba en una página
 * vacía dentro de Clubify. Pasaba en la página del link, en el menú y en `/m/`.
 *
 * Devuelve `null` cuando no hay nada que enlazar, para que quien la use pueda
 * no pintar el icono en vez de pintar uno roto.
 */
export function urlDeInstagram(valor?: string | null): string | null {
  const v = (valor ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  // «instagram.com/negocio» sin protocolo: le falta el https, no el dominio.
  if (/^(www\.)?instagram\.com\//i.test(v)) return `https://${v}`;
  const handle = v.replace(/^@/, '').replace(/^\/+/, '').trim();
  return handle ? `https://instagram.com/${handle}` : null;
}
