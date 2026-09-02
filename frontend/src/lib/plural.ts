/**
 * El plural de la unidad del plan ("café" → "cafés").
 *
 * La unidad la escribe el negocio en singular porque así se lee en la caja
 * ("te queda 1 café"), pero en el panel casi siempre hace falta en plural
 * ("10 cafés al mes"). Concatenar una "s" a secas daba "flans" y "lapizs".
 *
 * No pretende cubrir el español entero: cubre lo que un negocio escribe de
 * verdad —café, clase, lavada, corte, flan, masaje, pizza, jugo— y ante la
 * duda devuelve algo legible en vez de nada.
 */
export function plural(unidad: string, cantidad: number): string {
  const u = unidad.trim();
  if (!u) return '';
  if (cantidad === 1) return u;

  const ultima = u.slice(-1).toLowerCase();

  // Vocal átona: se añade "s". clase → clases, lavada → lavadas.
  if ('aeiou'.includes(ultima)) return u + 's';

  // Vocal tónica: "café" → "cafés", "menú" → "menús". La tilde SE QUEDA — el
  // acento sigue en la última sílaba. Quitarla daba "cafes".
  if ('áéíóú'.includes(ultima)) return u + 's';

  // La "z" pasa a "c": lápiz → lápices.
  if (ultima === 'z') return u.slice(0, -1) + 'ces';

  // Consonante: "-es". flan → flanes, menú de sabor → sabores.
  return u + 'es';
}
