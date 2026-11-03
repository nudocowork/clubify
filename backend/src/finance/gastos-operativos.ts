/**
 * Gastos operativos (Railway, Vercel, Neon, Canva…) en la cascada de utilidad.
 *
 * Javier, 2026-11-03: cada gasto operativo cuenta en TODOS los meses desde
 * mayo de 2026, se resta en la cascada en su propia línea y su valor se puede
 * cambiar para los meses que vienen sin reescribir los que ya pasaron.
 *
 * No se generan egresos por mes: el gasto vive en `RecurringExpense` y el
 * monto de cada mes se DERIVA de un historial de cambios ("desde 2026-12 vale
 * 40"). Así un cambio hacia adelante nunca toca un mes ya cerrado, y no hay
 * cientos de filas que mantener en sincronía con la tabla de recurrentes.
 *
 * El historial se guarda en `Setting` (`gastoOperativo.<id>`) para no tocar el
 * esquema: producción tiene índices que Prisma no sabe expresar.
 */

/** Primer mes en el que cuentan los gastos operativos. */
export const MES_INICIAL = '2026-05';

export const PREFIJO_HISTORIAL = 'gastoOperativo.';

/** "YYYY-MM" → monto mensual a partir de ese mes (hasta el siguiente cambio). */
export type Historial = Record<string, number>;

export interface GastoOperativo {
  id: string;
  amountUsd: number;
  periodicity: string;
  active: boolean;
  historial: Historial;
}

const ES_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const esMes = (m: string) => ES_MES.test(m);

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Mes siguiente de "YYYY-MM". */
export function mesSiguiente(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Meses de `desde` a `hasta`, ambos incluidos. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let m = desde; m <= hasta && out.length < 240; m = mesSiguiente(m)) out.push(m);
  return out;
}

/**
 * Monto mensual equivalente del valor con que se creó el gasto. La grilla y la
 * cascada son por mes: uno quincenal pesa el doble y uno anual se reparte.
 */
export function mensualizar(amountUsd: number, periodicity: string): number {
  switch ((periodicity ?? '').toUpperCase()) {
    case 'QUINCENAL':
      return r2(amountUsd * 2);
    case 'ANUAL':
      return r2(amountUsd / 12);
    default:
      return r2(amountUsd);
  }
}

export function leerHistorial(valor: string | null | undefined): Historial {
  if (!valor) return {};
  try {
    const o = JSON.parse(valor);
    const out: Historial = {};
    for (const [k, v] of Object.entries(o ?? {})) {
      const n = Number(v);
      if (esMes(k) && Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lo que cuesta el gasto en `mes`: el último cambio hecho en ese mes o antes;
 * sin cambios, su valor mensual de alta. Antes de mayo de 2026, nada.
 *
 * Un gasto INACTIVO no cuenta en ningún mes. Para dejar de contarlo a partir
 * de un mes concreto se le pone 0 desde ese mes: así los meses anteriores
 * conservan lo que costó.
 */
export function montoDelMes(g: GastoOperativo, mes: string): number {
  if (!g.active || mes < MES_INICIAL) return 0;
  let vigente: string | null = null;
  for (const k of Object.keys(g.historial)) {
    if (k <= mes && (vigente === null || k > vigente)) vigente = k;
  }
  return vigente !== null ? r2(g.historial[vigente]) : mensualizar(g.amountUsd, g.periodicity);
}

/** Total de todos los gastos operativos en `mes`. */
export function totalDelMes(gastos: GastoOperativo[], mes: string): number {
  return r2(gastos.reduce((a, g) => a + montoDelMes(g, mes), 0));
}

/**
 * Cambia el valor desde `mes` en adelante, hasta el siguiente cambio que ya
 * existiera. Los meses anteriores no se mueven: es lo que Javier pidió («poder
 * modificar los valores para meses futuros»), y un mes ya pasado o cerrado no
 * puede cambiar de utilidad por tocar una cifra de diciembre.
 */
export function cambiarDesde(
  g: GastoOperativo,
  mes: string,
  montoUsd: number,
  mesActual: string,
): Historial {
  if (!esMes(mes)) throw new Error('El mes va en formato AAAA-MM.');
  if (mes < mesActual) {
    throw new Error('Solo se cambian el mes en curso y los que vienen: los meses pasados se quedan como fueron.');
  }
  if (!Number.isFinite(montoUsd) || montoUsd < 0) throw new Error('El monto debe ser un número mayor o igual a 0.');
  return { ...g.historial, [mes]: r2(montoUsd) };
}
