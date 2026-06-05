/**
 * Util de contraste para decidir si un color de fondo es "claro" u
 * "oscuro" → permite que componentes overlay (badge Clubify, botones)
 * adapten su color automáticamente sin pedirle al usuario que elija.
 *
 * Usa luminancia relativa según WCAG (no luminancia ponderada). Funciona
 * para hex de 3 o 6 dígitos (#fff, #FFFFFF). Fallback a false (asume
 * claro) si el input no parsea.
 */

/** Convierte hex CSS a [r, g, b] 0-255. Acepta #fff, #ffffff, fff, ffffff. */
function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (h.length !== 6) return null;
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return null;
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff];
}

/** Luminancia relativa estilo WCAG (0 = negro, 1 = blanco). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const norm = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b);
}

/** true si el color CSS es oscuro (luminancia < 0.5). false si claro o
 *  inválido. */
export function isDarkColor(color: string | null | undefined): boolean {
  if (!color) return false;
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  return relativeLuminance(rgb) < 0.5;
}

/**
 * Resuelve si el fondo de una página storefront es "oscuro" para que
 * los componentes overlay decidan su variant. Sigue las reglas:
 *   - SOLID + hex → calcula luminancia
 *   - GRADIENT → asume dark (la mayoría de gradients tienen tonos saturados)
 *   - IMAGE → asume dark (fotos comerciales suelen tener overlay oscuro)
 *   - sin config → false (default histórico claro)
 */
export function isDarkBackground(opts: {
  bgType?: string | null;
  bgColor?: string | null;
}): boolean {
  const type = (opts.bgType ?? 'SOLID').toUpperCase();
  if (type === 'GRADIENT') return true;
  if (type === 'IMAGE') return true;
  return isDarkColor(opts.bgColor);
}
