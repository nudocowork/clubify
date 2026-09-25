/**
 * Pruebas del filtro por tipo del listado de Tarjetas.
 *
 *   node scripts/pruebas-filtro-de-tarjetas.mjs
 *
 * EL FALLO (2026-09-25, Javier): estando en «Sellos» aparecía «Café Plan», que
 * es una Tarjeta de club. Alianzas y Club no son tipos de `CardType` —las dos
 * son `STAMPS` por dentro— y el filtro excluía la alianza pero no el club.
 */
import { coincideElTipo } from '../src/lib/tipo-de-tarjeta.mjs';

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

// Las cuatro que salen en la pantalla del reporte.
const SELLOS = { name: 'Nudo Cowork & Coffee', type: 'STAMPS' };
const CLUB = { name: 'Café Plan', type: 'STAMPS', clubPlanId: 'plan-1' };
const ALIANZA = { name: 'Aliado X', type: 'STAMPS', convenioId: 'conv-1' };
const CUPON = { name: 'Promo', type: 'COUPON' };

prueba('EL FALLO: «Sellos» ya NO enseña una tarjeta de club', () => {
  igual(coincideElTipo(CLUB, 'STAMPS'), false, 'Café Plan bajo Sellos');
});

prueba('«Sellos» tampoco enseña una alianza', () => {
  igual(coincideElTipo(ALIANZA, 'STAMPS'), false, 'alianza bajo Sellos');
});

prueba('«Sellos» sí enseña una tarjeta de sellos de verdad', () => {
  igual(coincideElTipo(SELLOS, 'STAMPS'), true, 'sellos normal');
});

prueba('«Club» enseña solo las de club', () => {
  igual(coincideElTipo(CLUB, 'club'), true, 'club');
  igual(coincideElTipo(SELLOS, 'club'), false, 'sellos bajo Club');
  igual(coincideElTipo(ALIANZA, 'club'), false, 'alianza bajo Club');
});

prueba('«Alianzas» enseña solo las alianzas', () => {
  igual(coincideElTipo(ALIANZA, 'alianza'), true, 'alianza');
  igual(coincideElTipo(CLUB, 'alianza'), false, 'club bajo Alianzas');
  igual(coincideElTipo(SELLOS, 'alianza'), false, 'sellos bajo Alianzas');
});

prueba('«Cupón» no se contamina', () => {
  igual(coincideElTipo(CUPON, 'COUPON'), true, 'cupón');
  igual(coincideElTipo(SELLOS, 'COUPON'), false, 'sellos bajo Cupón');
  igual(coincideElTipo(CLUB, 'COUPON'), false, 'club bajo Cupón');
});

prueba('«Todos los tipos» esconde las alianzas y mantiene el resto', () => {
  // Esto NO cambia: las alianzas se ven pidiendo su ficha, a propósito.
  igual(coincideElTipo(ALIANZA, 'all'), false, 'alianza en Todos');
  igual(coincideElTipo(CLUB, 'all'), true, 'club en Todos');
  igual(coincideElTipo(SELLOS, 'all'), true, 'sellos en Todos');
  igual(coincideElTipo(CUPON, 'all'), true, 'cupón en Todos');
});

prueba('la comprobación sabe ponerse en rojo', () => {
  // El criterio viejo —solo excluir la alianza— dejaba pasar el club.
  const comoAntes = (c, f) => c.type === f && !c.convenioId;
  igual(comoAntes(CLUB, 'STAMPS'), true, 'el criterio viejo sí lo dejaba pasar');
  igual(coincideElTipo(CLUB, 'STAMPS'), false, 'el nuevo no');
});

console.log(`\n${casos - fallos}/${casos} en verde`);
process.exit(fallos ? 1 : 0);
