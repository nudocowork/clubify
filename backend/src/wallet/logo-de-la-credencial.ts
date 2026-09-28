/**
 * EL LOGO DEL NEGOCIO, EN EL CENTRO DE SU CREDENCIAL.
 *
 * Apple ancla `logo.png` a la esquina superior IZQUIERDA y lo limita a 160×50
 * puntos: no hay ninguna propiedad de `pass.json` que lo centre. Lo único que
 * ocupa el ancho completo del pase es la franja (`strip.png`), así que un logo
 * centrado en Apple Wallet **es** una franja con el logo dibujado en medio.
 *
 * La tarjeta de ALIANZA ya hace justo eso —el logo del aliado, grande y
 * centrado— y la credencial no lo hacía: caía fuera de los tres tipos que
 * generan franja y se quedaba plana, con el logo diminuto arriba a la izquierda
 * y el nombre del negocio escrito al lado. Pedido de Javier el 2026-09-28
 * mirando una credencial de Degodoy.
 *
 * Este archivo es solo la ARITMÉTICA de esa franja: dónde va el logo y si hace
 * falta una plancha detrás. Vive fuera de `wallet.service` porque allí todo
 * necesita `sharp`, red y base de datos, y esto se puede comprobar con números.
 * El dibujo, en `generateCredentialStrip`.
 */

import { aRgb, contraste, luminancia } from '../cards/color-de-la-credencial';

/**
 * La franja de Apple para un `storeCard`: 320×123 puntos. Se dibuja a 2x y de
 * ahí se escalan las tres resoluciones, igual que la de alianza.
 */
export const ANCHO_FRANJA = 640;
export const ALTO_FRANJA = 246;

/**
 * Contraste mínimo para que el logo se distinga del fondo.
 *
 * 3:1 y no 4.5:1 a propósito: 4.5 es el umbral de WCAG para TEXTO, y aquí lo
 * que se mira es una marca grande. El propio WCAG pide 3:1 para elementos
 * gráficos (1.4.11). Usar el de texto haría que casi cualquier logo pidiera
 * plancha, y la plancha es lo que rompe el «ajustado al estilo de la tarjeta».
 */
export const CONTRASTE_MINIMO_DEL_LOGO = 3;

/**
 * La caja donde cabe el logo dentro de la franja.
 *
 * No ocupa la franja entera: un logo pegado a los bordes se lee como un error
 * de recorte. El 62 % del ancho deja un margen a los lados parecido al que
 * Apple deja en sus propios pases, y el 58 % del alto impide que un logo muy
 * apaisado toque el borde de arriba, donde empieza la cabecera.
 */
export function cajaDelLogo(
  ancho = ANCHO_FRANJA,
  alto = ALTO_FRANJA,
): { ancho: number; alto: number } {
  return {
    ancho: Math.round(ancho * 0.62),
    alto: Math.round(alto * 0.58),
  };
}

/**
 * La luminancia media de lo que SE VE del logo: los píxeles opacos.
 *
 * Los transparentes hay que saltarlos o mienten: un logo negro sobre un PNG
 * transparente tiene, contando todo, la luminancia del negro «diluida» por un
 * 80 % de píxeles vacíos que en RGB suelen venir en (0,0,0). Eso lo haría
 * parecer aún más oscuro de lo que es, y en otros codificadores —que rellenan
 * el transparente de blanco— lo haría parecer claro. Mismo logo, dos
 * respuestas.
 *
 * `null` si no hay ni un píxel visible: un logo totalmente transparente no
 * tiene color que comparar, y ahí no se decide nada.
 */
export function luminanciaDeLoVisible(
  rgba: Uint8Array | Buffer,
  opciones: { alphaMinimo?: number } = {},
): number | null {
  // 128 = medio opaco. Por debajo el píxel aporta tan poco color al resultado
  // final que contarlo como si fuera sólido desvía la media.
  const alphaMinimo = opciones.alphaMinimo ?? 128;
  let suma = 0;
  let cuenta = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaMinimo) continue;
    suma += luminancia({ r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] });
    cuenta++;
  }
  return cuenta === 0 ? null : suma / cuenta;
}

/**
 * ¿Hace falta una plancha clara detrás del logo?
 *
 * EL CASO QUE LO OBLIGA: el fondo de una credencial es oscuro por definición
 * —`motivoParaRechazarElColor` no deja guardar un color que no contraste con el
 * texto blanco del pase—, y muchísimos logos corporativos son negros sobre
 * transparente. Sin esto, el logo que acabamos de poner en el centro
 * desaparecería del todo, y en la vista previa del panel tampoco se vería el
 * fallo porque allí se pinta sobre el mismo color.
 *
 * Tres respuestas, por orden:
 *
 * 1. El negocio eligió un fondo para su logo (`logoBgColor`) → manda él. Es una
 *    decisión suya y ya se respeta en la cabecera del pase.
 * 2. No sabemos de qué color es el logo → no se inventa nada. Poner una plancha
 *    blanca «por si acaso» le mete un rectángulo a quien no lo necesita.
 * 3. Se sabe → plancha solo si el logo no se distinguiría del fondo.
 */
export function planchaParaElLogo(args: {
  /** El fondo REAL de la franja, ya parseado: el mismo del pase. */
  fondo: { r: number; g: number; b: number };
  logoBgColor?: string | null;
  luminanciaDelLogo?: number | null;
}): string | null {
  const elegido = (args.logoBgColor ?? '').trim();
  if (elegido && aRgb(elegido)) return elegido;

  if (args.luminanciaDelLogo == null) return null;

  const fondo = args.fondo;
  const ratio = contraste(args.luminanciaDelLogo, luminancia(fondo));
  if (ratio >= CONTRASTE_MINIMO_DEL_LOGO) return null;

  // Blanco si el fondo es oscuro, negro si es claro. Lo segundo casi no pasa
  // —el gate del color lo impide— pero una credencial creada antes de que ese
  // gate existiera puede tener el fondo claro, y ahí una plancha blanca no
  // arreglaría nada.
  return luminancia(fondo) < 0.5 ? '#FFFFFF' : '#111111';
}
