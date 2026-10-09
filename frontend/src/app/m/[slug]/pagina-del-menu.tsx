import { redirect } from 'next/navigation';
import StorefrontPublic from './storefront-client';
import { pedirMenuInicial, rutaDelLibro } from '@/lib/menu/menu-inicial';
import type { StorefrontMode } from '@/lib/menu/storefront-mode';

export type PropsDeLaPagina = {
  params: { slug: string; sectionSlug?: string; subSlug?: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

/**
 * Página del menú público (las seis rutas `/m` y `/d`, con y sin sección).
 *
 * Pide en el servidor el negocio y la carta y se los pasa al cliente, para
 * que el HTML llegue con el menú pintado en vez de un esqueleto vacío que
 * espera a que el JS hidrate y pida los datos (ver `lib/menu/menu-inicial.ts`).
 * El modo lo fija la ruta, igual que `modeFromPathname` en el cliente.
 */
export async function paginaDelMenu(mode: StorefrontMode, { params, searchParams }: PropsDeLaPagina) {
  const inicial = await pedirMenuInicial({ slug: params.slug, mode, searchParams });
  // Si toca el menú libro, se redirige desde aquí: antes el cliente pintaba,
  // pedía el negocio y SOLO entonces saltaba a /book. `redirect` fuera de
  // cualquier try/catch: funciona lanzando.
  const libro = rutaDelLibro(params.slug, inicial, params.sectionSlug);
  if (libro) redirect(libro);
  return <StorefrontPublic inicial={inicial} />;
}
