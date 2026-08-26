/**
 * Ventana de calendario del tope por persona de un cupón de convenio.
 *
 * Los períodos son de CALENDARIO, no ventanas móviles. Es la diferencia que
 * más se nota en la caja y la que Javier señaló: un empleado viene hoy a las
 * 4 de la tarde y mañana a las 11 de la mañana. Son dos días distintos y con
 * «1 por día» tiene que poder canjear las dos veces. Con una ventana de 24
 * horas van 19 horas y se le rechaza — con un mensaje que además dice «ya lo
 * usó hoy», que es falso.
 *
 * En la zona horaria DEL NEGOCIO, no la del servidor. Si el día se corta en
 * UTC, la medianoche cae a las 7 de la tarde en Colombia y parte por la mitad
 * el horario fuerte de un restaurante. `Tenant.timezone` ya existe con
 * default `America/Bogota`, y así funcionan igual los negocios de México o
 * Puerto Rico.
 *
 * Mismo criterio que `cuponera/benefit-limits.ts` (de donde sale la idea),
 * pero aquél fija Bogotá con un offset a mano; aquí la zona entra por
 * parámetro y se resuelve con `Intl`, que además respeta el horario de verano
 * donde lo hay.
 *
 * OJO — criterio OPUESTO al de los sellos, donde `maxStampsPerDay` mira las
 * ÚLTIMAS 24 HORAS. Son dos reglas distintas; no unificarlas sin decidirlo.
 *
 * Funciones PURAS (la fecha entra por parámetro) para poder probarlas.
 */

/** Espejo del enum `ConvenioPeriodo` de Prisma. */
export type ConvenioPeriodo = 'SIEMPRE' | 'DIA' | 'SEMANA' | 'MES' | 'ANIO';

/** Zona por defecto si el negocio no tiene una. */
export const ZONA_POR_DEFECTO = 'America/Bogota';

type Pared = { anio: number; mes: number; dia: number; diaSemana: number };

/**
 * La fecha "de pared" en una zona: qué día es allí en este instante.
 *
 * `Intl` es la única forma correcta de hacer esto. Restarle horas a mano al
 * reloj funciona en Colombia (UTC-5 todo el año) pero se rompe en cuanto un
 * negocio esté en una zona con horario de verano.
 */
function fechaDePared(instante: Date, zona: string): Pared {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const partes = Object.fromEntries(
    fmt.formatToParts(instante).map((p) => [p.type, p.value]),
  );
  const dias: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return {
    anio: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    diaSemana: dias[String(partes.weekday)] ?? 0,
  };
}

/**
 * El instante UTC en que empieza (medianoche) un día de pared de esa zona.
 *
 * Se resuelve por aproximación y corrección: se parte del mediodía UTC de ese
 * día —a salvo de que el desfase horario lo empuje al día anterior o al
 * siguiente— y se le resta la hora de pared que resulte allí. Así no hace
 * falta conocer el desfase de cada zona ni si ese día tiene horario de verano.
 */
function medianocheDe(
  anio: number,
  mes: number,
  dia: number,
  zona: string,
): Date {
  const mediodiaUtc = Date.UTC(anio, mes - 1, dia, 12, 0, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date(mediodiaUtc)).map((x) => [x.type, x.value]),
  );
  const segundosDePared =
    Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return new Date(mediodiaUtc - segundosDePared * 1000);
}

/**
 * Instante desde el que hay que contar los canjes de esta persona.
 *
 * `null` = SIEMPRE: sin ventana, cuenta todo el historial. Es el default, y es
 * lo que espera quien pone «una sola vez».
 *
 * La semana arranca el LUNES (criterio ISO, el que usa la operación).
 */
export function inicioDelPeriodo(
  periodo: ConvenioPeriodo | null | undefined,
  ahora: Date,
  zona: string = ZONA_POR_DEFECTO,
): Date | null {
  if (!periodo || periodo === 'SIEMPRE') return null;

  let z = zona;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: z });
  } catch {
    // Zona inválida en la ficha del negocio: no es motivo para tumbar un
    // canje en la caja. Se cae a la de siempre.
    z = ZONA_POR_DEFECTO;
  }

  const hoy = fechaDePared(ahora, z);

  switch (periodo) {
    case 'DIA':
      return medianocheDe(hoy.anio, hoy.mes, hoy.dia, z);
    case 'SEMANA': {
      // getDay(): 0=domingo. Con el lunes como día 0, el domingo pertenece a
      // la semana que empezó el lunes ANTERIOR, no al día siguiente.
      const desdeLunes = (hoy.diaSemana + 6) % 7;
      const lunes = new Date(Date.UTC(hoy.anio, hoy.mes - 1, hoy.dia - desdeLunes));
      return medianocheDe(
        lunes.getUTCFullYear(),
        lunes.getUTCMonth() + 1,
        lunes.getUTCDate(),
        z,
      );
    }
    case 'MES':
      return medianocheDe(hoy.anio, hoy.mes, 1, z);
    case 'ANIO':
      return medianocheDe(hoy.anio, 1, 1, z);
    default:
      return null;
  }
}

/** Texto para la caja y el panel: «2 por día», «una sola vez», «sin límite». */
export function describirTope(
  maxPorPersona: number | null | undefined,
  periodo: ConvenioPeriodo | null | undefined,
): string {
  if (maxPorPersona == null) return 'Sin límite de usos';
  const p = periodo ?? 'SIEMPRE';
  if (p === 'SIEMPRE') {
    return maxPorPersona === 1 ? 'Una sola vez' : `${maxPorPersona} en total`;
  }
  const etiqueta: Record<Exclude<ConvenioPeriodo, 'SIEMPRE'>, string> = {
    DIA: 'por día',
    SEMANA: 'por semana',
    MES: 'por mes',
    ANIO: 'por año',
  };
  const veces = maxPorPersona === 1 ? '1 vez' : `${maxPorPersona} veces`;
  return `${veces} ${etiqueta[p as Exclude<ConvenioPeriodo, 'SIEMPRE'>]}`;
}

/**
 * Cuándo vuelve a poder canjear, en palabras.
 *
 * Se dice «mañana», no «en 7 horas». Con tope por día el cupón se libera a
 * medianoche, así que un contador a las 5 de la tarde diría «en 7 horas» y se
 * lee como que hay que esperar despierto hasta las doce — cuando en realidad
 * puede venir a desayunar. Y en la tarjeta de la billetera un contador sería
 * mentira directamente: el pase muestra texto fijo que solo cambia cuando le
 * llega un aviso.
 */
export function cuandoVuelve(
  periodo: ConvenioPeriodo | null | undefined,
): string {
  switch (periodo) {
    case 'DIA':
      return 'Podrá volver a usarlo mañana.';
    case 'SEMANA':
      return 'Podrá volver a usarlo la próxima semana.';
    case 'MES':
      return 'Podrá volver a usarlo el mes que viene.';
    case 'ANIO':
      return 'Podrá volver a usarlo el año que viene.';
    default:
      return 'Ya agotó los usos de este beneficio.';
  }
}
