import { headers } from 'next/headers';

/**
 * Host con el que se pidió la página (`app.selleala.com`, `birrialeon.com`…).
 * Solo para el servidor (layouts y `generateMetadata`).
 *
 * La vista previa de un negocio tiene que llevar el dominio que se está
 * compartiendo, y eso solo lo sabe la petición: los datos del negocio traen
 * la web de su marca, no el dominio propio desde el que lo abrieron.
 *
 * No encarece nada: el layout raíz ya lee `headers()` para resolver la marca,
 * así que estas páginas ya se renderizan por petición.
 *
 * Vacío si se llama fuera de una petición (build, prerender): quien lo usa cae
 * entonces a la web de la marca, nunca a Clubify.
 */
export function hostDeLaPeticion(): string {
  try {
    return headers().get('host') ?? '';
  } catch {
    return '';
  }
}
