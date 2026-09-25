/**
 * ¿Se lee el texto de esta credencial?
 *
 * EL PROBLEMA, y por qué esto vive en el BACKEND y no en la pantalla:
 *
 * En el pase de Apple el color del texto está puesto EN DURO —
 * `foregroundColor: 'rgb(255,255,255)'` y `labelColor: 'rgb(245,241,232)'`
 * (`wallet/wallet.service.ts`)— y el fondo sale de `card.primaryColor`. En una
 * tarjeta de sellos eso se nota poco: el cartón tapa media tarjeta. En una
 * Tarjeta Informativa el fondo ES la tarjeta entera, así que un negocio que
 * elija un color claro reparte credenciales en blanco sobre blanco.
 *
 * El panel podría avisar, pero avisar no basta: hay tres puertas que escriben
 * el color de una tarjeta —el asistente, la pantalla de edición y la API— y
 * una comprobación en el navegador no cubre ninguna de las otras dos. Esta es
 * la única puerta por la que pasan las tres.
 *
 * El umbral es el AA de WCAG (4.5:1), el mismo que usa `meetsAA` en el
 * frontend. No se inventa uno nuevo para que la pantalla y el servidor no
 * digan cosas distintas.
 */

/** El blanco con el que Apple pinta el texto del pase. No es configurable. */
const TEXTO_DEL_PASE = { r: 255, g: 255, b: 255 };

/** Contraste mínimo legible (WCAG AA para texto normal). */
export const CONTRASTE_MINIMO = 4.5;

function aRgb(hex: string): { r: number; g: number; b: number } | null {
  const limpio = String(hex ?? '').trim().replace(/^#/, '');
  const completo =
    limpio.length === 3
      ? limpio.split('').map((c) => c + c).join('')
      : limpio;
  if (!/^[0-9a-f]{6}$/i.test(completo)) return null;
  return {
    r: parseInt(completo.slice(0, 2), 16),
    g: parseInt(completo.slice(2, 4), 16),
    b: parseInt(completo.slice(4, 6), 16),
  };
}

function luminancia({ r, g, b }: { r: number; g: number; b: number }): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** El contraste entre el fondo dado y el blanco del pase. 1 = ninguno. */
export function contrasteConElTexto(hex: string): number | null {
  const fondo = aRgb(hex);
  if (!fondo) return null;
  const a = luminancia(TEXTO_DEL_PASE);
  const b = luminancia(fondo);
  const [claro, oscuro] = a > b ? [a, b] : [b, a];
  return (claro + 0.05) / (oscuro + 0.05);
}

/**
 * Por qué NO sirve este color de fondo para una credencial, en español y
 * dirigido al negocio. `null` = sirve.
 *
 * Un hex que no se entiende NO se rechaza aquí: `safeBrandColor` ya lo recoge
 * más adelante y cae a un color válido. Rechazarlo en este punto convertiría un
 * campo mal tecleado en «no puedes guardar», y el caso real que motivó aquella
 * función fue un negocio que había escrito el nombre de su restaurante dentro
 * del campo de color.
 */
export function motivoParaRechazarElColor(hex: string): string | null {
  const c = contrasteConElTexto(hex);
  if (c === null) return null;
  if (c >= CONTRASTE_MINIMO) return null;
  return (
    'Ese color es demasiado claro para una tarjeta informativa: el texto de la ' +
    'credencial es blanco y no se leería. Elige un color más oscuro.'
  );
}
