/**
 * Pruebas de la lista de proximos cobros.
 *
 *   node scripts/pruebas-proximos-cobros.mjs
 *
 * Sara lee la tabla y le pasa los negocios a Samu uno a uno. Esta lista es lo
 * que le manda, asi que lo que importa es que se pueda LEER y que no le falte
 * nadie.
 */
import {
  ANCHOS_DE_COLUMNA,
  comoTexto,
  fechaLarga,
  filasParaExcel,
  filasParaExportar,
  nombreDelArchivo,
} from '../src/lib/lista-de-proximos-cobros.mjs';

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

/** Parte en lineas. Ayudante para no repetir el escape en cada caso. */
const lineas = (s) => String(s).split(String.fromCharCode(10));

const HOY = new Date('2026-09-26T12:00:00Z');

// Lo que devuelve el backend: siete campos. A la lista van tres.
const FILAS = [
  {
    tenantId: 't1',
    negocio: 'ATHOS RESTAURANT AND PUB',
    esGrupo: false,
    fechaCobro: '2026-09-27T12:00:00.000Z',
    plan: 'MENSUAL',
    periodicidad: 'MENSUAL',
    metodo: 'Hotmart',
    ultimoPago: '2026-08-27T00:00:00.000Z',
    montoUsd: 68,
  },
  {
    tenantId: 't2',
    negocio: 'Cafe del Centro',
    esGrupo: false,
    fechaCobro: '2026-10-02T12:00:00.000Z',
    plan: 'ANUAL',
    periodicidad: 'ANUAL',
    metodo: 'Stripe',
    ultimoPago: null,
    montoUsd: 500,
  },
];

prueba('SOLO tres campos: nombre, fecha y plan', () => {
  const r = filasParaExportar(FILAS);
  igual(Object.keys(r[0]).sort(), ['fecha', 'negocio', 'plan'], 'campos');
  // Nada de monto, metodo, periodicidad ni ultimo pago: eso es de
  // Contabilidad, no del recado que se le manda a una persona.
  const texto = comoTexto(FILAS, { dias: 30, hoy: HOY });
  for (const fuera of ['68', 'Hotmart', 'Stripe', '500', '27 de ago']) {
    if (texto.includes(fuera)) throw new Error(`se colo «${fuera}»`);
  }
});

prueba('el texto se puede pegar en un chat y se entiende', () => {
  const t = comoTexto(FILAS, { dias: 30, hoy: HOY });
  igual(t.split('\n')[0], 'Próximos cobros (30 días) — 2 negocios', 'cabecera');
  if (!t.includes('• ATHOS RESTAURANT AND PUB — 27 de septiembre — MENSUAL')) {
    throw new Error('la linea del negocio no sale como se espera:\n' + t);
  }
});

prueba('el ano solo aparece cuando NO es el actual', () => {
  // «27 de septiembre» se lee mejor; pero en diciembre, un cobro de enero
  // tiene que decir de que ano habla.
  igual(fechaLarga('2026-09-27T12:00:00.000Z', HOY), '27 de septiembre', 'mismo ano');
  igual(fechaLarga('2027-01-05T12:00:00.000Z', HOY), '5 de enero de 2027', 'otro ano');
});

prueba('EL HUSO HORARIO: la lista dice lo MISMO que la tabla', () => {
  // La tabla de la pantalla formatea con la zona del navegador, que para Sara
  // es Colombia. Lo que NO puede pasar es que la lista diga un dia y la
  // pantalla otro: ella manda una fecha y Samu llama otro dia.
  //
  // Se compara contra el mismo formateador que usa la tabla en vez de contra
  // un dia escrito a mano: asi la prueba sigue valiendo si cambia el dato.
  const comoLaTabla = (iso) =>
    new Date(iso).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'long',
      timeZone: 'America/Bogota',
    });
  for (const iso of [
    '2026-09-27T12:00:00.000Z', // la forma REAL: mediodia UTC
    '2026-09-27T00:00:00.000Z', // medianoche: es el 26 en Colombia, y la tabla tambien lo dice
    '2026-09-27T23:59:00.000Z',
    '2026-09-29T21:45:26.583Z', // una de produccion, con hora suelta
  ]) {
    igual(fechaLarga(iso, HOY), comoLaTabla(iso), iso);
  }
});

prueba('las fechas REALES de produccion salen bien', () => {
  // Se guardan a las 12:00 UTC a proposito, para que el dia no se mueva.
  igual(fechaLarga('2026-09-27T12:00:00.000Z', HOY), '27 de septiembre', 'ATHOS');
  igual(fechaLarga('2026-10-02T12:00:00.000Z', HOY), '2 de octubre', 'Hydor');
});

prueba('un negocio SIN fecha no se esconde', () => {
  // Que le falte la fecha es justo lo que alguien tiene que mirar. Quitarlo de
  // la lista lo deja fuera del radar de todos.
  const t = comoTexto([{ negocio: 'Sin fecha SA', fechaCobro: null, plan: 'MENSUAL' }], {
    dias: 7,
    hoy: HOY,
  });
  if (!t.includes('Sin fecha SA — sin fecha — MENSUAL')) {
    throw new Error('la fila sin fecha desaparecio:\n' + t);
  }
});

prueba('una fecha corrupta tampoco tumba la lista', () => {
  igual(fechaLarga('no es una fecha', HOY), 'sin fecha', 'basura');
  igual(fechaLarga(undefined, HOY), 'sin fecha', 'ausente');
});

prueba('sin cobros, lo dice en vez de mandar una lista vacia', () => {
  igual(comoTexto([], { dias: 7, hoy: HOY }),
    'Sin cobros previstos en los próximos 7 días.', 'vacio');
});

prueba('EL XLSX lleva la fecha como FECHA, no como texto', () => {
  // Es el motivo de que sea xlsx y no csv: Excel la reconoce, la ordena bien y
  // la enseña con el formato de quien la abre. Un «27 de septiembre» llega
  // como cadena y no se puede ordenar.
  const filas = filasParaExcel(FILAS);
  const celda = filas[1][1];
  igual(celda.type === Date, true, 'la celda es de tipo Date');
  igual(celda.value instanceof Date, true, 'y trae un Date de verdad');
  igual(celda.format, 'dd/mm/yyyy', 'formato dia/mes/ano');
});

prueba('la cabecera va en negrita y con los tres titulos', () => {
  const filas = filasParaExcel(FILAS);
  igual(filas[0].map((c) => c.value), ['Negocio', 'Próxima fecha', 'Plan'], 'titulos');
  igual(filas[0].every((c) => c.fontWeight === 'bold'), true, 'negrita');
});

prueba('el XLSX tampoco lleva monto ni metodo', () => {
  const plano = JSON.stringify(filasParaExcel(FILAS));
  for (const fuera of ['68', 'Hotmart', 'Stripe', '500']) {
    if (plano.includes(fuera)) throw new Error(`se colo «${fuera}»`);
  }
});

prueba('una fila SIN fecha no rompe el archivo', () => {
  // Con `{ type: Date, value: null }` la libreria revienta: para la fila sin
  // fecha se manda una celda de texto vacia.
  const filas = filasParaExcel([{ negocio: 'X', fechaCobro: null, plan: 'MENSUAL' }]);
  igual(filas[1][1].type === Date, false, 'no es celda de fecha');
  igual(filas[1][1].value, '', 'va vacia');
});

prueba('hay ancho de columna: que no haya que estirarlas al abrir', () => {
  igual(ANCHOS_DE_COLUMNA.length, filasParaExcel(FILAS)[0].length, 'un ancho por columna');
});

prueba('el archivo lleva fecha para no pisar la descarga anterior', () => {
  igual(nombreDelArchivo(HOY), 'proximos-cobros-2026-09-26.xlsx', 'nombre');
});

prueba('LA PRUEBA SABE PONERSE EN ROJO: volcar la tabla entera si trae el monto', () => {
  // El criterio equivocado seria exportar la fila tal cual. Se comprueba que
  // eso SI meteria el monto, para que la de arriba no pase por casualidad.
  const volcado = JSON.stringify(FILAS[0]);
  if (!volcado.includes('68')) throw new Error('el caso de prueba ya no trae monto');
  const nuestro = JSON.stringify(filasParaExportar(FILAS)[0]);
  if (nuestro.includes('68')) throw new Error('nuestro recorte tambien lo trae');
});

console.log(`\n${casos - fallos}/${casos} en verde`);
process.exit(fallos ? 1 : 0);
