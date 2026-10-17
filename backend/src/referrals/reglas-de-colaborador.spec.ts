/**
 * Reglas por colaborador dentro del motor del vendedor (2026-10-17).
 *
 * Lo que se prueba es el CABLEADO: que `computeExpectedCommissionRows` lea la
 * regla de la venta concreta (nueva o renovación), que la excepción por cliente
 * siga ganando, que el arqueo (sin venta) no la aplique, y que la comisión
 * nazca marcada con su regla para que nadie la recalcule.
 */
import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';
import { ReglasDeComisionService } from './reglas-de-comision.service';

const CADENA = {
  influencer: null,
  embajador: { id: 'emb', commissionPercent: 25, maxCommissionPercent: 25 },
  vendor: { id: 'closer', commissionPercent: 10 },
  sourceCodeId: 'closer',
};

function reglasFalsas(opts: { reglas: any[]; excepciones?: string[]; renovacion?: boolean }) {
  const prisma = {
    reglaComisionColaborador: { findMany: vi.fn(async () => opts.reglas) },
    commissionException: {
      findMany: vi.fn(async () => (opts.excepciones ?? []).map((id) => ({ recipientCodeId: id }))),
    },
    incomeRecord: {
      findFirst: vi.fn(async ({ where }: any) =>
        where.externalTxId ? { category: opts.renovacion ? 'RENOVACION' : 'NUEVA' } : null,
      ),
    },
    commission: { findFirst: vi.fn(async () => null) },
  };
  return new ReglasDeComisionService(prisma as any);
}

function servicio(reglas: ReglasDeComisionService | undefined, excepciones: Record<string, number> = {}) {
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  svc.reglas = reglas;
  svc.getAttributionChain = vi.fn(async () => ({ ...CADENA }));
  svc.slugForWhiteLabelId = vi.fn(async () => 'clubify');
  svc.getBrandCommissionMode = vi.fn(async () => 'PERCENT_RECURRING');
  svc.commissionExceptions = {
    resolvePercent: vi.fn(async (_t: string, id: string, fallback: number) => excepciones[id] ?? fallback),
  };
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        commissionDistributionMode: 'DISCOUNT_FROM_INFLUENCER',
        whiteLabelId: null,
        planPeriodicity: 'MENSUAL',
        planId: null,
      })),
    },
  };
  return svc;
}

const reglaRenovacionFija = {
  id: 'r-renov',
  codeId: 'closer',
  prioridad: 0,
  tipo: 'FIJO',
  valor: 4,
  aplicaA: 'RENOVACIONES',
  periodicidades: [],
  planIds: [],
  vigenteDesde: null,
  vigenteHasta: null,
  activo: true,
  createdAt: new Date('2026-10-01'),
};

describe('reglas de colaborador en el motor', () => {
  it('renovación con regla fija de $4: el closer cobra 4 y el embajador 17 − 4', async () => {
    const svc = servicio(reglasFalsas({ reglas: [reglaRenovacionFija], renovacion: true }));
    const venta = await svc.ventaParaReglas('t-1', 'HP1', new Date('2026-10-20T12:00:00Z'));
    expect(venta.tipo).toBe('RENOVACION');
    const { rows } = await svc.computeExpectedCommissionRows('t-1', 68, venta);
    expect(rows.map((r: any) => [r.recipientCodeId, r.amount, r.reglaId])).toEqual([
      ['emb', 13, 'r-renov'],
      ['closer', 4, 'r-renov'],
    ]);
  });

  it('venta NUEVA: la regla de renovaciones no aplica y el reparto es el de siempre', async () => {
    const svc = servicio(reglasFalsas({ reglas: [reglaRenovacionFija], renovacion: false }));
    const venta = await svc.ventaParaReglas('t-1', 'HP1', new Date('2026-10-20T12:00:00Z'));
    const { rows } = await svc.computeExpectedCommissionRows('t-1', 68, venta);
    expect(rows.map((r: any) => [r.recipientCodeId, r.amount])).toEqual([
      ['emb', 10.2],
      ['closer', 6.8],
    ]);
    expect(rows.every((r: any) => !r.reglaId)).toBe(true);
  });

  it('la excepción por cliente gana a la regla', async () => {
    const svc = servicio(
      reglasFalsas({ reglas: [reglaRenovacionFija], renovacion: true, excepciones: ['closer'] }),
      { closer: 12 },
    );
    const venta = await svc.ventaParaReglas('t-1', 'HP1', new Date('2026-10-20T12:00:00Z'));
    const { rows } = await svc.computeExpectedCommissionRows('t-1', 100, venta);
    expect(rows.find((r: any) => r.recipientCodeId === 'closer')).toMatchObject({ amount: 12 });
    expect(rows.every((r: any) => !r.reglaId)).toBe(true);
  });

  it('el arqueo (sin venta) no aplica reglas: su esperado es el del código', async () => {
    const svc = servicio(reglasFalsas({ reglas: [reglaRenovacionFija], renovacion: true }));
    const { rows } = await svc.computeExpectedCommissionRows('t-1', 68);
    expect(rows.find((r: any) => r.recipientCodeId === 'closer')).toMatchObject({ amount: 6.8 });
  });

  it('regla de % por periodicidad: 15 % en anuales', async () => {
    const anual = { ...reglaRenovacionFija, id: 'r-anual', tipo: 'PORCENTAJE', valor: 15, aplicaA: 'AMBAS', periodicidades: ['ANUAL'] };
    const svc = servicio(reglasFalsas({ reglas: [anual] }));
    const { rows } = await svc.computeExpectedCommissionRows('t-1', 500, {
      fecha: new Date('2026-10-20'),
      tipo: 'NUEVA',
      periodicidad: 'ANUAL',
    });
    // El vendedor sigue acotado a la tajada del embajador (25 %): 15 % de 500.
    expect(rows.map((r: any) => [r.recipientCodeId, r.amount, r.appliedPercent])).toEqual([
      ['emb', 50, 10],
      ['closer', 75, 15],
    ]);
  });

  it('sin servicio de reglas (pruebas viejas, arranque parcial) todo cobra como siempre', async () => {
    const svc = servicio(undefined);
    expect(await svc.ventaParaReglas('t-1', 'HP1', new Date())).toBeNull();
    const { rows } = await svc.computeExpectedCommissionRows('t-1', 68, null);
    expect(rows.map((r: any) => r.amount)).toEqual([10.2, 6.8]);
  });
});

describe('la comisión nace marcada con su regla', () => {
  it('generateCommissionsForPayment guarda reglaColaboradorId solo si hubo regla', async () => {
    const creadas: any[] = [];
    const commission = {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => {
        creadas.push(data);
        return data;
      }),
    };
    const svc = Object.create(ReferralsService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.recalc = { getCommissionBase: vi.fn(async () => 68) };
    svc.ventaParaReglas = vi.fn(async () => ({ fecha: new Date(), tipo: 'RENOVACION' }));
    svc.computeExpectedCommissionRows = vi.fn(async () => ({
      chain: { sourceCodeId: 'closer' },
      mode: 'DISCOUNT_FROM_INFLUENCER',
      rows: [
        { recipientCodeId: 'emb', amount: 13, appliedPercent: 19.12, vendorCodeId: null, reglaId: 'r-renov' },
        { recipientCodeId: 'inf', amount: 3.4, appliedPercent: 5, vendorCodeId: null },
      ],
    }));
    svc.prisma = {
      tenant: { findUnique: vi.fn(async () => ({ subscriptionPriceUsd: null, planPeriodicity: 'MENSUAL', lastChargeAt: new Date('2026-10-20T12:00:00Z') })) },
      referralUse: { findFirst: vi.fn(async () => ({ id: 'use-1', status: 'PAYING' })) },
      commission,
      $transaction: async (fn: any) => fn({ commission }),
    };
    await svc.generateCommissionsForPayment({ tenantId: 't-1', paymentAmountUsd: 68, hotmartTransactionId: 'HP9' });
    expect(creadas[0].reglaColaboradorId).toBe('r-renov');
    expect('reglaColaboradorId' in creadas[1]).toBe(false);
    // La venta que leyó la regla es ESTE cobro (su transacción y su fecha).
    expect(svc.ventaParaReglas).toHaveBeenCalledWith('t-1', 'HP9', new Date('2026-10-20T12:00:00Z'));
  });
});
