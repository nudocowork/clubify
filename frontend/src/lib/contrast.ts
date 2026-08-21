/**
 * Utilidades de contraste WCAG.
 *
 *  1) Decidir si un fondo es "claro" u "oscuro" para que componentes overlay
 *     (badge de marca, botones del storefront) adapten su color solos
 *     (`isDarkColor` / `isDarkBackground`).
 *  2) Elegir un color de texto legible y medir contraste para los color
 *     pickers del Infolink (`contrastRatio`, `meetsAA`, `autoTextColor`).
 *
 * Todo PURO. `contrastRatio` sigue la fórmula WCAG 2.1 (luminancia relativa);
 * AA para texto normal = ratio ≥ 4.5.
 */

/** Parsea un hex (#rgb / #rrggbb) a [r,g,b] 0-255. null si inválido. */
export function hexToRgb(hex?: string | null): [number, number, number] | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa (WCAG) de un color hex, 0..1. 0 si inválido. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG entre dos colores (1..21). 0 si alguno es inválido. */
export function contrastRatio(fg?: string | null, bg?: string | null): number {
  if (!fg || !bg || !hexToRgb(fg) || !hexToRgb(bg)) return 0;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** true si el par cumple WCAG AA para texto normal (ratio ≥ 4.5). */
export function meetsAA(fg?: string | null, bg?: string | null): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

/** Blanco o negro, el que más contraste dé sobre `bg`. Default '#ffffff'. */
export function autoTextColor(bg?: string | null): '#ffffff' | '#111111' {
  if (!bg || !hexToRgb(bg)) return '#ffffff';
  return relativeLuminance(bg) > 0.45 ? '#111111' : '#ffffff';
}

/** true si el color CSS es oscuro (luminancia < 0.5). false si claro o
 *  inválido. Lo usan los componentes overlay para elegir su variant. */
export function isDarkColor(color?: string | null): boolean {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  return relativeLuminance(color as string) < 0.5;
}

/**
 * Resuelve si el fondo de una página storefront es "oscuro" para que
 * los componentes overlay decidan su variant. Reglas:
 *   - SOLID + hex → calcula luminancia
 *   - GRADIENT → asume dark (la mayoría tienen tonos saturados)
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

/**
 * Color de marca **seguro** para usar en un `style`.
 *
 * `primaryColor || '#22C55E'` solo atrapa null y cadena vacía: si el campo trae
 * basura (pasó de verdad — un negocio tenía «Degodoy cocina» escrito ahí), el
 * navegador ignora la declaración, el botón se queda con fondo blanco y el texto
 * blanco encima lo vuelve INVISIBLE. El usuario ve que «no marca» cuando en
 * realidad sí marcó.
 *
 * Acá se valida de verdad: si no es un hex parseable, se usa el respaldo.
 */
export function safeBrandColor(
  color?: string | null,
  fallback = '#22C55E',
): string {
  const c = (color ?? '').trim();
  return hexToRgb(c) ? c : fallback;
}

/**
 * Par listo para pintar un elemento «seleccionado» con el color de la marca:
 * fondo válido y texto que se lee encima.
 *
 * El texto NO se fija a blanco: una marca con color claro (hay una con
 * `#ffffff`) dejaría el contenido ilegible. `autoTextColor` elige negro o
 * blanco según la luminancia.
 */
export function brandFill(
  color?: string | null,
  fallback = '#22C55E',
): { background: string; color: string } {
  const background = safeBrandColor(color, fallback);
  return { background, color: autoTextColor(background) };
}
