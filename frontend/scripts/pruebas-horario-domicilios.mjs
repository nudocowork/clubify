/**
 * Pruebas del horario de domicilios en el CLIENTE.
 *
 *   node scripts/pruebas-horario-domicilios.mjs
 *
 * Es el espejo de `backend/src/orders/horario-de-domicilios.ts`. Existe porque
 * la respuesta pública del negocio se cachea hasta 10 minutos: un «abierto»
 * calculado en el servidor queda congelado y miente justo en el borde.
 */
import {
  diasSinHorario,
  estaAbierto,
  franjaEnPalabras,
  franjasUtiles,
  proximaApertura,
} from '../src/lib/horario-de-domicilios.mjs';

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
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${d} — esperado ${B}, obtenido ${A}`);
};

const BOGOTA = 'America/Bogota';
const TODOS = [0, 1, 2, 3, 4, 5, 6];
const HAMBURGUESERIA = [{ dias: TODOS, desde: '18:00', hasta: '01:00' }];
const bogota = (iso) => new Date(`${iso}-05:00`);

prueba('sin horario se pide a cualquier hora', () => {
  igual(estaAbierto([], bogota('2026-09-25T12:00'), BOGOTA), true, 'vacío');
  igual(estaAbierto(null, bogota('2026-09-25T03:00'), BOGOTA), true, 'nulo');
});

prueba('EL CASO: al mediodía está cerrada y dice cuándo volver', () => {
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T12:00'), BOGOTA), false, 'cerrada');
  igual(
    proximaApertura(HAMBURGUESERIA, bogota('2026-09-25T12:00'), BOGOTA),
    'hoy a las 6 p. m.',
    'mensaje',
  );
});

prueba('los bordes de la medianoche', () => {
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T17:59'), BOGOTA), false, '17:59');
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T18:00'), BOGOTA), true, '18:00');
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-26T00:30'), BOGOTA), true, '00:30');
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-26T01:00'), BOGOTA), false, '01:00');
});

prueba('la franja pertenece al día en que EMPIEZA', () => {
  const viernes = [{ dias: [5], desde: '20:00', hasta: '02:00' }];
  igual(estaAbierto(viernes, bogota('2026-09-26T00:30'), BOGOTA), true, 'sábado 00:30');
  igual(estaAbierto(viernes, bogota('2026-09-26T21:00'), BOGOTA), false, 'sábado 21:00');
});

prueba('el mismo resultado que el backend en otra zona', () => {
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T13:00'), 'America/New_York'), false, 'NY 14:00');
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T18:00'), 'America/New_York'), true, 'NY 19:00');
});

prueba('una zona que el navegador no entiende no rompe nada', () => {
  igual(estaAbierto(HAMBURGUESERIA, bogota('2026-09-25T20:00'), 'Zona/Inventada'), true, 'cae a Bogotá');
});

prueba('una franja rota NO tumba a las demás', () => {
  const mezcla = [
    { dias: [5], desde: '25:00', hasta: '02:00' }, // rota
    { dias: [6], desde: '18:00', hasta: '23:00' }, // buena
  ];
  igual(franjasUtiles(mezcla).length, 1, 'se queda la buena');
  igual(estaAbierto(mezcla, bogota('2026-09-26T20:00'), BOGOTA), true, 'sábado abierto');
});

prueba('EL ERROR CARO: qué días se queda sin recibir pedidos', () => {
  igual(diasSinHorario([{ dias: [5], desde: '18:00', hasta: '23:00' }]),
    [1, 2, 3, 4, 6, 0], 'solo viernes');
  igual(diasSinHorario(HAMBURGUESERIA), [], 'todos cubiertos');
  igual(diasSinHorario([]), [], 'sin horario = abierto siempre, no hay huecos');
});

prueba('el horario en palabras, para que se entienda al configurarlo', () => {
  igual(franjaEnPalabras(HAMBURGUESERIA[0]),
    'todos los días, de 6 p. m. a 1 a. m. del día siguiente', 'hamburguesería');
  igual(franjaEnPalabras({ dias: [1, 2], desde: '09:00', hasta: '18:00' }),
    'lunes, martes, de 9 a. m. a 6 p. m.', 'oficina');
});

console.log(`\n${casos - fallos}/${casos} en verde`);
process.exit(fallos ? 1 : 0);
