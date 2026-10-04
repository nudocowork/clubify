/**
 * Los textos que necesitan las páginas PÚBLICAS de un negocio (menú, menú a
 * domicilio, InfoLink).
 *
 * Por qué (quejas por el menú, 2026-10-04): el layout raíz mandaba al
 * navegador TODOS los textos de la aplicación —panel, contabilidad,
 * comisiones…—: 342 de los 367 KB del HTML de cada menú, en cada visita y sin
 * caché. En el celular de un cliente con datos flojos eso es lo que más tarda.
 *
 * La lista sale de recorrer los imports de `src/app/{m,d,i,book}` y juntar sus
 * `useTranslations(...)`: el resto de esas páginas trae sus textos con los
 * datos del negocio. Si un componente público empieza a usar un namespace
 * nuevo, va AQUÍ; si no, el cliente vería la clave en vez del texto.
 */
export const NAMESPACES_PUBLICOS = ['menu_book_viewer', 'phone_input'] as const;

/** Prefijos de las páginas públicas (los marca el middleware). */
export const RUTAS_PUBLICAS = ['/m/', '/d/', '/i/', '/book/'] as const;

/** Cabecera con la que el middleware marca una página pública. */
export const CABECERA_PAGINA_PUBLICA = 'x-pagina-publica';

export function esRutaPublica(pathname: string): boolean {
  return RUTAS_PUBLICAS.some((p) => pathname.startsWith(p));
}

/** Solo los namespaces públicos del diccionario completo. */
export function textosPublicos<T extends Record<string, unknown>>(todos: T): T {
  const out: Record<string, unknown> = {};
  for (const ns of NAMESPACES_PUBLICOS) if (ns in todos) out[ns] = todos[ns];
  // Un subconjunto del diccionario tiene la misma forma: next-intl lo acepta.
  return out as T;
}
