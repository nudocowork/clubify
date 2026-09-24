import { describe, it, expect, beforeEach } from 'vitest';
import { IncomeRecordService } from './income-record.service';
import { ConciliadorDeIngresosService } from './conciliador-de-ingresos.service';
import { FinanceReportService } from './finance-report.service';
import {
  alcanceDeMarca,
  combinar,
  olvidarMarcaClubify,
} from './alcance-de-marca';
import { categoriaDeIngreso } from './categorias-de-ingreso';
import { limitesDelPeriodo } from '../common/periodo-contable';

/**
 * Las pruebas que pedía el prompt de Contabilidad (2026-09-12), una por punto:
 *
 *   registrar un pago → sale en Ingresos
 *   registrar una renovación → sale clasificada como Renovación
 *   un pago de $0 (prueba) → NO cuenta como dinero recibido
 *   comisión generada y sin pagar → pendiente, no egreso
 *   comisión pagada → egreso del mes en que se pagó
 *   el mismo webhook dos veces → un solo movimiento
 *   septiembre → solo septiembre; agosto → solo agosto
 *   trimestre → la suma de sus meses
 *   todo → el histórico entero
 *   reembolso → deja de contar, sin duplicar
 *   cambiar el dato en el módulo origen → Contabilidad lo refleja
 *
 * Más la regresión que vació el módulo: qué significa «Clubify».
 */

// ── Dobles ──────────────────────────────────────────────────────────────────

const CLUBIFY = 'wl-clubify';

function prismaFalso(datos: {
  ingresos?: any[];
  eventosHotmart?: any[];
  negocios?: any[];
  comisiones?: any[];
  ajustes?: Record<string, string>;
}) {
  const ingresos: any[] = [...(datos.ingresos ?? [])];
  const estado = {
    ingresos,
    creados: [] as any[],
    actualizados: [] as any[],
  };
  const prisma: any = {
    whiteLabel: {
      findFirst: async ({ where }: any) =>
        where?.slug === 'clubify' ? { id: CLUBIFY } : null,
    },
    incomeRecord: {
      findMany: async () => ingresos,
      findUnique: async ({ where }: any) => {
        const k = where.gateway_externalTxId;
        if (!k) return ingresos.find((i) => i.id === where.id) ?? null;
        return (
          ingresos.find(
            (i) => i.gateway === k.gateway && i.externalTxId === k.externalTxId,
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        ingresos.push({ id: `nuevo-${ingresos.length}`, ...data });
        estado.creados.push(data);
        return data;
      },
      update: async ({ where, data }: any) => {
        const f = ingresos.find((i) => i.id === where.id);
        Object.assign(f ?? {}, data);
        estado.actualizados.push({ where, data });
        return f;
      },
      updateMany: async ({ where, data }: any) => {
        const tocadas = ingresos.filter(
          (i) =>
            i.gateway === where.gateway &&
            i.externalTxId === where.externalTxId &&
            i.status === where.status,
        );
        for (const t of tocadas) Object.assign(t, data);
        estado.actualizados.push({ where, data });
        return { count: tocadas.length };
      },
      groupBy: async () => [],
    },
    hotmartWebhookEvent: { findMany: async () => datos.eventosHotmart ?? [] },
    stripeWebhookEvent: { findMany: async () => [] },
    crossWebhookEvent: { findMany: async () => [] },
    manualPayment: { findMany: async () => [] },
    hotmartCreditPurchase: { findMany: async () => [] },
    tenant: {
      findUnique: async ({ where }: any) =>
        (datos.negocios ?? []).find((t) => t.id === where.id) ?? null,
      findFirst: async () => (datos.negocios ?? [])[0] ?? null,
    },
    commission: { findMany: async () => datos.comisiones ?? [] },
    payrollRun: { findMany: async () => [] },
    payrollEmployee: { findMany: async () => [] },
    expense: { findMany: async () => [] },
    expenseCategory: { findMany: async () => [] },
    setting: {
      findUnique: async ({ where }: any) =>
        datos.ajustes?.[where.key] != null
          ? { value: datos.ajustes[where.key] }
          : null,
    },
  };
  return { prisma, estado };
}

const ingreso = (p: Partial<any> = {}) => ({
  id: p.id ?? 'i1',
  gateway: 'HOTMART',
  externalTxId: p.externalTxId ?? 'HP1',
  tenantId: p.tenantId ?? 't1',
  whiteLabelId: p.whiteLabelId ?? CLUBIFY,
  grossUsd: p.grossUsd ?? 150,
  gatewayFeeUsd: 0,
  taxUsd: 0,
  netExpectedUsd: p.netExpectedUsd ?? 150,
  netReceivedUsd: null,
  reconStatus: 'PENDING',
  status: p.status ?? 'PAGADO',
  category: p.category ?? 'RENOVACION',
  saleDate: p.saleDate ?? new Date('2026-09-10T15:00:00Z'),
  brandName: p.brandName ?? 'Negocio',
  productName: null,
  ...p,
});

beforeEach(() => olvidarMarcaClubify());

// ── 1. Qué significa «Clubify» (la regresión que vació el módulo) ───────────

describe('el alcance de marca', () => {
  it('Clubify son SU marca y los legacy sin marca, no solo los null', async () => {
    const { prisma } = prismaFalso({});
    expect(await alcanceDeMarca(prisma, true)).toEqual({
      OR: [{ whiteLabelId: CLUBIFY }, { whiteLabelId: null }],
    });
  });

  it('scope=all no filtra por marca', async () => {
    const { prisma } = prismaFalso({});
    expect(await alcanceDeMarca(prisma, false)).toEqual({});
  });

  it('sin fila de Clubify (dev) se queda con la convención vieja', async () => {
    const prisma: any = { whiteLabel: { findFirst: async () => null } };
    expect(await alcanceDeMarca(prisma, true)).toEqual({ whiteLabelId: null });
  });

  it('combinar mete los fragmentos en un AND en vez de pisarse', () => {
    // Los dos usan la clave OR. Con `{...a, ...b}` el segundo borraba el filtro
    // de marca — una fuga entre negocios, y muda.
    const marca = { OR: [{ whiteLabelId: CLUBIFY }, { whiteLabelId: null }] };
    const periodo = { OR: [{ periodEnd: {} }, { periodEnd: null }] };
    expect(combinar(marca, periodo)).toEqual({ AND: [marca, periodo] });
    expect(combinar(marca)).toEqual(marca);
    expect(combinar(null, {}, undefined)).toEqual({});
  });
});

// ── 2. Registrar un pago y clasificarlo ─────────────────────────────────────

describe('registrar un cobro', () => {
  it('un pago aparece en Ingresos con su fecha, negocio e importe', async () => {
    const { prisma, estado } = prismaFalso({
      negocios: [{ id: 't1', whiteLabelId: CLUBIFY, planId: 'plan-elite' }],
    });
    const srv = new IncomeRecordService(prisma);
    await srv.record({
      gateway: 'HOTMART',
      externalTxId: 'HP-NUEVO',
      tenantId: 't1',
      grossUsd: 150,
      saleDate: new Date('2026-09-12T18:00:00Z'),
      isFirstPayment: true,
    });
    expect(estado.creados).toHaveLength(1);
    expect(estado.creados[0]).toMatchObject({
      externalTxId: 'HP-NUEVO',
      tenantId: 't1',
      grossUsd: 150,
      periodKey: '2026-09',
      category: 'NUEVA',
      // El plan lo resuelve desde el negocio: ninguno de los cinco caminos de
      // cobro lo mandaba y la columna salía vacía en las 120 filas históricas.
      planId: 'plan-elite',
    });
  });

  it('una renovación se clasifica como RENOVACION', () => {
    expect(categoriaDeIngreso({ tenantId: 't1', isFirstPayment: false })).toBe(
      'RENOVACION',
    );
    expect(categoriaDeIngreso({ tenantId: 't1', isFirstPayment: true })).toBe(
      'NUEVA',
    );
  });

  it('un pack de créditos (sin negocio) es OTRO, no una venta nueva', () => {
    expect(
      categoriaDeIngreso({ tenantId: null, productName: 'Pack 20 USD' }),
    ).toBe('OTRO');
  });

  it('UPGRADE no se adivina: hay que mandarlo', () => {
    expect(
      categoriaDeIngreso({ tenantId: 't1', isFirstPayment: false, categoria: 'UPGRADE' }),
    ).toBe('UPGRADE');
  });

  it('un cobro de $0 (día 0 de la prueba) NO es un ingreso', async () => {
    const { prisma, estado } = prismaFalso({});
    const srv = new IncomeRecordService(prisma);
    await srv.record({
      gateway: 'STRIPE',
      externalTxId: 'in_prueba',
      grossUsd: 0,
      saleDate: new Date('2026-09-12T18:00:00Z'),
    });
    expect(estado.creados).toHaveLength(0);
  });

  it('el mismo webhook dos veces deja UN solo movimiento', async () => {
    const { prisma, estado } = prismaFalso({});
    const srv = new IncomeRecordService(prisma);
    const pago = {
      gateway: 'HOTMART' as const,
      externalTxId: 'HP-REPETIDO',
      grossUsd: 68,
      saleDate: new Date('2026-09-12T18:00:00Z'),
    };
    await srv.record(pago);
    await srv.record(pago);
    await srv.record(pago);
    expect(estado.creados).toHaveLength(1);
  });
});

// ── 3. Reembolsos ───────────────────────────────────────────────────────────

describe('reembolsos', () => {
  it('un reembolso deja de contar sin borrar la fila ni duplicarla', async () => {
    const { prisma, estado } = prismaFalso({
      ingresos: [ingreso({ externalTxId: 'HP-DEV', grossUsd: 49.52 })],
    });
    const srv = new IncomeRecordService(prisma);
    const primera = await srv.marcarDevuelto(
      'HOTMART',
      'HP-DEV',
      'REEMBOLSADO',
      new Date('2026-09-12T00:00:00Z'),
    );
    expect(primera).toBe(true);
    expect(estado.ingresos[0].status).toBe('REEMBOLSADO');
    expect(estado.creados).toHaveLength(0);

    // El segundo aviso del mismo reembolso no cambia nada.
    const segunda = await srv.marcarDevuelto(
      'HOTMART',
      'HP-DEV',
      'REEMBOLSADO',
      new Date('2026-09-12T01:00:00Z'),
    );
    expect(segunda).toBe(false);
  });

  it('lo devuelto sale del total y se informa aparte', async () => {
    const { prisma } = prismaFalso({
      ingresos: [
        ingreso({ id: 'a', externalTxId: 'A', grossUsd: 100, netExpectedUsd: 100 }),
        ingreso({
          id: 'b', externalTxId: 'B', grossUsd: 50, netExpectedUsd: 50,
          status: 'REEMBOLSADO',
        }),
      ],
    });
    const srv = new IncomeRecordService(prisma);
    const r = await srv.summary({ onlyClubify: true });
    expect(r.grossUsd).toBe(100);
    expect(r.count).toBe(1);
    expect(r.refundedUsd).toBe(50);
    expect(r.refundedCount).toBe(1);
  });
});

// ── 4. Comisiones: generada ≠ pagada ────────────────────────────────────────

describe('comisiones en la cascada', () => {
  function reporte(comisiones: any[], pagadas: any[]) {
    const { prisma } = prismaFalso({});
    // `commission.findMany` se llama dos veces: primero las del período
    // (devengo) y después las pagadas EN el período (caja).
    let llamada = 0;
    prisma.commission.findMany = async () => (llamada++ === 0 ? comisiones : pagadas);
    const income: any = {
      summary: async () => ({
        count: 1, grossUsd: 1000, gatewayFeeUsd: 0, taxUsd: 0,
        netExpectedUsd: 1000, netReceivedUsd: 0, pendingRecon: 0, inReview: 0,
        refundedUsd: 0, refundedCount: 0, porCategoria: {},
      }),
    };
    const expense: any = { summary: async () => ({ totalUsd: 0 }) };
    return new FinanceReportService(prisma, income, expense);
  }

  it('una comisión generada y sin pagar NO se resta de la utilidad', async () => {
    const r = await reporte(
      [{ amount: 200, amountPaid: 0, paymentStatus: 'PENDING' }],
      [],
    ).summary(true);
    expect(r.comisionesGeneradasUsd).toBe(200);
    expect(r.comisionesPendientesUsd).toBe(200);
    expect(r.comisionesUsd).toBe(0);
    // 1000 de neto, nada pagado todavía; el socio se lleva su 10 % del neto.
    expect(r.utilidadUsd).toBe(900);
  });

  it('una comisión pagada sí es egreso, y del mes en que se pagó', async () => {
    const r = await reporte(
      [{ amount: 200, amountPaid: 200, paymentStatus: 'PAID' }],
      [{ amountPaid: 200 }],
    ).summary(true);
    expect(r.comisionesUsd).toBe(200);
    expect(r.comisionesPendientesUsd).toBe(0);
    // 1000 − 200 = 800 antes del socio; su 10 % son 80.
    expect(r.utilidadUsd).toBe(720);
  });

  it('una comisión de agosto pagada en septiembre pesa en SEPTIEMBRE', async () => {
    // Nada generado este mes, pero sí una salida de caja: es la que cuenta.
    const r = await reporte([], [{ amountPaid: 135 }]).summary(true);
    expect(r.comisionesGeneradasUsd).toBe(0);
    expect(r.comisionesUsd).toBe(135);
    // 1000 − 135 = 865 antes del socio; su 10 % son 86,50.
    expect(r.utilidadUsd).toBe(778.5);
  });

  it('el mes que la GENERÓ la sigue informando aunque se pagara después', async () => {
    // EL FALLO (2026-09-12, Javier): las tres comisiones de mayo de 2026
    // —$23,50— se generaron en mayo y se pagaron el 30 de junio. Como la
    // cascada resta por fecha de pago, mayo daba $0 en todo y el panel lo
    // trataba como un mes sin movimiento: los $23,50 desaparecían de la vista
    // mientras el módulo de comisiones los enseñaba sin problema.
    //
    // Pagadas del todo, así que «pendiente» es 0: el único sitio donde ese
    // dinero sigue existiendo para mayo es `comisionesGeneradasUsd`.
    const r = await reporte(
      [
        { amount: 13.5, amountPaid: 13.5, paymentStatus: 'PAID' },
        { amount: 5, amountPaid: 5, paymentStatus: 'PAID' },
        { amount: 5, amountPaid: 5, paymentStatus: 'PAID' },
      ],
      [], // ninguna PAGADA dentro de mayo
    ).summary(true);
    expect(r.comisionesGeneradasUsd).toBe(23.5);
    expect(r.comisionesPendientesUsd).toBe(0);
    expect(r.comisionesUsd).toBe(0);
  });
});

// ── 4b. El socio ─────────────────────────────────────────────────────────────

/**
 * Sara (2026-09-17): «dentro de Clubify hay un socio directo que comisiona el
 * 10 % de la utilidad en cada venta … que se agregue en la cascada de utilidad
 * como "Socio" … y que cuando entre una nueva venta se actualice el monto».
 *
 * La base es la UTILIDAD: el neto menos egresos, nómina y comisiones pagadas.
 * La primera versión de esa misma mañana la calculaba sobre el NETO de las
 * ventas —así se había entendido— y daba bastante más en cuanto había nómina o
 * comisiones de por medio. Por eso cada caso de aquí lleva algo restando: un
 * mes sin costos da lo mismo con las dos fórmulas y no probaría nada.
 */
describe('el socio en la cascada', () => {
  function reporte(opts: {
    netoClubify?: number;
    netoTodas?: number;
    pagadas?: any[];
    ajustes?: Record<string, string>;
    egresosTodas?: number;
    egresosClubify?: number;
    nominaTodas?: any[];
    nominaClubify?: any[];
  } = {}) {
    const { prisma } = prismaFalso({ ajustes: opts.ajustes });
    let llamada = 0;
    prisma.commission.findMany = async () => (llamada++ === 0 ? [] : opts.pagadas ?? []);
    // El doble distingue los dos alcances por el `where`, que es lo único que
    // los separa en el servicio: si un día se olvidara de acotar la consulta
    // de Clubify, este doble devolvería la nómina de todas y el test caería.
    prisma.payrollRun.findMany = async ({ where }: any) => {
      const deClubify = JSON.stringify(where ?? {}).includes(CLUBIFY);
      return (deClubify ? opts.nominaClubify ?? opts.nominaTodas : opts.nominaTodas) ?? [];
    };
    const income: any = {
      summary: async ({ onlyClubify }: { onlyClubify?: boolean }) => {
        const neto = onlyClubify ? opts.netoClubify ?? 1000 : opts.netoTodas ?? opts.netoClubify ?? 1000;
        return {
          count: 1, grossUsd: neto, gatewayFeeUsd: 0, taxUsd: 0,
          netExpectedUsd: neto, netReceivedUsd: 0, pendingRecon: 0, inReview: 0,
          refundedUsd: 0, refundedCount: 0, porCategoria: {},
        };
      },
    };
    const expense: any = {
      summary: async ({ onlyClubify }: { onlyClubify?: boolean }) => ({
        totalUsd: (onlyClubify ? opts.egresosClubify ?? opts.egresosTodas : opts.egresosTodas) ?? 0,
      }),
    };
    return { svc: new FinanceReportService(prisma, income, expense), prisma };
  }

  it('se lleva el 10 % de la UTILIDAD, no del neto', async () => {
    // Con 428,69 de egresos la utilidad antes del socio es 1000: le tocan 100.
    // Sobre el neto serían 142,87 — la cifra que este mismo test daba por buena
    // por la mañana, cuando la base era otra.
    const r = await reporte({ netoClubify: 1428.69, egresosTodas: 428.69 }).svc.summary(true);
    expect(r.socioPorcentaje).toBe(10);
    expect(r.socioUsd).toBe(100);
    expect(r.utilidadUsd).toBe(900);
  });

  it('todo lo que baja la utilidad le baja la parte al socio', async () => {
    // Sara (2026-09-17): «el % del socio sale del monto de la utilidad». Con 200
    // de comisiones pagadas, la utilidad antes del socio es 800 → le tocan 80.
    const r = await reporte({ netoClubify: 1000, pagadas: [{ amountPaid: 200 }] }).svc.summary(true);
    expect(r.socioUsd).toBe(80);
    expect(r.utilidadUsd).toBe(720);
  });

  it('cuando entra una venta nueva, el monto del socio se actualiza', async () => {
    const antes = await reporte({ netoClubify: 1000 }).svc.summary(true);
    const despues = await reporte({ netoClubify: 1150 }).svc.summary(true);
    expect(antes.socioUsd).toBe(100);
    expect(despues.socioUsd).toBe(115);
  });

  it('un mes en pérdida no le debe nada al socio', async () => {
    const r = await reporte({ netoClubify: 100, pagadas: [{ amountPaid: 500 }] }).svc.summary(true);
    expect(r.socioUsd).toBe(0);
    expect(r.utilidadUsd).toBe(-400);
  });

  it('el porcentaje se puede ajustar y uno inválido vuelve al 10 %', async () => {
    const quince = await reporte({ ajustes: { 'contabilidad.socio.porcentaje': '15' } }).svc.summary(true);
    expect(quince.socioUsd).toBe(150);
    const roto = await reporte({ ajustes: { 'contabilidad.socio.porcentaje': 'abc' } }).svc.summary(true);
    expect(roto.socioUsd).toBe(100);
  });

  it('un mes con más devoluciones que ventas no le debe nada al socio', async () => {
    const r = await reporte({ netoClubify: -50 }).svc.summary(true);
    expect(r.socioUsd).toBe(0);
  });

  it('con todas las marcas, el socio sale solo de la utilidad de Clubify', async () => {
    // Ni las ventas ni los COSTOS de una marca blanca son suyos: la base es el
    // neto de Clubify menos sus egresos y su nómina (1000 − 40 − 25 = 935).
    // Restándole los de todas las marcas saldrían 84, no 93,50.
    const r = await reporte({
      netoClubify: 1000, netoTodas: 3000,
      egresosTodas: 100, egresosClubify: 40,
      nominaTodas: [{ totalUsd: 60 }], nominaClubify: [{ totalUsd: 25 }],
    }).svc.summary(false);
    expect(r.socioUsd).toBe(93.5);
    expect(r.utilidadUsd).toBe(2746.5);
  });

  it('el cierre de mes congela la línea del socio', async () => {
    const { svc, prisma } = reporte({ netoClubify: 1000 });
    let guardado: any = null;
    prisma.financialClose = { upsert: async (a: any) => (guardado = a.create) };
    await svc.closePeriod(null, '2026-09', 'clubify');
    expect(guardado.socioUsd).toBe(100);
    expect(guardado.utilidadUsd).toBe(900);
  });

  it('sin ajuste propio, usa el % del socio que ya se configura en Referidos', async () => {
    const r = await reporte({ ajustes: { 'referrals.socioPercent': '12' } }).svc.summary(true);
    expect(r.socioUsd).toBe(120);
  });

  it('las comisiones del rol SOCIO no se restan otra vez como comisiones', async () => {
    const { svc, prisma } = reporte({ netoClubify: 1000 });
    const pagadas = [
      { amountPaid: 50, rol: 'INFLUENCER' },
      { amountPaid: 100, rol: 'SOCIO' },
    ];
    let llamada = 0;
    prisma.commission.findMany = async ({ where }: any) => {
      const sinSocio = where?.NOT?.recipientCode?.is?.role === 'SOCIO';
      const filas = llamada++ === 0 ? [] : pagadas;
      return sinSocio ? filas.filter((c) => c.rol !== 'SOCIO') : filas;
    };
    const r = await svc.summary(true);
    expect(r.comisionesUsd).toBe(50);
    // La comisión del rol SOCIO no se resta como comisión: 1000 − 50 = 950
    // antes del socio, y su 10 % son 95.
    expect(r.socioUsd).toBe(95);
    expect(r.utilidadUsd).toBe(855);
  });

  it('con todas las marcas, la serie toma el neto de Clubify una sola vez', async () => {
    const { svc, prisma } = reporte();
    let consultas = 0;
    prisma.incomeRecord.findMany = async ({ select }: any) => {
      consultas++;
      // La segunda consulta (solo Clubify) pide únicamente fecha y neto.
      if (select && !('grossUsd' in select)) {
        return [{ saleDate: new Date('2026-09-10T15:00:00Z'), netExpectedUsd: 300 }];
      }
      return [
        { saleDate: new Date('2026-09-10T15:00:00Z'), grossUsd: 300, gatewayFeeUsd: 0, taxUsd: 0, netExpectedUsd: 300 },
        { saleDate: new Date('2026-09-11T15:00:00Z'), grossUsd: 700, gatewayFeeUsd: 0, taxUsd: 0, netExpectedUsd: 700 },
      ];
    };
    const [sep] = await svc.serieDeMeses(false, ['2026-09']);
    expect(consultas).toBe(2);
    expect(sep.socioUsd).toBe(30);
    expect(sep.utilidadUsd).toBe(970);
  });

  it('en la serie, los egresos y la nómina del socio también son los de Clubify', async () => {
    // El mismo caso que arriba pero en la gráfica: si la serie restara los
    // costos de TODAS las marcas de un neto que ya es solo el de Clubify, el
    // mismo mes enseñaría dos socios distintos —la barra y la cascada— en
    // cuanto Sellea tuviera su primer egreso.
    const { svc, prisma } = reporte();
    prisma.incomeRecord.findMany = async ({ select }: any) =>
      select && !('grossUsd' in select)
        ? [{ saleDate: new Date('2026-09-10T15:00:00Z'), netExpectedUsd: 600 }]
        : [{ saleDate: new Date('2026-09-10T15:00:00Z'), grossUsd: 1000, gatewayFeeUsd: 0, taxUsd: 0, netExpectedUsd: 1000 }];
    prisma.expense.findMany = async () => [
      { expenseDate: new Date('2026-09-05T15:00:00Z'), amountUsd: 40, whiteLabelId: CLUBIFY },
      { expenseDate: new Date('2026-09-06T15:00:00Z'), amountUsd: 60, whiteLabelId: 'wl-sellea' },
    ];
    prisma.payrollRun.findMany = async () => [
      { periodEnd: new Date('2026-09-15T12:00:00Z'), createdAt: new Date(), totalUsd: 25, whiteLabelId: null },
      { periodEnd: new Date('2026-09-15T12:00:00Z'), createdAt: new Date(), totalUsd: 35, whiteLabelId: 'wl-sellea' },
    ];
    const [sep] = await svc.serieDeMeses(false, ['2026-09']);
    // 600 − 40 − 25 = 535 → 53,50. Con los costos de todas: 44.
    expect(sep.socioUsd).toBe(53.5);
    expect(sep.utilidadUsd).toBe(786.5);
  });

  it('la serie mes a mes también descuenta al socio', async () => {
    const { svc, prisma } = reporte();
    prisma.incomeRecord.findMany = async () => [
      { saleDate: new Date('2026-09-10T15:00:00Z'), grossUsd: 500, gatewayFeeUsd: 0, taxUsd: 0, netExpectedUsd: 500 },
    ];
    const [sep] = await svc.serieDeMeses(true, ['2026-09']);
    expect(sep.socioUsd).toBe(50);
    expect(sep.utilidadUsd).toBe(450);
  });
});

// ── 4c. Las comisiones por CORTE ─────────────────────────────────────────────

/**
 * Sara (2026-09-17): «los pagos de comisiones se generan cada 15 días… la
 * información de las comisiones la debes traer del apartado de comisiones. Para
 * este corte estas son las comisiones que se van a pagar y no coinciden con lo
 * que hay en contabilidad».
 *
 * No coincidían porque Contabilidad agrupaba por la fecha de la comisión y el
 * módulo por el CORTE (cuando queda disponible, 15 días después). Caso real: las
 * 3 comisiones de Nicolas Rojas ($160) son de negocios de agosto y entran al
 * corte del 15-09; Contabilidad no las enseñaba y el corte sí las paga.
 */
describe('las comisiones repartidas por corte', () => {
  /**
   * El doble APLICA el `where`, no lo ignora. Con uno que devolviera siempre lo
   * mismo, ni el rango del mes ni la exclusión de las rechazadas y las del
   * socio estarían probadas: los tests pasarían con el filtro roto o sin él.
   */
  function reporte(cortes: any[], sueltas: any[] = []) {
    const { prisma } = prismaFalso({});
    prisma.payoutBatch = {
      findMany: async ({ where, include }: any) => {
        const r = where?.cutoffDate;
        const dentro = (c: any) =>
          (!r?.gte || c.cutoffDate >= r.gte) && (!r?.lte || c.cutoffDate <= r.lte);
        const w = include?.commissions?.where ?? {};
        const pasa = (k: any) =>
          !(w.status?.not === 'REJECTED' && k.status === 'REJECTED') &&
          !(w.NOT?.recipientCode?.is?.role === 'SOCIO' && k.recipientCode?.role === 'SOCIO');
        return cortes
          .filter(dentro)
          .map((c) => ({ ...c, commissions: c.commissions.filter(pasa) }));
      },
    };
    prisma.commission.findMany = async () => sueltas;
    // Los comprobantes de la transferencia viven aparte (`BatchPersonPayment`).
    // Estos casos miran el REPARTO por corte, no el respaldo: lista vacía.
    prisma.batchPersonPayment = { findMany: async () => [] };
    return new FinanceReportService(prisma, {} as any, {} as any);
  }

  const rojas = { code: 'JTK24H9Z', ownerName: 'Nicolas Rojas', role: 'INFLUENCER' };
  const quintero = { code: 'TAFMPWK5', ownerName: 'Nicolas Quintero', role: 'INFLUENCER' };

  const CORTE = {
    code: 'CORTE-2026-09-15',
    cutoffDate: new Date('2026-09-15T17:00:00Z'),
    periodStart: new Date('2026-09-01T05:00:00Z'),
    periodEnd: new Date('2026-09-15T23:59:00Z'),
    status: 'OPEN',
    paymentDate: null,
    receivedAt: null,
    commissions: [
      { amount: 100, amountPaid: 0, recipientCode: rojas },
      { amount: 60, amountPaid: 0, recipientCode: rojas },
      { amount: 165.7, amountPaid: 165.7, recipientCode: quintero },
    ],
  };

  it('el corte trae a TODOS los que cobran en él, aunque su venta fuera de otro mes', async () => {
    const r = await reporte([CORTE]).cortesDeComisiones('2026-09');
    expect(r.cortes).toHaveLength(1);
    const c = r.cortes[0];
    expect(c.code).toBe('CORTE-2026-09-15');
    expect(c.count).toBe(3);
    expect(c.totalUsd).toBe(325.7);
    expect(c.personas.map((p) => p.nombre)).toContain('Nicolas Rojas');
    expect(c.personas.find((p) => p.nombre === 'Nicolas Rojas')).toMatchObject({ count: 2, totalUsd: 160, pendienteUsd: 160 });
  });

  it('lo pagado del corte sale de las comisiones marcadas como pagadas en su módulo', async () => {
    const r = await reporte([CORTE]).cortesDeComisiones('2026-09');
    expect(r.cortes[0].pagadoUsd).toBe(165.7);
    expect(r.cortes[0].pendienteUsd).toBe(160);
    expect(r.pagadoCortesUsd).toBe(165.7);
  });

  it('lo generado que todavía no entra a ningún corte se informa aparte, no se suma', async () => {
    const r = await reporte([CORTE], [{ amount: 37.5, availableAt: new Date('2026-10-02T05:00:00Z') }]).cortesDeComisiones('2026-09');
    expect(r.totalCortesUsd).toBe(325.7);
    expect(r.sinCorte).toEqual({ count: 1, totalUsd: 37.5 });
  });

  it('un mes con varios cortes los enseña por separado', async () => {
    const otro = { ...CORTE, code: 'CORTE-2026-09-30', commissions: [{ amount: 20, amountPaid: 0, recipientCode: quintero }] };
    const r = await reporte([CORTE, otro]).cortesDeComisiones('2026-09');
    expect(r.cortes.map((c) => c.code)).toEqual(['CORTE-2026-09-15', 'CORTE-2026-09-30']);
    expect(r.totalCortesUsd).toBe(345.7);
  });

  it('un mes sin cortes no inventa ninguno', async () => {
    const r = await reporte([]).cortesDeComisiones('2026-05');
    expect(r.cortes).toEqual([]);
    expect(r.totalCortesUsd).toBe(0);
  });

  it('el corte de otro mes no se cuela en el mes que se está mirando', async () => {
    // El mes lo acota la FECHA DE CORTE: sin ese filtro, mayo enseñaría el
    // corte de septiembre y la pestaña volvería a no cuadrar con el módulo.
    const r = await reporte([CORTE]).cortesDeComisiones('2026-05');
    expect(r.cortes).toEqual([]);
    const sep = await reporte([CORTE]).cortesDeComisiones('2026-09');
    expect(sep.cortes).toHaveLength(1);
  });

  it('dentro del corte, ni las rechazadas ni las del socio suman', async () => {
    // Una comisión RECHAZADA no se paga, y la del rol SOCIO ya se resta como
    // su propia línea de la cascada: contarla aquí sería restarla dos veces.
    const conBasura = {
      ...CORTE,
      commissions: [
        ...CORTE.commissions,
        { amount: 500, amountPaid: 0, status: 'REJECTED', recipientCode: rojas },
        { amount: 90, amountPaid: 0, recipientCode: { code: 'SOC1', ownerName: 'El socio', role: 'SOCIO' } },
      ],
    };
    const r = await reporte([conBasura]).cortesDeComisiones('2026-09');
    expect(r.cortes[0].count).toBe(3);
    expect(r.cortes[0].totalUsd).toBe(325.7);
    expect(r.cortes[0].personas.map((p) => p.rol)).not.toContain('SOCIO');
  });
});

// ── 5. Filtros de tiempo ────────────────────────────────────────────────────

describe('los filtros de período', () => {
  const iso = (d?: Date) => d?.toISOString();

  it('un mes es solo ese mes, en hora de Bogotá', () => {
    const s = limitesDelPeriodo('2026-09')!;
    expect(iso(s.from)).toBe('2026-09-01T05:00:00.000Z');
    expect(iso(s.to)).toBe('2026-10-01T04:59:59.999Z');
  });

  it('cambiar a agosto trae solo agosto', () => {
    const a = limitesDelPeriodo('2026-08')!;
    expect(iso(a.from)).toBe('2026-08-01T05:00:00.000Z');
    expect(iso(a.to)).toBe('2026-09-01T04:59:59.999Z');
    // Y no se solapa con septiembre ni deja hueco entre medias.
    expect(iso(a.to)! < iso(limitesDelPeriodo('2026-09')!.from)!).toBe(true);
  });

  it('un trimestre empieza donde su primer mes y acaba donde el tercero', () => {
    const t = limitesDelPeriodo('2026-T3')!;
    expect(iso(t.from)).toBe(iso(limitesDelPeriodo('2026-07')!.from));
    expect(iso(t.to)).toBe(iso(limitesDelPeriodo('2026-09')!.to));
  });

  it('un año va de enero a diciembre', () => {
    const a = limitesDelPeriodo('2026')!;
    expect(iso(a.from)).toBe(iso(limitesDelPeriodo('2026-01')!.from));
    expect(iso(a.to)).toBe(iso(limitesDelPeriodo('2026-12')!.to));
  });

  it('«todo» es el histórico entero: sin límites', () => {
    expect(limitesDelPeriodo('todo')).toEqual({});
    expect(limitesDelPeriodo('')).toEqual({});
  });

  it('una venta del 30 a las 9 de la noche en Bogotá es de ESE mes', () => {
    // 2026-09-30 21:00 Bogotá = 2026-10-01 02:00 UTC. Contada en UTC caería en
    // octubre y descuadraría el cierre de septiembre contra el extracto.
    const sept = limitesDelPeriodo('2026-09')!;
    const venta = new Date('2026-10-01T02:00:00Z');
    expect(venta >= sept.from! && venta <= sept.to!).toBe(true);
  });
});

// ── 6. El conciliador ───────────────────────────────────────────────────────

describe('el conciliador de ingresos', () => {
  const eventoHotmart = (p: {
    tipo: string;
    tx: string;
    valor?: number;
    moneda?: string;
    recurrencia?: number;
    cuando?: string;
  }) => ({
    eventType: p.tipo,
    tenantId: 't1',
    processedAt: new Date(p.cuando ?? '2026-09-11T18:00:00Z'),
    payload: {
      data: {
        product: { id: 6504901, name: 'CLUBIFY' },
        buyer: { email: 'a@b.c' },
        subscription: { plan: { name: 'Plan Trimestral 150 USD' } },
        purchase: {
          transaction: p.tx,
          approved_date: Date.parse(p.cuando ?? '2026-09-11T18:00:00Z'),
          recurrence_number: p.recurrencia ?? 1,
          price: { value: p.valor ?? 137.65, currency_value: p.moneda ?? 'PAB' },
        },
      },
    },
  });

  function conciliador(datos: Parameters<typeof prismaFalso>[0]) {
    const { prisma, estado } = prismaFalso(datos);
    const income = new IncomeRecordService(prisma);
    return { srv: new ConciliadorDeIngresosService(prisma, income), estado };
  }

  it('recupera un cobro que está en la pasarela y no en el libro', async () => {
    const { srv, estado } = conciliador({
      eventosHotmart: [eventoHotmart({ tipo: 'PURCHASE_APPROVED', tx: 'HP-PERDIDO' })],
      negocios: [
        {
          id: 't1', brandName: 'Chillin', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: null,
        },
      ],
      ajustes: { 'landing.plans.trimestral.price': '150' },
    });
    const informe = await srv.conciliar({});
    expect(informe.creados).toHaveLength(1);
    // Cuenta el PRECIO DEL PLAN, no los 137,65 PAB del pago: el importe en
    // moneda local descuadraría el reporte (política de 2026-09-03).
    expect(informe.creados[0].grossUsd).toBe(150);
    expect(informe.creados[0].categoria).toBe('NUEVA');
    expect(estado.creados).toHaveLength(1);
  });

  it('correrlo dos veces no crea nada la segunda', async () => {
    const { srv, estado } = conciliador({
      eventosHotmart: [eventoHotmart({ tipo: 'PURCHASE_APPROVED', tx: 'HP-X' })],
      negocios: [
        {
          id: 't1', brandName: 'N', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: null,
        },
      ],
      ajustes: { 'landing.plans.trimestral.price': '150' },
    });
    await srv.conciliar({});
    const segunda = await srv.conciliar({});
    expect(segunda.creados).toHaveLength(0);
    expect(estado.creados).toHaveLength(1);
  });

  it('APPROVED y COMPLETE de la misma compra son UN movimiento', async () => {
    const { srv, estado } = conciliador({
      eventosHotmart: [
        eventoHotmart({ tipo: 'PURCHASE_APPROVED', tx: 'HP-DOBLE' }),
        eventoHotmart({ tipo: 'PURCHASE_COMPLETE', tx: 'HP-DOBLE' }),
      ],
      negocios: [
        {
          id: 't1', brandName: 'N', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: null,
        },
      ],
      ajustes: { 'landing.plans.trimestral.price': '150' },
    });
    const informe = await srv.conciliar({});
    expect(informe.creados).toHaveLength(1);
    expect(estado.creados).toHaveLength(1);
  });

  it('un reembolso marca el cobro y no crea un movimiento nuevo', async () => {
    const { srv, estado } = conciliador({
      ingresos: [ingreso({ externalTxId: 'HP-R', grossUsd: 49.52 })],
      eventosHotmart: [
        eventoHotmart({ tipo: 'PURCHASE_REFUNDED', tx: 'HP-R' }),
      ],
    });
    const informe = await srv.conciliar({});
    expect(informe.devueltos).toEqual([
      { externalTxId: 'HP-R', estado: 'REEMBOLSADO' },
    ]);
    expect(estado.creados).toHaveLength(0);
    expect(estado.ingresos[0].status).toBe('REEMBOLSADO');
  });

  it('una disputa abierta NO resta: se señala para revisar', async () => {
    const { srv, estado } = conciliador({
      ingresos: [ingreso({ externalTxId: 'HP-D' })],
      eventosHotmart: [eventoHotmart({ tipo: 'PURCHASE_PROTEST', tx: 'HP-D' })],
    });
    const informe = await srv.conciliar({});
    expect(informe.enDisputa).toEqual(['HP-D']);
    expect(informe.devueltos).toHaveLength(0);
    expect(estado.ingresos[0].status).toBe('PAGADO');
  });

  it('una disputa que acaba en reembolso sí resta, una sola vez', async () => {
    const { srv, estado } = conciliador({
      ingresos: [ingreso({ externalTxId: 'HP-DR' })],
      eventosHotmart: [
        eventoHotmart({ tipo: 'PURCHASE_PROTEST', tx: 'HP-DR', cuando: '2026-09-11T10:00:00Z' }),
        eventoHotmart({ tipo: 'PURCHASE_REFUNDED', tx: 'HP-DR', cuando: '2026-09-11T11:00:00Z' }),
      ],
    });
    const informe = await srv.conciliar({});
    expect(informe.enDisputa).toHaveLength(0);
    expect(informe.devueltos).toHaveLength(1);
    expect(estado.ingresos[0].status).toBe('REEMBOLSADO');
  });

  it('no inventa un importe cuando no hay de dónde sacarlo', async () => {
    const { srv, estado } = conciliador({
      eventosHotmart: [
        {
          eventType: 'PURCHASE_APPROVED',
          tenantId: null,
          processedAt: new Date('2026-09-11T18:00:00Z'),
          payload: {
            data: {
              buyer: { email: 'x@y.z' },
              purchase: {
                transaction: 'HP-SIN-PRECIO',
                price: { value: 500000, currency_value: 'COP' },
              },
            },
          },
        },
      ],
      negocios: [],
    });
    const informe = await srv.conciliar({});
    expect(informe.creados).toHaveLength(0);
    expect(estado.creados).toHaveLength(0);
    expect(informe.sinResolver[0]).toMatchObject({ externalTxId: 'HP-SIN-PRECIO' });
  });

  it('adopta la referencia real en una fila de relleno, sin duplicar', async () => {
    const { srv, estado } = conciliador({
      ingresos: [
        ingreso({
          id: 'relleno',
          externalTxId: 'backfill-last-t1',
          grossUsd: 150,
          saleDate: new Date('2026-09-11T12:00:00Z'),
          brandName: 'Chillin',
        }),
      ],
      eventosHotmart: [
        eventoHotmart({ tipo: 'PURCHASE_APPROVED', tx: 'HP-REAL', cuando: '2026-09-11T18:00:00Z' }),
      ],
      negocios: [
        {
          id: 't1', brandName: 'Chillin', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: null,
        },
      ],
      ajustes: { 'landing.plans.trimestral.price': '150' },
    });
    const informe = await srv.conciliar({});
    expect(informe.creados).toHaveLength(0);
    expect(informe.adoptados).toEqual([
      { de: 'backfill-last-t1', a: 'HP-REAL', brandName: 'Chillin' },
    ]);
    expect(estado.ingresos[0].externalTxId).toBe('HP-REAL');
  });

  it('simular no escribe nada', async () => {
    const { srv, estado } = conciliador({
      eventosHotmart: [eventoHotmart({ tipo: 'PURCHASE_APPROVED', tx: 'HP-SIM' })],
      negocios: [
        {
          id: 't1', brandName: 'N', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: null,
        },
      ],
      ajustes: { 'landing.plans.trimestral.price': '150' },
    });
    const informe = await srv.conciliar({ simular: true });
    expect(informe.creados).toHaveLength(1);
    expect(estado.creados).toHaveLength(0);
  });
});

// ── 7. El módulo origen manda ───────────────────────────────────────────────

describe('la fuente de verdad', () => {
  it('cambiar el precio del negocio cambia lo que el conciliador registraría', async () => {
    // Contabilidad no guarda su propio precio: lo lee del negocio. Si alguien
    // corrige el plan en su módulo, el ingreso recuperado sale corregido.
    const base = {
      eventosHotmart: [
        {
          eventType: 'PURCHASE_APPROVED',
          tenantId: 't1',
          processedAt: new Date('2026-09-11T18:00:00Z'),
          payload: {
            data: {
              purchase: {
                transaction: 'HP-FUENTE',
                price: { value: 137.65, currency_value: 'PAB' },
              },
            },
          },
        },
      ],
      ajustes: { 'landing.plans.trimestral.price': '150' },
    };
    const conPrecio = prismaFalso({
      ...base,
      negocios: [
        {
          id: 't1', brandName: 'N', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: 135,
        },
      ],
    });
    const a = await new ConciliadorDeIngresosService(
      conPrecio.prisma,
      new IncomeRecordService(conPrecio.prisma),
    ).conciliar({ simular: true });
    expect(a.creados[0].grossUsd).toBe(135);

    olvidarMarcaClubify();
    const sinPrecio = prismaFalso({
      ...base,
      negocios: [
        {
          id: 't1', brandName: 'N', whiteLabelId: CLUBIFY, planId: 'p1',
          planPeriodicity: 'TRIMESTRAL', subscriptionPriceUsd: null,
        },
      ],
    });
    const b = await new ConciliadorDeIngresosService(
      sinPrecio.prisma,
      new IncomeRecordService(sinPrecio.prisma),
    ).conciliar({ simular: true });
    expect(b.creados[0].grossUsd).toBe(150);
  });
});
