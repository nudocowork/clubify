/**
 * Quita el indicativo del país cuando el cliente lo escribió (o el navegador lo
 * autocompletó) delante de su número y el formulario ya lo pone por él:
 * «50766793699» con indicativo 507 → «66793699».
 *
 * Solo actúa cuando SOBRAN dígitos: un número nacional tiene entre 7 y 10
 * dígitos y ninguno empieza por su propio indicativo con esa longitud, así que
 * un número de 8 dígitos que empiece por 507 se deja tal cual.
 *
 * Tres clientes de Altieri (Panamá) quedaron guardados como «+507507…»
 * (2026-10-22): con ese número no se les encuentra por teléfono, no recuperan
 * su tarjeta desde el enlace de alianza y ningún mensaje les llega.
 *
 * Devuelve solo dígitos.
 */
export function sinIndicativoRepetido(digitos: string, indicativo: string): string {
  const d = (digitos ?? '').replace(/\D/g, '');
  const ind = (indicativo ?? '').replace(/\D/g, '');
  if (!ind || d.length <= 10 || !d.startsWith(ind)) return d;
  const resto = d.slice(ind.length);
  return resto.length >= 7 && resto.length <= 10 ? resto : d;
}
