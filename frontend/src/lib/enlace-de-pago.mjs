/**
 * El código del afiliado dentro de un enlace de pago de Hotmart.
 *
 * Va en `sck` Y en `src`. En un checkout (`pay.hotmart.com`) Hotmart rastrea el
 * origen de la venta con `sck` y lo devuelve en el aviso del pago; `src` es para
 * las páginas de venta (`go.hotmart.com`). Hasta el 2026-09-17 solo se ponía
 * `src`, ningún aviso trajo nunca el código, y la venta solo quedaba a nombre
 * del afiliado si el comprador pasaba por `/ref/...` en el mismo navegador
 * (Habibi Bar Cantina y Master Sushi La Ligua, de Nicolas ¡TeamClosers!).
 *
 * Si el enlace ya lleva el token de MARCA (`wl_<uuid>`, ruteo de créditos) se
 * combinan (`<CÓDIGO>-wl_<uuid>`): el backend separa las dos partes. Un valor
 * ajeno que no es de marca (una campaña) no se pisa.
 *
 *   node scripts/pruebas-enlace-de-pago.mjs
 *
 * @param {string | null | undefined} url
 * @param {string | null | undefined} codigo
 * @returns {string}
 */
export function conCodigoDelAfiliado(url, codigo) {
  const base = (url ?? '').trim();
  const code = (codigo ?? '').trim();
  if (!base || !code) return base;
  let u;
  try {
    u = new URL(base);
  } catch {
    return base;
  }
  for (const param of ['sck', 'src']) {
    const actual = u.searchParams.get(param);
    if (!actual) {
      u.searchParams.set(param, code);
    } else if (/wl[_-]/i.test(actual) && !actual.toUpperCase().includes(code.toUpperCase())) {
      u.searchParams.set(param, `${code}-${actual}`);
    }
  }
  return u.toString();
}
