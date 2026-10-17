import { ESTADOS, type Estado } from './estados';
import { EQUIPOS, type Equipo } from './equipos';

/**
 * TOTALES DEL REPORTE DE COMISIONES — puros, sin base de datos.
 *
 * Dos reglas que este archivo existe para cumplir, y que las pruebas fijan:
 *
 *  1. El total general es la SUMA de los individuales. Se calcula por separado
 *     (no sumando las filas de la tabla) para que, si algún día se desalinean,
 *     la prueba lo cace en vez de que lo descubra la contadora.
 *
 *  2. Una venta con varias comisiones NO multiplica el monto vendido. Un cobro
 *     de $68 con influencer, embajador y socio son tres comisiones y UNA venta
 *     de $68, no de $204. Por eso el vendido se suma por `claveDeVenta`, no por
 *     comisión.
 *
 * Todo el dinero se suma en centavos enteros: sumar cientos de decimales en
 * coma flotante deja colas como 1234.5600000001 que luego no cuadran contra el
 * total del corte.
 */

const aCent = (n: number) => Math.round((Number(n) || 0) * 100);
const deCent = (c: number) => c / 100;

/** Lo mínimo de una comisión para la clave de su venta. */
export type DatosDeVenta = {
  id: string;
  tenantId: string | null;
  businessGroupId: string | null;
  periodKey: string | null;
  businessDate: Date | string | null;
  createdAt: Date | string;
  esManual: boolean;
  /** Participación global: el ingreso del que salió (ver `participaciones.ts`). */
  ingresoId?: string | null;
};

/**
 * Qué VENTA representa una comisión, o null si no representa ninguna.
 *
 *  · Comisión de equipo (`EQUIPO-…`): es un % de TODAS las ventas de la
 *    quincena. Contar su base sería contar dos veces cada venta del período.
 *  · Comisión manual de este módulo: un bono o un ajuste. Si la venta existe, ya
 *    la cuenta su comisión automática.
 *  · Participación global: el ingreso del libro del que nació.
 *  · El resto: el dueño del cobro (negocio o grupo) + su `periodKey`, que es la
 *    clave con la que el motor separa un cobro de otro (`clave-del-periodo.ts`).
 *    Las comisiones hermanas de un mismo cobro (influencer, embajador, vendedor,
 *    socio) comparten negocio y `periodKey`.
 */
export function claveDeVenta(c: DatosDeVenta): string | null {
  if (c.esManual) return null;
  if (c.periodKey && c.periodKey.startsWith('EQUIPO-')) return null;
  // La participación nace de UN ingreso: ese es su cobro.
  if (c.ingresoId) return `i:${c.ingresoId}`;
  const dueño = c.tenantId ? `t:${c.tenantId}` : c.businessGroupId ? `g:${c.businessGroupId}` : null;
  if (!dueño) return null;
  // Filas legacy sin periodKey: el día del cobro hace de clave.
  const periodo =
    c.periodKey ?? new Date(c.businessDate ?? c.createdAt).toISOString().slice(0, 10);
  return `${dueño}|${periodo}`;
}

/** Una comisión ya preparada para sumar. */
export type FilaParaTotales = {
  id: string;
  codeId: string | null;
  equipo: Equipo;
  estado: Estado | null;
  amount: number;
  amountPaid: number;
  /** La base de la venta (`baseAmountUsd`). 0 si no se conoce. */
  ventaUsd: number;
  ventaClave: string | null;
  /** Manual de este módulo o asiento ADJUSTMENT: va en la columna «Ajustes». */
  esAjuste: boolean;
};

export type PorEstado = Record<Estado, { cantidad: number; montoUsd: number }>;

export type Totales = {
  /** Ventas distintas. */
  ventas: number;
  vendidoUsd: number;
  /** Comisiones vivas (sin reversadas ni ajustes). */
  comisiones: number;
  comisionesUsd: number;
  ajustesUsd: number;
  pagadoUsd: number;
  /** Lo que falta por pagar: comisiones + ajustes − pagado. */
  saldoUsd: number;
  porEstado: PorEstado;
};

function porEstadoVacio(): PorEstado {
  return Object.fromEntries(ESTADOS.map((e) => [e, { cantidad: 0, montoUsd: 0 }])) as PorEstado;
}

/**
 * Totales de un conjunto de filas. Las reversadas cuentan en su estado (para la
 * tarjeta «Reversadas») pero no en el dinero: nunca se van a pagar.
 */
export function totalesDe(filas: FilaParaTotales[]): Totales {
  const ventas = new Map<string, number>();
  const porEstadoCent = new Map<Estado, { n: number; c: number }>();
  let comisiones = 0;
  let comisionesCent = 0;
  let ajustesCent = 0;
  let pagadoCent = 0;

  for (const f of filas) {
    if (f.estado) {
      const e = porEstadoCent.get(f.estado) ?? { n: 0, c: 0 };
      e.n += 1;
      e.c += aCent(f.amount);
      porEstadoCent.set(f.estado, e);
    }
    if (f.estado === 'REVERSADA') continue;
    if (f.esAjuste) ajustesCent += aCent(f.amount);
    else if (f.estado) {
      comisiones += 1;
      comisionesCent += aCent(f.amount);
    }
    pagadoCent += aCent(f.amountPaid);
    if (f.ventaClave) {
      // La base más alta del grupo: en un cobro, la fila del socio puede venir
      // sin base congelada mientras la del vendedor sí la tiene.
      const v = aCent(f.ventaUsd);
      ventas.set(f.ventaClave, Math.max(ventas.get(f.ventaClave) ?? 0, v));
    }
  }

  const porEstado = porEstadoVacio();
  for (const [e, v] of porEstadoCent) porEstado[e] = { cantidad: v.n, montoUsd: deCent(v.c) };
  const vendidoCent = [...ventas.values()].reduce((a, b) => a + b, 0);

  return {
    ventas: ventas.size,
    vendidoUsd: deCent(vendidoCent),
    comisiones,
    comisionesUsd: deCent(comisionesCent),
    ajustesUsd: deCent(ajustesCent),
    pagadoUsd: deCent(pagadoCent),
    saldoUsd: deCent(comisionesCent + ajustesCent - pagadoCent),
    porEstado,
  };
}

export type EstadoDeLiquidacion = 'LIQUIDADO' | 'PARCIAL' | 'EN_CORTE' | 'PENDIENTE' | 'SIN_SALDO';

export const ETIQUETA_DE_LIQUIDACION: Record<EstadoDeLiquidacion, string> = {
  LIQUIDADO: 'Liquidado',
  PARCIAL: 'Pago parcial',
  EN_CORTE: 'En corte, por pagar',
  PENDIENTE: 'Pendiente',
  SIN_SALDO: 'Sin movimiento',
};

/** Cómo va la liquidación de un colaborador en el período. */
export function estadoDeLiquidacion(t: Totales): EstadoDeLiquidacion {
  const debe = t.comisionesUsd + t.ajustesUsd;
  if (debe <= 0) return 'SIN_SALDO';
  if (t.saldoUsd <= 0) return 'LIQUIDADO';
  if (t.pagadoUsd > 0) return 'PARCIAL';
  if (t.porEstado.PENDIENTE_PAGO.cantidad > 0) return 'EN_CORTE';
  return 'PENDIENTE';
}

export type Consolidado = {
  general: Totales;
  porColaborador: Map<string, Totales>;
  porEquipo: Record<Equipo, Totales>;
};

/**
 * Totales por colaborador, por equipo y general, de una sola pasada de datos.
 * Las filas sin colaborador (legacy sin destinatario resoluble) cuentan en el
 * general bajo la clave «—»: no se pueden esconder del total.
 */
export function consolidar(filas: FilaParaTotales[]): Consolidado {
  const grupos = new Map<string, FilaParaTotales[]>();
  for (const f of filas) {
    const k = f.codeId ?? '—';
    const l = grupos.get(k) ?? [];
    l.push(f);
    grupos.set(k, l);
  }
  const porColaborador = new Map<string, Totales>();
  for (const [k, l] of grupos) porColaborador.set(k, totalesDe(l));

  const porEquipo = Object.fromEntries(
    EQUIPOS.map((e) => [e, totalesDe(filas.filter((f) => f.equipo === e))]),
  ) as Record<Equipo, Totales>;

  return { general: totalesDe(filas), porColaborador, porEquipo };
}

/** Suma de los individuales, para comprobar contra el general. */
export function sumaDeIndividuales(porColaborador: Map<string, Totales>) {
  let comisiones = 0;
  let ajustes = 0;
  let pagado = 0;
  let saldo = 0;
  for (const t of porColaborador.values()) {
    comisiones += aCent(t.comisionesUsd);
    ajustes += aCent(t.ajustesUsd);
    pagado += aCent(t.pagadoUsd);
    saldo += aCent(t.saldoUsd);
  }
  return {
    comisionesUsd: deCent(comisiones),
    ajustesUsd: deCent(ajustes),
    pagadoUsd: deCent(pagado),
    saldoUsd: deCent(saldo),
  };
}

/** Barras por mes (YYYY-MM, hora Bogotá) para la gráfica del resumen. */
export function porMes(
  filas: Array<{ fecha: Date | string; amount: number; estado: Estado | null }>,
): Array<{ mes: string; comisionesUsd: number; pagadoUsd: number }> {
  const meses = new Map<string, { c: number; p: number }>();
  for (const f of filas) {
    if (!f.estado || f.estado === 'REVERSADA') continue;
    // UTC-5 sin horario de verano: restar 5 h da el día de Bogotá.
    const d = new Date(new Date(f.fecha).getTime() - 5 * 3_600_000);
    const mes = d.toISOString().slice(0, 7);
    const m = meses.get(mes) ?? { c: 0, p: 0 };
    m.c += aCent(f.amount);
    if (f.estado === 'PAGADA') m.p += aCent(f.amount);
    meses.set(mes, m);
  }
  return [...meses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, v]) => ({ mes, comisionesUsd: deCent(v.c), pagadoUsd: deCent(v.p) }));
}
