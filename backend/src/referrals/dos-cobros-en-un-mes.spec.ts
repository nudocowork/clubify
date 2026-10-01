/**
 * DOS COBROS EN EL MISMO MES (Wok Explosivo, 2026-10-01)
 *
 * Plan mensual. El cobro del 26-ago se retrasó y entró el 1-sep; el siguiente
 * entró el 28-sep, a su día. El webhook del 28 no creó comisión: había otra
 * con fecha en septiembre y se dio el mes por cobrado. Y aunque se hubiera
 * intentado, la clave única (referido, afiliado, `periodKey` = mes) la habría
 * rechazado.
 *
 * Base falsa en memoria que APLICA la clave única como Postgres: con el código
 * viejo el caso de Wok sale con 0 comisiones creadas.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';
import { claveDelPeriodo, esElMismoCobro } from './clave-del-periodo';

type Fila = {
  id: string;
  referralUseId: string;
  recipientCodeId: string;
  periodKey: string;
  businessDate: Date | null;
  createdAt: Date;
  hotmartTransactionId: string | null;
};

function coincide(f: Fila, where: any): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (!(v as any[]).some((o) => coincide(f, o))) return false;
      continue;
    }
    const valor = (f as any)[k];
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = v as any;
      if (c.gte && !(valor && valor >= c.gte)) return false;
      if (c.lte && !(valor && valor <= c.lte)) return false;
      if (c.lt && !(valor && valor < c.lt)) return false;
      continue;
    }
    if (valor !== v) return false;
  }
  return true;
}

function servicio(filas: Fila[], fechaDelCobro: Date) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.recalc = { getCommissionBase: vi.fn(async () => 50) };
  svc.computeExpectedCommissionRows = vi.fn(async () => ({
    chain: { sourceCodeId: 'quintero' },
    mode: 'DISCOUNT_FROM_INFLUENCER',
    rows: [{ recipientCodeId: 'quintero', amount: 5, appliedPercent: 10, vendorCodeId: null }],
  }));
  const commission = {
    findFirst: vi.fn(async ({ where }: any) => filas.find((f) => coincide(f, where)) ?? null),
    findMany: vi.fn(async ({ where }: any) => filas.filter((f) => coincide(f, where))),
    create: vi.fn(async ({ data }: any) => {
      // La UNIQUE(referralUseId, recipientCodeId, periodKey), como en Postgres.
      const choca = filas.some(
        (f) =>
          f.referralUseId === data.referralUseId &&
          f.recipientCodeId === data.recipientCodeId &&
          f.periodKey === data.periodKey,
      );
      if (choca) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      const fila = { id: `n${filas.length}`, createdAt: new Date(), ...data };
      filas.push(fila);
      return fila;
    }),
  };
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        subscriptionPriceUsd: null,
        planPeriodicity: 'MENSUAL',
        lastChargeAt: fechaDelCobro,
      })),
    },
    referralUse: { findFirst: vi.fn(async () => ({ id: 'wok' })) },
    commission,
    $transaction: async (fn: any) => fn({ commission }),
  };
  return svc as ReferralsService;
}

const UNO_SEP = new Date('2026-09-01T23:42:00Z');
const VEINTIOCHO_SEP = new Date('2026-09-28T13:37:00Z');

const comisionDel1 = (): Fila => ({
  id: 'sep1',
  referralUseId: 'wok',
  recipientCodeId: 'quintero',
  periodKey: '2026-09',
  businessDate: UNO_SEP,
  createdAt: UNO_SEP,
  hotmartTransactionId: null,
});

describe('dos cobros reales en el mismo mes', () => {
  it('Wok: el cobro del 28-sep genera su comisión aunque el 1-sep ya tenga una', async () => {
    const filas = [comisionDel1()];
    const r = await servicio(filas, VEINTIOCHO_SEP).generateCommissionsForPayment({
      tenantId: 't-wok',
      paymentAmountUsd: 50,
      hotmartTransactionId: 'HP1073184282',
    });
    expect(r.generated).toBe(1);
    const nueva = filas.find((f) => f.hotmartTransactionId === 'HP1073184282')!;
    expect(nueva.periodKey).toBe('2026-09-28');
    expect(nueva.businessDate).toEqual(VEINTIOCHO_SEP);
  });

  it('el primer cobro del mes sigue usando la clave del mes', async () => {
    const filas: Fila[] = [];
    await servicio(filas, UNO_SEP).generateCommissionsForPayment({
      tenantId: 't-wok',
      paymentAmountUsd: 50,
      hotmartTransactionId: 'HP2984837560',
    });
    expect(filas[0].periodKey).toBe('2026-09');
  });

  it('el MISMO cobro que ya creó el reconciliador (sin transacción) no se duplica', async () => {
    const filas: Fila[] = [
      { ...comisionDel1(), id: 'rec', businessDate: new Date('2026-09-28T10:00:00Z') },
    ];
    const r = await servicio(filas, VEINTIOCHO_SEP).generateCommissionsForPayment({
      tenantId: 't-wok',
      paymentAmountUsd: 50,
      hotmartTransactionId: 'HP1073184282',
    });
    expect(r.generated).toBe(0);
    expect(filas).toHaveLength(1);
  });

  it('el mismo aviso dos veces no crea dos comisiones', async () => {
    const filas = [comisionDel1()];
    const svc = servicio(filas, VEINTIOCHO_SEP);
    const args = { tenantId: 't-wok', paymentAmountUsd: 50, hotmartTransactionId: 'HP1073184282' };
    await svc.generateCommissionsForPayment(args);
    const r = await svc.generateCommissionsForPayment(args);
    expect(r.generated).toBe(0);
    expect(filas).toHaveLength(2);
  });
});

describe('la clave del periodo', () => {
  it('es el mes si el mes está libre o lo ocupa el mismo cobro', () => {
    expect(claveDelPeriodo(VEINTIOCHO_SEP, [])).toBe('2026-09');
    expect(
      claveDelPeriodo(VEINTIOCHO_SEP, [{ businessDate: new Date('2026-09-28T09:00:00Z'), createdAt: UNO_SEP }]),
    ).toBe('2026-09');
  });

  it('es el día si el mes lo ocupa OTRO cobro', () => {
    expect(claveDelPeriodo(VEINTIOCHO_SEP, [{ businessDate: UNO_SEP, createdAt: UNO_SEP }])).toBe('2026-09-28');
  });

  it('sin fecha de negocio, la de creación decide', () => {
    expect(claveDelPeriodo(VEINTIOCHO_SEP, [{ businessDate: null, createdAt: UNO_SEP }])).toBe('2026-09-28');
  });

  it('«mismo cobro» es ±3 días, no el mismo mes', () => {
    expect(esElMismoCobro(UNO_SEP, new Date('2026-09-03T23:00:00Z'))).toBe(true);
    expect(esElMismoCobro(UNO_SEP, VEINTIOCHO_SEP)).toBe(false);
  });
});
