/**
 * ¿Se paró algo, o simplemente es una hora tranquila?
 *
 * El fallo que esto persigue es el que no se ve: todo responde 200, el
 * `/health` dice `ok`, Sentry está en silencio, y llevamos cuatro horas sin un
 * solo pedido porque una pasarela cambió un campo o un cron dejó de correr.
 * Nadie se enteraba hasta que un negocio llamaba.
 *
 * La trampa de vigilar esto es el falso positivo. Un domingo a las 4 de la
 * mañana cero pedidos es lo normal, y una alarma que suena cuando no pasa nada
 * se aprende a ignorar en dos días — y entonces ya no sirve para el día que sí
 * pasa. Por eso NO hay umbrales fijos: cada hora se compara consigo misma en
 * los días anteriores. La pregunta no es «¿hay pocos pedidos?», es «¿hay pocos
 * pedidos PARA UN VIERNES A LAS 8 DE LA TARDE?».
 *
 * Todo en UTC, que es la zona del servidor. Da igual para esto porque las dos
 * mitades de la comparación se sacan igual: las «20:00 UTC» de hoy contra las
 * «20:00 UTC» de los otros días son la misma franja local.
 */

/** Qué se decidió de una señal y por qué. El motivo va al aviso. */
export type Veredicto =
  | { estado: 'sin-señal'; motivo: string }
  | { estado: 'sano'; motivo: string }
  | { estado: 'caida'; gravedad: 'total' | 'fuerte'; motivo: string };

/**
 * La MEDIANA, no la media: si un día hubo una promoción con 400 pedidos, la
 * media se dispara y a partir de ahí un día normal parece una caída. La mediana
 * no se mueve por un día raro, que es justo lo que hace falta acá.
 */
export function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/**
 * Qué probabilidad hay de ver `actual` o menos POR PURA CASUALIDAD en una hora
 * donde lo normal es `esperado` (Poisson: llegadas sueltas e independientes,
 * que es lo que son las tarjetas, los pedidos o los sellos de una hora).
 *
 * Por qué (2026-10-03): saltó «0 tarjetas cuando lo normal son 3,5» un sábado a
 * las 10 de la noche. Con 3,5 esperadas, una hora en cero pasa por casualidad
 * el 3 % de las veces — en 24 franjas y 4 señales, varias veces por semana. Una
 * caída de verdad no es «poco», es «demasiado poco para ser suerte».
 */
export function probabilidadDeTanPoco(actual: number, esperado: number): number {
  if (esperado <= 0) return 1;
  let termino = Math.exp(-esperado);
  let acumulado = termino;
  for (let k = 1; k <= actual; k++) {
    termino *= esperado / k;
    acumulado += termino;
  }
  return Math.min(1, acumulado);
}

/** Por debajo de esto, la hora floja ya no se explica por casualidad: es una caída. */
export const CASUALIDAD_MAXIMA = 0.01;

/**
 * Decide sobre una señal.
 *
 * @param actual        cuántas hubo en la hora que acaba de cerrar
 * @param historico     cuántas hubo en ESA MISMA hora, un valor por día anterior
 * @param minimoUtil    por debajo de esta mediana la franja no dice nada: en una
 *                      hora que normalmente tiene 1 pedido, tener 0 es ruido, no
 *                      una caída. Sin esto, las madrugadas alertarían a diario.
 * @param diasMinimos   sin suficiente historia no se opina. Un negocio nuevo, o
 *                      la semana siguiente a un despliegue que vació la tabla,
 *                      no dan base para comparar.
 */
export function decidirCaida(
  actual: number,
  historico: number[],
  minimoUtil: number,
  diasMinimos = 5,
): Veredicto {
  if (historico.length < diasMinimos) {
    return {
      estado: 'sin-señal',
      motivo: `solo ${historico.length} día(s) de historia, hacen falta ${diasMinimos}`,
    };
  }

  const esperado = mediana(historico);
  if (esperado < minimoUtil) {
    return {
      estado: 'sin-señal',
      motivo: `esta franja normalmente tiene ${esperado}, por debajo del mínimo útil (${minimoUtil})`,
    };
  }

  // Poco, pero de lo que pasa por casualidad: una hora floja, no una avería.
  const azar = probabilidadDeTanPoco(actual, esperado);
  if ((actual === 0 || actual < esperado * 0.25) && azar >= CASUALIDAD_MAXIMA) {
    return {
      estado: 'sano',
      motivo: `${actual} cuando lo normal a esta hora son ${esperado}: pasa por casualidad el ${Math.round(azar * 100)} % de las veces`,
    };
  }
  if (actual === 0) {
    return {
      estado: 'caida',
      gravedad: 'total',
      motivo: `0 cuando lo normal a esta hora son ${esperado}`,
    };
  }

  // Un cuarto de lo normal. No es un número sagrado: es lo bastante bajo para
  // no saltar por una hora flojita y lo bastante alto para cazar «entran 2 de
  // los 40 de siempre», que es como se ve una pasarela medio rota.
  if (actual < esperado * 0.25) {
    return {
      estado: 'caida',
      gravedad: 'fuerte',
      motivo: `${actual} cuando lo normal a esta hora son ${esperado} (menos de la cuarta parte)`,
    };
  }

  return { estado: 'sano', motivo: `${actual}, normal a esta hora ${esperado}` };
}
