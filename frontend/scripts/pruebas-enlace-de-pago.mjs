/**
 * Pruebas del código de afiliado en los enlaces de pago de Hotmart.
 *
 *   node scripts/pruebas-enlace-de-pago.mjs
 *
 * EL FALLO (2026-09-17, Nicolas ¡TeamClosers!): el checkout llevaba el código
 * en `src`, y en un checkout (`pay.hotmart.com`) Hotmart rastrea con `sck`.
 * Ningún aviso de pago trajo nunca el código: la venta solo se atribuía si el
 * comprador pasaba por `/ref/...` en el mismo navegador. Y quien vende por
 * llamada manda el enlace de Hotmart a pelo, sin código ninguno.
 */
import { readFileSync } from 'node:fs';
import { conCodigoDelAfiliado } from '../src/lib/enlace-de-pago.mjs';

let fallos = 0;
let casos = 0;
function prueba(nombre, fn) {
  casos++;
  try {
    fn();
    console.log('ok    ', nombre);
  } catch (e) {
    fallos++;
    console.log('FALLO ', nombre, '\n       ', e.message);
  }
}
const igual = (a, b, d) => {
  if (a !== b) throw new Error(`${d} — esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);
};
const WL = 'wl_dfd3cdff-7836-4aee-96a4-d7fa2b2907be';
const q = (url, k) => new URL(url).searchParams.get(k);

prueba('el código va en sck (lo que Hotmart rastrea) y en src', () => {
  const u = conCodigoDelAfiliado('https://pay.hotmart.com/K123?off=04u23bz7', 'BGXM2QWQ');
  igual(q(u, 'sck'), 'BGXM2QWQ', 'sck');
  igual(q(u, 'src'), 'BGXM2QWQ', 'src');
  igual(q(u, 'off'), '04u23bz7', 'la oferta no se toca');
});

prueba('con el token de marca ya puesto, se COMBINAN (afiliado + marca)', () => {
  const u = conCodigoDelAfiliado(`https://pay.hotmart.com/K1?sck=${WL}&src=${WL}`, 'BGXM2QWQ');
  igual(q(u, 'sck'), `BGXM2QWQ-${WL}`, 'sck combinado');
  igual(q(u, 'src'), `BGXM2QWQ-${WL}`, 'src combinado');
});

prueba('un enlace que ya lleva ESE código no se duplica', () => {
  const u = conCodigoDelAfiliado('https://pay.hotmart.com/K1?sck=BGXM2QWQ', 'BGXM2QWQ');
  igual(q(u, 'sck'), 'BGXM2QWQ', 'sck');
});

prueba('un sck ajeno que no es de marca no se pisa (otra campaña)', () => {
  const u = conCodigoDelAfiliado('https://pay.hotmart.com/K1?sck=instagram_bio', 'BGXM2QWQ');
  igual(q(u, 'sck'), 'instagram_bio', 'sck ajeno');
  igual(q(u, 'src'), 'BGXM2QWQ', 'src libre sí');
});

prueba('sin código o con URL rota devuelve el enlace tal cual', () => {
  igual(conCodigoDelAfiliado('https://pay.hotmart.com/K1', ''), 'https://pay.hotmart.com/K1', 'sin código');
  igual(conCodigoDelAfiliado('no es una url', 'BGXM2QWQ'), 'no es una url', 'rota');
  igual(conCodigoDelAfiliado(null, 'BGXM2QWQ'), '', 'null');
});

prueba('la landing usa el ayudante (no una copia con src)', () => {
  const s = readFileSync(new URL('../src/components/LandingPricingCheckout.tsx', import.meta.url), 'utf8');
  if (!/conCodigoDelAfiliado\(/.test(s)) throw new Error('LandingPricingCheckout no llama a conCodigoDelAfiliado');
  if (/searchParams\.set\('src'/.test(s)) throw new Error('LandingPricingCheckout sigue poniendo src a mano');
});

prueba('el panel del afiliado ofrece sus enlaces de pago directo con su código', () => {
  const s = readFileSync(new URL('../src/app/affiliate/page.tsx', import.meta.url), 'utf8');
  if (!/conCodigoDelAfiliado\(/.test(s)) throw new Error('el panel del afiliado no arma enlaces de pago con su código');
  if (!/landing-plans/.test(s)) throw new Error('el panel no carga los planes');
});

prueba('la prueba con tarjeta y los links de créditos de marca también llevan sck', () => {
  const trial = readFileSync(new URL('../src/app/prueba/TrialSignupClient.tsx', import.meta.url), 'utf8');
  if (!/conCodigoDelAfiliado\(/.test(trial)) throw new Error('TrialSignupClient no usa conCodigoDelAfiliado');
  const marcas = readFileSync(new URL('../src/app/superadmin/marcas/page.tsx', import.meta.url), 'utf8');
  if (!/'sck=' \+ token/.test(marcas)) throw new Error('los links de créditos de marca no llevan sck');
});

prueba('el bloque de enlaces directos solo se pinta con la marca resuelta como Clubify', () => {
  const s = readFileSync(new URL('../src/app/affiliate/page.tsx', import.meta.url), 'utf8');
  if (/!marcaSlug \|\|/.test(s)) throw new Error('sin marca resuelta se pintan enlaces de Clubify');
});

console.log(`\n${fallos ? `${fallos} FALLO(S)` : 'TODO VERDE'} — ${casos} casos`);
process.exit(fallos ? 1 : 0);
