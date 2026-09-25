/**
 * La franja de Clubify no viaja dentro del pase de otra marca.
 *
 * `certs/wallet-defaults/strip*.png` es un degradado VERDE CLUBIFY
 * (#3dc66f → #22984e) y se metía SIEMPRE en el `.pkpass`: lo único que lo
 * tapaba era la franja generada para esa tarjeta. Las que no generan ninguna
 * —la Tarjeta Informativa, las reservas, y también POINTS, CASHBACK,
 * MEMBERSHIP y GIFT— salían con esa banda verde cruzando el pase.
 *
 * Una credencial negra de un restaurante de Sellea con la banda verde de la
 * plataforma en medio es exactamente la fuga de marca que llevamos arreglando
 * sitio por sitio. Al LOGO ya le había pasado, y se resolvió mandando un PNG
 * transparente cuando el negocio no tiene el suyo; a la franja se le olvidó.
 *
 * Sin `strip*.png`, Apple pinta el pase con su `backgroundColor`, que es el
 * color de la tarjeta: una sola superficie. Que es justo lo que una credencial
 * quiere, y lo que cualquier pase quiere antes que el verde de otro.
 *
 * Cubre también el caso en que la generación FALLE en una tarjeta de sellos:
 * mejor un pase liso del color del negocio que uno con la banda de otra marca.
 */
export function imagenesSinFranjaAjena<T>(
  porDefecto: Record<string, T>,
  hayFranjaPropia: boolean,
): Record<string, T> {
  if (hayFranjaPropia) return porDefecto;
  return Object.fromEntries(
    Object.entries(porDefecto).filter(
      ([archivo]) => !archivo.startsWith('strip'),
    ),
  ) as Record<string, T>;
}
