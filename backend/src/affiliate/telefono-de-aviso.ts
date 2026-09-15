/**
 * El número al que se le puede mandar un SMS a un afiliado, o null.
 *
 * `ReferralCode.ownerWhatsapp` se escribe a mano al crear el código y llega de
 * todas las formas: con prefijo, con espacios, sin el +57… y también con un
 * dígito de más. Grow Business aceptaba ese número imposible sin quejarse y el
 * aviso quedaba como enviado: once avisos de un mismo influencer en diez días
 * (ventas, renovaciones y una cancelación) que no le llegaron a nadie
 * (15-09-2026).
 *
 * Por eso aquí NO se adivina: un celular colombiano sin prefijo (10 dígitos que
 * empiezan por 3) se completa con +57, uno con prefijo se respeta, y lo demás
 * vuelve como inválido para que se vea y se corrija. El normalizador del
 * comprador de Hotmart le pone `+` a cualquier número de 11 dígitos: a un
 * celular colombiano con un 9 de más lo habría mandado a Países Bajos (+31).
 */
export function telefonoDeAviso(raw: string | null | undefined): string | null {
  const texto = (raw ?? '').trim();
  if (!texto) return null;
  const digitos = texto.replace(/[^0-9]/g, '');

  if (texto.startsWith('+') || texto.startsWith('00')) {
    const numero = texto.startsWith('00') ? digitos.slice(2) : digitos;
    if (numero.length < 10 || numero.length > 15) return null;
    // Colombia: +57 y diez dígitos, ni uno más ni uno menos.
    if (numero.startsWith('57') && numero.length !== 12) return null;
    return `+${numero}`;
  }
  // Celular colombiano escrito sin el +57.
  if (digitos.length === 10 && digitos.startsWith('3')) return `+57${digitos}`;
  // El 57 escrito sin el «+».
  if (digitos.length === 12 && digitos.startsWith('573')) return `+${digitos}`;
  return null;
}
