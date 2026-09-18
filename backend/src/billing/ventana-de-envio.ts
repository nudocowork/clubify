/**
 * A qué hora sale el ciclo de cobro.
 *
 * EL BUG QUE ESTO ARREGLA (Javier, 2026-09-18): «envía mensajes SÚPER TARDE, 11
 * de la noche, y no tengo cómo arreglar eso».
 *
 * No era una impresión. El cron decía `EVERY_DAY_AT_3AM`, pero **el servidor va
 * en UTC** (el Dockerfile no fija `TZ` y `ScheduleModule.forRoot()` se registra
 * sin zona), así que las 03:00 UTC son las **22:00 de Bogotá**. Verificado en
 * los envíos reales de producción: los 4 recordatorios de cobro, los avisos de
 * mora y los de pausa salieron TODOS a las 22:00, todos los días. Y como la
 * pasada recorre los negocios uno a uno llamando a WhatsApp por cada uno, se
 * estira hasta cerca de las 23:00 — de ahí «las 11».
 *
 * No había forma de cambiarlo: la hora era una constante del decorador, sin
 * ajuste por negocio ni por marca, y sin ninguna franja de silencio.
 *
 * CÓMO QUEDA: el cron pasa a correr CADA HORA y la pasada se hace una sola vez
 * al día, en el primer tick que caiga dentro de la ventana configurada.
 *
 * POR QUÉ UNA VENTANA Y NO UNA HORA EXACTA: si la hora exacta cae justo en un
 * despliegue, un reinicio o un fallo de red, ese día no sale nada y nadie se
 * entera. Con una ventana, el tick siguiente recoge lo que no salió. Es el
 * mismo razonamiento que ya se usa en las automatizaciones
 * (`automations/hora-local.ts`), escrito por el bug gemelo de las push a las
 * 4 de la mañana.
 *
 * LA VENTANA NO PUEDE CRUZAR LA MEDIANOCHE con esta comparación. Está
 * bloqueado en `normalizarVentana`: un `desde` mayor que el `hasta` no se
 * guarda. Si algún día hace falta (avisos de madrugada para otra zona), hay que
 * pasar a aritmética modular Y revisar el candado del día, porque el día local
 * cambiaría a mitad de ventana.
 */

/** Franja del día, en la zona elegida, dentro de la cual sale el ciclo. */
export type VentanaDeEnvio = {
  /** Hora a la que se puede empezar a enviar (0-23). */
  desde: number;
  /** Hora a la que se deja de enviar (1-24), sin incluirla. */
  hasta: number;
  /** Zona horaria en la que se leen esas horas. */
  zona: string;
};

/**
 * De 9 a 13. Es horario de oficina y deja cuatro horas de margen: si el tick de
 * las 9 se pierde por un despliegue, el de las 10 lo recoge.
 */
export const VENTANA_POR_DEFECTO: VentanaDeEnvio = {
  desde: 9,
  hasta: 13,
  zona: 'America/Bogota',
};

export const CLAVE_VENTANA = 'billing.ventanaDeEnvio';
/** Día local ya procesado, para no repetir la pasada dentro de la ventana. */
export const CLAVE_ULTIMA_PASADA = 'billing.ultimaPasada';

function horaValida(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  const e = Math.round(n);
  return e >= min && e <= max ? e : null;
}

function zonaValida(z: unknown): string | null {
  const s = String(z ?? '').trim();
  if (!s) return null;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: s });
    return s;
  } catch {
    return null;
  }
}

/**
 * Sanea lo que llegue del panel. Nunca lanza: lo que no se entiende cae al
 * valor por defecto, porque una ventana corrupta no puede dejar el ciclo de
 * cobro sin correr —eso es dinero que no se reclama y negocios que no se
 * suspenden— ni hacerlo correr a las 3 de la mañana.
 */
export function normalizarVentana(entrada: unknown): VentanaDeEnvio {
  const obj = (entrada ?? {}) as Record<string, unknown>;
  const desde = horaValida(obj.desde, 0, 23);
  const hasta = horaValida(obj.hasta, 1, 24);
  const zona = zonaValida(obj.zona);
  // Las dos horas van juntas: aceptar una y rechazar la otra da franjas que
  // nadie pidió (un «desde 22» con el «hasta 13» por defecto no tiene sentido).
  const franjaOk = desde !== null && hasta !== null && desde < hasta;
  return {
    desde: franjaOk ? desde! : VENTANA_POR_DEFECTO.desde,
    hasta: franjaOk ? hasta! : VENTANA_POR_DEFECTO.hasta,
    zona: zona ?? VENTANA_POR_DEFECTO.zona,
  };
}

/** Lee el ajuste guardado (texto JSON). Un valor ilegible cae al de fábrica. */
export function leerVentana(valor: string | null | undefined): VentanaDeEnvio {
  if (!valor) return { ...VENTANA_POR_DEFECTO };
  try {
    return normalizarVentana(JSON.parse(valor));
  } catch {
    return { ...VENTANA_POR_DEFECTO };
  }
}

/** ¿Esa hora está dentro de la franja? `hasta` no se incluye. */
export function dentroDeLaVentana(hora: number, v: VentanaDeEnvio): boolean {
  return hora >= v.desde && hora < v.hasta;
}

/** Cómo se le enseña al usuario: «de 9:00 a 13:00 (America/Bogota)». */
export function describirVentana(v: VentanaDeEnvio): string {
  const hh = (n: number) => `${String(n).padStart(2, '0')}:00`;
  return `de ${hh(v.desde)} a ${hh(v.hasta)} (${v.zona})`;
}
