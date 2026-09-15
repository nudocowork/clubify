/**
 * Las reglas de la bandeja de «Conversaciones»: qué filtro se pidió, cómo se
 * limpia la búsqueda y qué se enseña del último mensaje.
 *
 * Puras a propósito —sin Nest ni base— para probarlas contra este módulo. Las
 * usa `ConversacionesDeEquipoService`.
 */

/** Hilos por tanda, como la referencia. «Cargar más» pide la siguiente. */
export const POR_PAGINA_BANDEJA = 60;

export type FiltroDeBandeja = 'todos' | 'no_leidos';

/**
 * Escapa los comodines de `LIKE`. Sin esto, buscar «50%» encontraría cualquier
 * texto que empiece por 50, y un «_» casaría con cualquier letra.
 */
export function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Lo que llega de la URL, limpio. Los dígitos solo cuentan desde 4: con menos,
 * «buscar por teléfono» casaría con medio equipo.
 */
export function normalizarBandeja(raw: { filtro?: unknown; q?: unknown; pagina?: unknown }) {
  const filtro: FiltroDeBandeja = raw.filtro === 'no_leidos' ? 'no_leidos' : 'todos';
  const texto = typeof raw.q === 'string' ? raw.q.trim().slice(0, 120) : '';
  const digitos = texto.replace(/\D/g, '');
  const pagina = Math.max(1, Math.min(1000, Math.floor(Number(raw.pagina) || 1)));
  return {
    filtro,
    texto,
    patron: escaparLike(texto),
    // `phoneKey` son los últimos 10 dígitos: un número con indicativo se recorta igual.
    digitos: digitos.length >= 4 ? digitos.slice(-10) : '',
    pagina,
  };
}

/** El último mensaje en una línea: sin saltos ni espacios dobles, y recortado. */
export function vistaPrevia(body: string | null | undefined, max = 90): string {
  const t = (body ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
