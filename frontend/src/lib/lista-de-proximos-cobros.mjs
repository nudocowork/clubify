/**
 * La lista de próximos cobros, lista para mandársela a otra persona.
 *
 * EL CASO (Javier, 2026-09-26): Sara entra a Contabilidad → Próximos cobros,
 * lee la tabla y le va pasando los negocios a Samu **uno a uno**. La tabla
 * tiene siete columnas; de ellas, para avisar a un cliente solo hacen falta
 * tres: **quién, cuándo y qué plan**. Lo demás —periodicidad, método, último
 * pago, monto— es información de Contabilidad, no del recado.
 *
 * Por eso esto recorta a tres campos en vez de volcar la tabla: una lista con
 * todo dentro obliga a Samu a filtrar, y filtrar a mano es justo lo que se
 * está quitando.
 *
 * Dos salidas, y las dos hacen falta:
 *
 *  · `comoTexto` — para PEGAR en WhatsApp, que es como le llega a Samu. Un
 *    CSV por WhatsApp es un archivo que hay que abrir en otra aplicación.
 *  · `comoCsv` — para quien quiera el archivo (Excel, adjuntar a un correo).
 *
 * Vive aquí y no dentro del JSX para poder probarlo:
 * `npm run pruebas:proximos-cobros`.
 */

/**
 * El reloj de la empresa. La zona va EXPLÍCITA, no la del navegador.
 *
 * Las fechas de cobro se guardan a las 12:00 UTC —mediodía, la convención de
 * Contabilidad, elegida justo para que el día no se mueva al cruzar husos— así
 * que hoy cualquier zona da el mismo día. Fijarla igual es barato y cierra dos
 * cosas: que la lista diga EXACTAMENTE lo mismo que la tabla de la pantalla
 * (si no, Sara manda una fecha y Samu lee otra), y que siga diciéndolo si
 * alguien abre el panel de viaje o si un día entra una fecha sin esa hora.
 *
 * Sin fijarla, un `2026-09-27T00:00:00Z` se pinta «26 de septiembre» en
 * Colombia: toda la lista un día antes. Lo cazó una prueba.
 */
const ZONA = 'America/Bogota';

/** Cómo se escribe una fecha para una persona, no para una hoja de cálculo. */
export function fechaLarga(iso, hoy = new Date()) {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'sin fecha';
  const anoDeLaFecha = Number(
    d.toLocaleDateString('en-CA', { year: 'numeric', timeZone: ZONA }),
  );
  const anoDeHoy = Number(
    hoy.toLocaleDateString('en-CA', { year: 'numeric', timeZone: ZONA }),
  );
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    timeZone: ZONA,
    // El año solo cuando NO es el actual: «27 de septiembre» se lee mejor que
    // «27 de septiembre de 2026», y en diciembre un cobro de enero sí necesita
    // decir de qué año habla.
    ...(anoDeLaFecha === anoDeHoy ? {} : { year: 'numeric' }),
  });
}

/**
 * Los tres campos que se mandan, y nada más.
 *
 * Las filas sin fecha se quedan: que a un negocio le falte la fecha de cobro es
 * justo lo que alguien tiene que mirar, y esconderlo de la lista lo deja fuera
 * del radar de todos.
 */
export function filasParaExportar(filas) {
  return (filas ?? []).map((f) => ({
    negocio: String(f?.negocio ?? '').trim() || 'Sin nombre',
    fecha: f?.fechaCobro ?? null,
    plan: String(f?.plan ?? '').trim() || '—',
  }));
}

/**
 * La lista para pegar en un mensaje.
 *
 * Lleva encabezado con la ventana y el total: quien la recibe tiene que saber
 * de qué periodo le están hablando y si están todos. Sin eso, una lista pegada
 * suelta en un chat no se puede comprobar.
 */
export function comoTexto(filas, opciones = {}) {
  const items = filasParaExportar(filas);
  const hoy = opciones.hoy ?? new Date();
  const dias = opciones.dias;
  if (!items.length) {
    return dias
      ? `Sin cobros previstos en los próximos ${dias} días.`
      : 'Sin cobros previstos.';
  }
  const cabecera = dias
    ? `Próximos cobros (${dias} días) — ${items.length} ${items.length === 1 ? 'negocio' : 'negocios'}`
    : `Próximos cobros — ${items.length} ${items.length === 1 ? 'negocio' : 'negocios'}`;
  const lineas = items.map(
    (f) => `• ${f.negocio} — ${fechaLarga(f.fecha, hoy)} — ${f.plan}`,
  );
  return [cabecera, '', ...lineas].join('\n');
}

/** Escapa un campo de CSV: comillas dobladas y todo entrecomillado. */
const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * El archivo, con la fecha en formato ISO.
 *
 * En el CSV la fecha va `AAAA-MM-DD` y no «27 de septiembre»: una hoja de
 * cálculo ordena bien lo primero y trata lo segundo como texto suelto. Es el
 * único sitio donde las dos salidas se separan a propósito.
 */
export function comoCsv(filas) {
  const items = filasParaExportar(filas);
  const cabecera = ['Negocio', 'Próxima fecha', 'Plan'].map(celda).join(',');
  const lineas = items.map((f) =>
    [
      f.negocio,
      // `en-CA` da AAAA-MM-DD, y con la MISMA zona que el texto: si el CSV
      // usara `toISOString()` (UTC), el archivo y el mensaje podrían decir
      // días distintos del mismo cobro.
      f.fecha
        ? new Date(f.fecha).toLocaleDateString('en-CA', { timeZone: ZONA })
        : '',
      f.plan,
    ]
      .map(celda)
      .join(','),
  );
  return [cabecera, ...lineas].join('\n');
}

/** Nombre del archivo: lleva la fecha para no pisar la descarga anterior. */
export function nombreDelArchivo(hoy = new Date()) {
  return `proximos-cobros-${hoy.toISOString().slice(0, 10)}.csv`;
}
