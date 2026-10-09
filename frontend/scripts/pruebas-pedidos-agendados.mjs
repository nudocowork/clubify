/**
 * Pruebas de los pedidos agendados en el CLIENTE.
 *
 *   node scripts/pruebas-pedidos-agendados.mjs
 *
 * La aritmética de franjas se prueba a fondo en el backend
 * (`backend/src/orders/pedidos-agendados.spec.ts`), que además compara esta
 * copia con la suya caso por caso. Aquí va lo que SOLO existe en el cliente:
 * el horario tal como llega del menú público (sin limpiar), el id del intento
 * de compra y la etiqueta «hoy» del panel.
 */
import {
  esHoyEn,
  franjasDeAgendado,
  leerAjustesAgendado,
  nuevoIdDeIntento,
  validarAgendado,
} from '../src/lib/pedidos-agendados.mjs';

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
const bogota = (iso) => new Date(`${iso}:00-05:00`);

prueba('un horario con una franja rota no tumba las demás (llega sin limpiar)', () => {
  const horario = [
    { dias: [0, 1, 2, 3, 4, 5, 6], desde: '18:00', hasta: '22:00' },
    { dias: 'todos', desde: '25:00', hasta: 'x' },
  ];
  const dias = franjasDeAgendado({
    horario,
    zona: BOGOTA,
    anticipacionHoras: 0,
    diasMaximos: 1,
    ahora: bogota('2026-10-08T12:00'),
  });
  igual(dias[0].horas.length, 8, 'de 6 a 10 p. m. son 8 medias horas');
});

prueba('un horario que no es lista se trata como «sin horario» (8 a 20)', () => {
  const dias = franjasDeAgendado({
    horario: { basura: true },
    zona: BOGOTA,
    anticipacionHoras: 24,
    diasMaximos: 2,
    ahora: bogota('2026-10-08T06:00'),
  });
  igual(dias.find((d) => d.fecha === '2026-10-09').horas.length, 24, 'medias horas de 8 a 20');
});

prueba('lo que se ofrece, el servidor lo acepta', () => {
  const c = {
    horario: [{ dias: [5, 6], desde: '18:00', hasta: '01:00' }],
    zona: BOGOTA,
    anticipacionHoras: 48,
    diasMaximos: 30,
    ahora: bogota('2026-10-08T12:00'),
  };
  for (const d of franjasDeAgendado(c)) {
    for (const h of d.horas) {
      const r = validarAgendado({ ...c, instante: h.instante });
      if (h.disponible && !r.ok) throw new Error(`${h.instante} ofrecida y rechazada: ${r.error}`);
    }
  }
});

prueba('sin ajustes guardados la función está APAGADA', () => {
  igual(leerAjustesAgendado({}).activo, false, 'activo');
  igual(leerAjustesAgendado(undefined).anticipacionHoras, 48, 'anticipación por defecto');
});

prueba('el id del intento tiene la forma que acepta el servidor y no se repite', () => {
  const vistos = new Set();
  for (let i = 0; i < 200; i++) {
    const id = nuevoIdDeIntento();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new Error(`forma rara: ${id}`);
    vistos.add(id);
  }
  igual(vistos.size, 200, 'ids distintos');
});

prueba('sin crypto.randomUUID (navegador viejo) también sale un id válido', () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const id = nuevoIdDeIntento();
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new Error(`forma rara: ${id}`);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  }
});

prueba('«hoy» del panel es el día del NEGOCIO, no el del navegador', () => {
  // 22:00 del jueves en Bogotá = 03:00Z del viernes.
  const ahora = new Date('2026-10-09T03:00:00Z');
  igual(esHoyEn('2026-10-09T01:30:00Z', ahora, BOGOTA), true, 'jueves 8:30 p. m.');
  igual(esHoyEn('2026-10-09T12:00:00Z', ahora, BOGOTA), false, 'viernes');
});

console.log(`\n${casos - fallos}/${casos} pruebas en verde`);
if (fallos) process.exit(1);
