/**
 * Lee el monto que escribe el cajero en el escáner, con o sin decimales.
 *
 * Por qué (2026-10-08): el total del tiquete en las alianzas borraba todo lo
 * que no fuera dígito, así que «25,50» se volvía 2550, y los demás campos eran
 * `type="number"`, que con el teclado en español (coma decimal) deja el valor
 * vacío en Chrome para Android. Los negocios en dólares (Panamá, Ecuador,
 * Venezuela) necesitan centavos.
 *
 * El cuidado está en no romper lo que ya escriben en Colombia: «12.500» es
 * doce mil quinientos, no doce y medio. Reglas:
 *   - Con punto Y coma, el que va de último es el decimal: «1.234,56», «1,234.56».
 *   - Con un solo tipo de separador repetido («1.234.567»): son miles.
 *   - Con uno solo, una vez: si lo siguen exactamente 3 dígitos, son miles
 *     («12.500», «12,500»); si lo siguen 1 o 2, es decimal («25,5», «25.50»).
 * Hasta 2 decimales. Devuelve null si no es un monto válido.
 *
 *   node scripts/pruebas-monto-escrito.mjs
 */

/**
 * @param {unknown} texto
 * @returns {number | null}
 */
export function leerMonto(texto) {
  if (typeof texto === 'number') return Number.isFinite(texto) && texto >= 0 ? redondear(texto) : null;
  if (typeof texto !== 'string') return null;
  const t = texto.replace(/[\s$]/g, '').replace(/^COP|^USD/i, '');
  if (!t || !/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;

  const puntos = (t.match(/\./g) || []).length;
  const comas = (t.match(/,/g) || []).length;
  let entero = t;
  let decimales = '';

  if (puntos && comas) {
    const decimal = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
    const miles = decimal === '.' ? ',' : '.';
    if ((decimal === '.' ? puntos : comas) > 1) return null;
    const [a, b] = t.split(decimal);
    entero = a.split(miles).join('');
    decimales = b;
  } else if (puntos + comas > 0) {
    const sep = puntos ? '.' : ',';
    const partes = t.split(sep);
    if (partes.length > 2) {
      // Varias veces el mismo separador: solo puede ser de miles.
      if (partes.slice(1).some((p) => p.length !== 3)) return null;
      entero = partes.join('');
    } else if (partes[1].length === 3) {
      entero = partes.join('');
    } else {
      entero = partes[0];
      decimales = partes[1];
    }
  }
  if (!/^\d*$/.test(entero) || !/^\d{0,2}$/.test(decimales)) return null;
  const n = Number(`${entero || '0'}.${decimales || '0'}`);
  return Number.isFinite(n) ? redondear(n) : null;
}

const redondear = (n) => Math.round(n * 100) / 100;
