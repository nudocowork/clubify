/**
 * La Gloriosa: la comisión de un cobro lleva la fecha del COBRO, no la del día
 * en que alguien atribuyó la venta, y respeta la excepción de % del negocio.
 *
 * NO necesita base de datos ni red.
 *
 * Qué pasó (producción, arqueo del 2026-09-15):
 *  - 24-jul — La Gloriosa paga su trimestre por fuera de la pasarela.
 *  - 31-ago — se le asigna a Nicolás Rojas (INFLUENCER, 25%) desde el panel.
 *    El backfill de esa asignación crea la comisión con `periodKey` 2026-08 (el
 *    mes de HOY) y sin `businessDate` ni `availableAt`: los dos paneles la
 *    pintan el 31-ago y se desbloquea el 15-sep en vez del 8-ago.
 *  - Javier la quiere al 20% en ese negocio. La excepción por negocio
 *    (`CommissionException`) la respetan el webhook, el reconciliador y el
 *    arqueo… pero NO este backfill, que es justo el que dispara el pago manual:
 *    el trimestre siguiente habría vuelto a salir al 25%.
 *
 * Estas pruebas fijan las dos cosas, y lo que NO debe pasar al usar la fecha del
 * cobro:
 *  - un `lastChargeAt` VIEJO (ciclo cerrado, o negocio sin fin de ciclo como la
 *    activación «free») no fecha la comisión: nacería disponible al instante;
 *  - la rama VENDOR recibe esa misma fecha validada, no la cruda;
 *  - el candado contra devengar dos veces el mismo cobro se ancla al COBRO (25
 *    días antes), no al reloj: «Marcar pagado» sobre un cobro ya devengado no
 *    crea otra, y re-guardar la asignación al día 26 tampoco.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReferralsService } from './referrals.service';

const DIA = 86400000;
// «Hoy» fijo: el backfill compara contra el reloj (ciclo vigente, hold de 15
// días). Sin fijarlo, los casos de julio caducarían solos con el calendario.
const HOY = new Date('2026-09-15T15:00:00.000Z');
const COBRO_JULIO = new Date('2026-07-24T12:00:00.000Z');
const COBRO_OCTUBRE = new Date('2026-10-24T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(HOY);
});
afterEach(() => {
  vi.useRealTimers();
});

const sumarMeses = (d: Date, meses: number) => {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + meses);
  return r;
};

type Fila = {
  id: string;
  referralUseId: string;
  businessDate: Date | null;
  createdAt: Date;
};

/** Evalúa en memoria el `where` que usa el candado de ciclo. */
function coincide(f: Fila, where: any): boolean {
  if (where.referralUseId && f.referralUseId !== where.referralUseId) return false;
  if (where.createdAt?.gte && !(f.createdAt >= where.createdAt.gte)) return false;
  if (Array.isArray(where.OR)) {
    return where.OR.some((o: any) => {
      if (o.businessDate === null) {
        return f.businessDate === null && (!o.createdAt?.gte || f.createdAt >= o.createdAt.gte);
      }
      if (o.businessDate?.gte) return !!f.businessDate && f.businessDate >= o.businessDate.gte;
      return false;
    });
  }
  return true;
}

function servicio(opts: {
  lastChargeAt: Date | null;
  /** Por defecto, el cobro + 3 meses (trimestral pagado ese día). `null` = sin fin de ciclo. */
  currentPeriodEnd?: Date | null;
  planPeriodicity?: string;
  rol?: 'INFLUENCER' | 'AMBASSADOR' | 'VENDOR';
  pctCodigo?: number;
  /** recipientCodeId → % de la excepción activa para este negocio */
  excepciones?: Record<string, number>;
  filas?: Fila[];
  padre?: { id: string } | null;
}) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.audit = { log: vi.fn() };
  const filas = opts.filas ?? [];
  const currentPeriodEnd =
    opts.currentPeriodEnd !== undefined
      ? opts.currentPeriodEnd
      : opts.lastChargeAt
        ? sumarMeses(opts.lastChargeAt, 3)
        : new Date(Date.now() + 30 * DIA);
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        currentPeriodEnd,
        suspendedAt: null,
        planPeriodicity: opts.planPeriodicity ?? 'TRIMESTRAL',
        subscriptionPriceUsd: null,
        whiteLabelId: null,
        hotmartTransactionId: null,
        lastChargeAt: opts.lastChargeAt,
        plan: { priceMonthly: 68 },
      })),
    },
    referralCode: {
      findUnique: vi.fn(async () => ({
        id: 'rojas',
        code: 'JTK24H9Z',
        role: opts.rol ?? 'INFLUENCER',
        commissionPercent: opts.pctCodigo ?? 25,
        fixedCommissionUsd: null,
        parentCode: opts.padre ?? null,
      })),
    },
    commission: {
      findFirst: vi.fn(async ({ where }: any) => filas.find((f) => coincide(f, where)) ?? null),
      create: vi.fn(async () => ({})),
    },
    setting: { findUnique: vi.fn(async () => ({ value: '5' })) },
  };
  svc.recalc = { getCommissionBase: vi.fn(async () => 150) };
  svc.getBrandCommissionMode = vi.fn(async () => 'PERCENT_RECURRING');
  svc.slugForWhiteLabelId = vi.fn(async () => null);
  svc.commissionExceptions = {
    resolvePercent: vi.fn(
      async (_tenantId: string, codeId: string, fallback: number) =>
        opts.excepciones?.[codeId] ?? fallback,
    ),
  };
  // Solo lo usa la rama VENDOR; aquí se observa con qué fecha se le llama.
  svc.generateCommissionsForPayment = vi.fn(async () => ({ generated: 2, skipped: 0 }));
  return svc;
}

const creadas = (svc: any) =>
  svc.prisma.commission.create.mock.calls.map((c: any) => c[0].data);

describe('backfill de atribución · la comisión lleva la fecha del cobro', () => {
  it('fecha de negocio, período y desbloqueo salen del cobro (24-jul), no de hoy', async () => {
    const svc = servicio({ lastChargeAt: COBRO_JULIO });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    const [c] = creadas(svc);
    expect(c.businessDate).toEqual(COBRO_JULIO);
    expect(c.periodKey).toBe('2026-07');
    // Hold de 15 días desde el cobro: ya vencido → el cron la aprueba al pasar.
    expect(c.availableAt).toEqual(new Date(COBRO_JULIO.getTime() + 15 * DIA));
  });

  it('sin fecha de cobro (negocio creado a mano, force) cae a hoy, como antes', async () => {
    const svc = servicio({ lastChargeAt: null });

    await svc.backfillCommissionForAssignment('use-1', 'negocio', 'rojas', true);

    const [c] = creadas(svc);
    expect(c.businessDate).toEqual(HOY);
    expect(c.periodKey).toBe('2026-09');
  });
});

describe('backfill de atribución · un cobro VIEJO no fecha la comisión', () => {
  it('Birria León: cobro de enero y ciclo semestral hasta ene-2027 → hoy, no enero', async () => {
    // Re-guardar su asignación o «Generar comisión ahora» habría creado una
    // comisión de 2026-01 disponible desde el 16-ene, y el top-up la habría
    // metido en el corte abierto de hoy. Ese cobro es de un ciclo ya cerrado.
    const svc = servicio({
      lastChargeAt: new Date('2026-01-01T17:00:00.000Z'),
      currentPeriodEnd: new Date('2027-01-12T17:00:00.000Z'),
      planPeriodicity: 'SEMESTRAL',
    });

    await svc.backfillCommissionForAssignment('use-birria', 'birria', 'rojas');

    const [c] = creadas(svc);
    expect(c.businessDate).toEqual(HOY);
    expect(c.periodKey).toBe('2026-09');
    expect(c.availableAt).toEqual(new Date(HOY.getTime() + 15 * DIA));
  });

  it('activación «free» (sin fin de ciclo) de hace meses + «Generar comisión ahora» → hoy + 15 días', async () => {
    // El modo free escribe currentPeriodEnd null y lastChargeAt = ese día. El
    // botón reintenta con force=true, que se salta el chequeo de ciclo vigente:
    // sin este candado la comisión nacía en mayo y con el hold ya vencido.
    const svc = servicio({
      lastChargeAt: new Date('2026-05-10T14:00:00.000Z'),
      currentPeriodEnd: null,
    });

    await svc.backfillCommissionForAssignment('use-1', 'negocio-free', 'rojas', true);

    const [c] = creadas(svc);
    expect(c.businessDate).toEqual(HOY);
    expect(c.periodKey).toBe('2026-09');
    expect(c.availableAt).toEqual(new Date(HOY.getTime() + 15 * DIA));
  });

  it('el ciclo corrido hasta 2 días (margen del reconciliador) sigue usando la fecha del cobro', async () => {
    const svc = servicio({
      lastChargeAt: COBRO_JULIO,
      currentPeriodEnd: new Date('2026-10-26T12:00:00.000Z'),
    });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    expect(creadas(svc)[0].businessDate).toEqual(COBRO_JULIO);
  });

  it('corrido más de 2 días, el cobro ya no se da por de este ciclo → hoy', async () => {
    const svc = servicio({
      lastChargeAt: COBRO_JULIO,
      currentPeriodEnd: new Date('2026-10-27T12:00:00.000Z'),
    });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    expect(creadas(svc)[0].businessDate).toEqual(HOY);
  });

  it('VENDOR con cobro viejo: el split recibe la fecha validada (hoy), no el lastChargeAt crudo', async () => {
    const svc = servicio({
      lastChargeAt: new Date('2026-01-01T17:00:00.000Z'),
      currentPeriodEnd: new Date('2027-01-12T17:00:00.000Z'),
      planPeriodicity: 'SEMESTRAL',
      rol: 'VENDOR',
    });

    await svc.backfillCommissionForAssignment('use-1', 'birria', 'rojas');

    expect(svc.generateCommissionsForPayment).toHaveBeenCalledTimes(1);
    expect(svc.generateCommissionsForPayment.mock.calls[0][0].businessDate).toEqual(HOY);
  });

  it('VENDOR con cobro del ciclo vigente: le pasa la fecha de ese cobro', async () => {
    const svc = servicio({ lastChargeAt: COBRO_JULIO, rol: 'VENDOR' });

    await svc.backfillCommissionForAssignment('use-1', 'gloriosa', 'rojas');

    expect(svc.generateCommissionsForPayment.mock.calls[0][0].businessDate).toEqual(COBRO_JULIO);
  });
});

describe('generateCommissionsForPayment · la fecha que le pasan manda', () => {
  function generador(lastChargeAt: Date) {
    const svc = Object.create(ReferralsService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const tx = {
      commission: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    };
    svc.prisma = {
      tenant: {
        findUnique: vi.fn(async () => ({
          subscriptionPriceUsd: null,
          planPeriodicity: 'SEMESTRAL',
          lastChargeAt,
        })),
      },
      referralUse: { findFirst: vi.fn(async () => ({ id: 'use-1' })) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    svc.recalc = { getCommissionBase: vi.fn(async () => 278) };
    svc.computeExpectedCommissionRows = vi.fn(async () => ({
      chain: { sourceCodeId: 'vendedor' },
      rows: [
        { recipientCodeId: 'rojas', vendorCodeId: null, amount: 55.6, appliedPercent: 20 },
        { recipientCodeId: 'vendedor', vendorCodeId: 'vendedor', amount: 13.9, appliedPercent: 5 },
      ],
      mode: 'DISCOUNT_FROM_INFLUENCER',
    }));
    return { svc, tx };
  }
  const filasCreadas = (tx: any) => tx.commission.create.mock.calls.map((c: any) => c[0].data);

  it('con fecha validada: las filas del split nacen con ella y 15 días de hold', async () => {
    const { svc, tx } = generador(new Date('2026-01-01T17:00:00.000Z'));

    await svc.generateCommissionsForPayment({
      tenantId: 'birria',
      paymentAmountUsd: 278,
      businessDate: HOY,
    });

    const filas = filasCreadas(tx);
    expect(filas).toHaveLength(2);
    for (const f of filas) {
      expect(f.businessDate).toEqual(HOY);
      expect(f.periodKey).toBe('2026-09');
      expect(f.availableAt).toEqual(new Date(HOY.getTime() + 15 * DIA));
    }
  });

  it('sin fecha (webhook): sigue usando Tenant.lastChargeAt, como siempre', async () => {
    const cobro = new Date('2026-09-10T13:00:00.000Z');
    const { svc, tx } = generador(cobro);

    await svc.generateCommissionsForPayment({
      tenantId: 't',
      paymentAmountUsd: 278,
      hotmartTransactionId: 'HP1',
    });

    const [f] = filasCreadas(tx);
    expect(f.businessDate).toEqual(cobro);
    expect(f.availableAt).toEqual(new Date(cobro.getTime() + 15 * DIA));
  });
});

describe('backfill de atribución · respeta la excepción de % del negocio', () => {
  it('con excepción al 20%: $30 sobre $150 aunque el código esté al 25%', async () => {
    const svc = servicio({ lastChargeAt: COBRO_JULIO, excepciones: { rojas: 20 } });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    const [c] = creadas(svc);
    expect(c.amount).toBe(30);
    expect(c.appliedPercent).toBe(20);
    expect(c.baseAmountUsd).toBe(150);
    expect(svc.commissionExceptions.resolvePercent).toHaveBeenCalledWith('gloriosa', 'rojas', 25);
  });

  it('sin excepción: el % del código, sin cambios (25% → $37.50)', async () => {
    const svc = servicio({ lastChargeAt: COBRO_JULIO });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    expect(creadas(svc)[0].amount).toBe(37.5);
  });

  it('embajador: la indirecta del influencer mira SU excepción y lleva la misma fecha', async () => {
    const svc = servicio({
      lastChargeAt: COBRO_JULIO,
      rol: 'AMBASSADOR',
      padre: { id: 'influencer-padre' },
      excepciones: { 'influencer-padre': 3 },
    });

    await svc.backfillCommissionForAssignment('use-1', 'negocio', 'rojas');

    const [directa, indirecta] = creadas(svc);
    expect(directa.amount).toBe(37.5);
    expect(indirecta.recipientCodeId).toBe('influencer-padre');
    expect(indirecta.amount).toBe(4.5);
    expect(indirecta.appliedPercent).toBe(3);
    expect(indirecta.businessDate).toEqual(COBRO_JULIO);
    expect(indirecta.periodKey).toBe('2026-07');
  });
});

describe('backfill de atribución · no devenga dos veces el mismo cobro', () => {
  it('ya hay una comisión de este cobro → no crea otra', async () => {
    const svc = servicio({
      lastChargeAt: COBRO_JULIO,
      filas: [
        {
          id: 'ya-corregida',
          referralUseId: 'use-gloriosa',
          businessDate: COBRO_JULIO,
          createdAt: new Date('2026-08-31T19:47:09Z'),
        },
      ],
    });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    expect(svc.prisma.commission.create).not.toHaveBeenCalled();
  });

  it('re-guardar la asignación 30 días después no duplica: la ventana va anclada al cobro, no al reloj', async () => {
    // El candado viejo contaba 25 días desde HOY: al día 26 dejaba de ver la
    // comisión y nacía otra con otro periodKey que la UNIQUE no frenaba.
    vi.setSystemTime(new Date('2026-10-01T15:00:00.000Z'));
    const svc = servicio({
      lastChargeAt: COBRO_JULIO,
      filas: [
        {
          id: 'ya-corregida',
          referralUseId: 'use-gloriosa',
          businessDate: COBRO_JULIO,
          createdAt: new Date('2026-08-31T19:47:09Z'),
        },
      ],
    });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    expect(svc.prisma.commission.create).not.toHaveBeenCalled();
  });

  it('«Marcar pagado» 18 días después de un cobro de Hotmart ya devengado → no crea otra', async () => {
    // Cobro Hotmart del 28-ago con su comisión (2026-08). El 15-sep alguien pulsa
    // «Marcar pagado»: convertToPaying escribe lastChargeAt = ahora sin prueba de
    // un cobro nuevo. Con un margen de 2 días la de agosto no contaba y nacía
    // otra en 2026-09 que ni la UNIQUE ni el arqueo frenaban.
    const svc = servicio({
      lastChargeAt: HOY,
      currentPeriodEnd: sumarMeses(HOY, 1),
      planPeriodicity: 'MENSUAL',
      filas: [
        {
          id: 'agosto-hotmart',
          referralUseId: 'use-1',
          businessDate: new Date('2026-08-28T16:20:00.000Z'),
          createdAt: new Date('2026-08-28T16:22:00.000Z'),
        },
      ],
    });

    await svc.backfillCommissionForAssignment('use-1', 'negocio', 'rojas');

    expect(svc.prisma.commission.create).not.toHaveBeenCalled();
  });

  it('fila vieja sin fecha creada tras el cobro → no duplica, aunque tenga más de 25 días', async () => {
    // Es la comisión de La Gloriosa tal como está hoy.
    const svc = servicio({
      lastChargeAt: new Date('2026-07-04T12:00:00.000Z'),
      filas: [
        {
          id: 'a546a111',
          referralUseId: 'use-gloriosa',
          businessDate: null,
          createdAt: new Date(HOY.getTime() - 40 * DIA),
        },
      ],
    });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    expect(svc.prisma.commission.create).not.toHaveBeenCalled();
  });

  it('la comisión del trimestre ANTERIOR (con fecha) no tapa el cobro nuevo, aunque sea reciente', async () => {
    // Pago manual del trimestre siguiente registrado dos días después del cobro,
    // poco después de que se insertara (tarde) la comisión del anterior. El
    // candado viejo lo tragaba (fila creada hace <25 días). Funciona porque esa
    // fila lleva su businessDate; una SIN fecha lo seguiría tapando.
    vi.setSystemTime(new Date('2026-10-26T15:00:00.000Z'));
    const svc = servicio({
      lastChargeAt: COBRO_OCTUBRE,
      excepciones: { rojas: 20 },
      filas: [
        {
          id: 'trimestre-julio',
          referralUseId: 'use-gloriosa',
          businessDate: COBRO_JULIO,
          createdAt: new Date('2026-10-20T10:00:00.000Z'),
        },
      ],
    });

    await svc.backfillCommissionForAssignment('use-gloriosa', 'gloriosa', 'rojas');

    const nuevas = creadas(svc);
    expect(nuevas).toHaveLength(1);
    expect(nuevas[0].periodKey).toBe('2026-10');
    expect(nuevas[0].amount).toBe(30);
  });
});
