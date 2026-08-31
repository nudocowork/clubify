/**
 * Botón de llamada del infolink: número → enlace `tel:`.
 *
 * Se exige el indicativo de país. Un número local funciona solo si quien
 * marca está en el mismo país y con la misma operadora de siempre, y el
 * infolink lo abre gente que llega desde Instagram, desde otra ciudad o desde
 * fuera: sin indicativo, el marcador se abre con un número que no completa la
 * llamada y el negocio se queda esperando.
 */

/** Se aceptan los separadores con los que la gente escribe un teléfono. */
const SEPARADORES = /[\s()./-]/g;

/**
 * Convierte lo escrito en el `href` del botón, o `null` si no sirve.
 *
 * Devuelve siempre `tel:+<digitos>`: el `+` es lo que hace que el marcador lo
 * trate como internacional, en iOS y en Android por igual.
 */
export function telHref(valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim();
  if (!v) return null;
  const digitos = v.replace(/^\+/, '').replace(SEPARADORES, '');
  // E.164: hasta 15 dígitos. El mínimo de 8 deja pasar los indicativos de
  // país cortos sin aceptar una extensión interna de 4 cifras.
  if (!/^\d{8,15}$/.test(digitos)) return null;
  return `tel:+${digitos}`;
}

/** Mensaje para el editor, o `null` si el número sirve. */
export function errorDeTelefono(valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim();
  if (!v) return 'Falta el número.';
  if (telHref(v)) return null;
  const digitos = v.replace(/^\+/, '').replace(SEPARADORES, '');
  if (/\d/.test(v) && digitos.length < 8) {
    return 'Falta el indicativo del país. Ejemplo: +57 300 123 4567.';
  }
  return 'Escribe el número con indicativo de país. Ejemplo: +57 300 123 4567.';
}

/** Cómo se le muestra al negocio lo que va a marcar. */
export function telLegible(valor: string | null | undefined): string | null {
  const href = telHref(valor);
  return href ? href.replace(/^tel:/, '') : null;
}
