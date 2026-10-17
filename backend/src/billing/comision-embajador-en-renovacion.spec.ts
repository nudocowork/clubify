import { describe, it, expect, vi } from 'vitest';
import { HotmartService } from './hotmart.service';

/**
 * MOTILART (2026-10-16): vendió el embajador Santiago, que cuelga del
 * influencer Juan Camilo. En la renovación del 22-sep salió UNA comisión, el
 * 25 % de $50 para Juan, y nada para Santiago.
 *
 * Causa: el webhook cuelga la indirecta de Juan de un «parent-use» suyo creado
 * en el primer cobro; desde entonces era el registro MÁS RECIENTE del negocio y
 * el webhook elegía por fecha. Estas pruebas pasan los registros tal y como
 * quedan en la base después del primer cobro.
 */

const JUAN = { id: 'juan', code: 'XYAQE6XH', role: 'INFLUENCER', commissionPercent: 25, fixedCommissionUsd: null, parentCode: null };
const SANTIAGO = { id: 'santiago', code: 'N3CKQGBD', role: 'AMBASSADOR', commissionPercent: 20, fixedCommissionUsd: null, parentCode: JUAN };

function servicio(opts: {
  usos: any[];
  comisiones?: any[];
  excepciones?: Record<string, number>;
}) {
  const svc = Object.create(HotmartService.prototype) as any;
  svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const comisiones = opts.comisiones ?? [];
  svc.prisma = {
    tenant: {
      findUnique: vi.fn(async () => ({
        lastChargeAt: new Date('2026-09-22T15:00:00.000Z'),
        subscriptionPriceUsd: 50,
        planPeriodicity: 'MENSUAL',
        whiteLabelId: null,
      })),
    },
    setting: { findUnique: vi.fn(async () => null) },
    referralUse: {
      findMany: vi.fn(async () => opts.usos),
      // Si alguien vuelve al upsert con id centinela, que se note: crea.
      upsert: vi.fn(async ({ create }: any) => ({ id: 'parent-use-duplicado', ...create })),
      findFirst: vi.fn(async ({ where }: any) =>
        opts.usos.find((u) => u.referralCodeId === where.referralCodeId) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => ({ id: `nuevo-${data.referralCodeId}`, ...data })),
      update: vi.fn(async () => ({})),
    },
    commission: {
      findFirst: vi.fn(async ({ where }: any) =>
        comisiones.find((c) => c.externalTxId === where.externalTxId) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => data),
    },
  };
  svc.referralsService = {
    slugForWhiteLabelId: vi.fn(async () => 'clubify'),
    getBrandCommissionMode: vi.fn(async () => 'PERCENT_RECURRING'),
    // Sin reglas de colaborador: el reparto de siempre.
    ventaParaReglas: vi.fn(async () => null),
    ajustesDeReglas: vi.fn(async () => ({ pct: {}, fijos: {}, reglas: {} })),
  };
  svc.commissionExceptions = {
    resolvePercent: vi.fn(
      async (_t: string, codeId: string, fallback: number) => opts.excepciones?.[codeId] ?? fallback,
    ),
  };
  svc.getCanonicalBundlePrice = vi.fn(async () => 50);
  svc.generateSocioCommission = vi.fn(async () => undefined);
  return svc;
}

const creadas = (svc: any) =>
  svc.prisma.commission.create.mock.calls.map((c: any) => ({
    a: c[0].data.recipientCodeId,
    monto: c[0].data.amount,
    uso: c[0].data.referralUseId,
  }));

// Como quedan tras el primer cobro: el de Juan (parent-use) es posterior.
const USOS_MOTILART = [
  { id: 'use-juan', referralCodeId: 'juan', status: 'PAYING', createdAt: new Date('2026-07-22'), referralCode: JUAN, commissions: [] },
  { id: 'use-santiago', referralCodeId: 'santiago', status: 'PAYING', createdAt: new Date('2026-06-20'), referralCode: SANTIAGO, commissions: [] },
];

describe('webhook · renovación de un negocio vendido por un embajador', () => {
  it('MOTILART: directa a Santiago (su %) + indirecta 5 % a Juan, nunca el 25 % de Juan', async () => {
    const svc = servicio({ usos: USOS_MOTILART });

    await svc.generateReferralCommission({ tenantId: 'motilart', paidAmount: null, transactionId: 'HP-0922' });

    expect(creadas(svc)).toEqual([
      { a: 'santiago', monto: 10, uso: 'use-santiago' },
      // La indirecta sigue colgando del parent-use de Juan, como siempre: así
      // la UNIQUE por ciclo y el dedup cross-use existentes la siguen viendo.
      { a: 'juan', monto: 2.5, uso: 'use-juan' },
    ]);
  });

  it('el orden en que la base devuelve los registros no cambia el resultado', async () => {
    const svc = servicio({ usos: [...USOS_MOTILART].reverse() });
    await svc.generateReferralCommission({ tenantId: 'motilart', paidAmount: null, transactionId: 'HP-0922' });
    expect(creadas(svc).map((c: any) => `${c.a}:${c.monto}`)).toEqual(['santiago:10', 'juan:2.5']);
  });

  it('la excepción por negocio sigue ganando (también la del influencer indirecto)', async () => {
    const svc = servicio({ usos: USOS_MOTILART, excepciones: { santiago: 15, juan: 3 } });
    await svc.generateReferralCommission({ tenantId: 'motilart', paidAmount: null, transactionId: 'HP-1' });
    expect(creadas(svc).map((c: any) => `${c.a}:${c.monto}`)).toEqual(['santiago:7.5', 'juan:1.5']);
  });

  it('un cobro ya devengado con la elección vieja (25 % a Juan) y re-entregado NO se vuelve a pagar', async () => {
    const svc = servicio({
      usos: USOS_MOTILART,
      comisiones: [{ externalTxId: 'HP-0922', recipientCodeId: 'juan', referralUseId: 'use-juan' }],
    });
    await svc.generateReferralCommission({ tenantId: 'motilart', paidAmount: null, transactionId: 'HP-0922' });
    expect(svc.prisma.commission.create).not.toHaveBeenCalled();
  });

  it('la indirecta reutiliza el parent-use que ya existe: no crea uno nuevo por cobro', async () => {
    const svc = servicio({ usos: USOS_MOTILART });
    await svc.generateReferralCommission({ tenantId: 'motilart', paidAmount: null, transactionId: 'HP-5' });
    expect(svc.prisma.referralUse.create).not.toHaveBeenCalled();
    expect(svc.prisma.referralUse.upsert).not.toHaveBeenCalled();
  });

  it('primer cobro sin parent-use: lo crea UNA vez y cuelga de él la indirecta', async () => {
    const svc = servicio({ usos: [USOS_MOTILART[1]] });
    await svc.generateReferralCommission({ tenantId: 'motilart', paidAmount: null, transactionId: 'HP-6' });
    expect(svc.prisma.referralUse.create).toHaveBeenCalledTimes(1);
    expect(creadas(svc)).toEqual([
      { a: 'santiago', monto: 10, uso: 'use-santiago' },
      { a: 'juan', monto: 2.5, uso: 'nuevo-juan' },
    ]);
  });

  it('influencer que vendió él solo: su % completo, sin indirecta', async () => {
    const svc = servicio({
      usos: [{ id: 'use-juan', referralCodeId: 'juan', status: 'PAYING', createdAt: new Date(), referralCode: JUAN, commissions: [] }],
    });
    await svc.generateReferralCommission({ tenantId: 'x', paidAmount: null, transactionId: 'HP-2' });
    expect(creadas(svc)).toEqual([{ a: 'juan', monto: 12.5, uso: 'use-juan' }]);
  });
});

describe('webhook · ¿hay vendedor? lo decide la misma cadena que reparte', () => {
  it('un vendedor con registro SIGNED_UP (primer cobro) va al reparto del vendedor, no al legacy', async () => {
    const svc = Object.create(HotmartService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.prisma = { tenant: { findUnique: vi.fn(async () => ({ whiteLabelId: null })) } };
    svc.referralsService = {
      getAttributionChain: vi.fn(async () => ({
        influencer: null,
        embajador: { id: 'nicolas', commissionPercent: 10, maxCommissionPercent: 25 },
        vendor: { id: 'gabriel', commissionPercent: 5 },
        sourceCodeId: 'gabriel',
      })),
      getBrandCommissionModeByWhiteLabelId: vi.fn(async () => 'PERCENT_RECURRING'),
      generateCommissionsForPayment: vi.fn(async () => ({ generated: 2, skipped: 0 })),
    };
    svc.generateReferralCommission = vi.fn();

    await svc.generarComisionesDeCobro({ tenantId: 'alquimia', transaccionId: 'HP-3' });

    expect(svc.referralsService.generateCommissionsForPayment).toHaveBeenCalledTimes(1);
    expect(svc.generateReferralCommission).not.toHaveBeenCalled();
  });

  it('sin vendedor en la cadena → flujo de embajador/influencer', async () => {
    const svc = Object.create(HotmartService.prototype) as any;
    svc.logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    svc.referralsService = {
      getAttributionChain: vi.fn(async () => ({
        influencer: { id: 'juan', commissionPercent: 25 },
        embajador: { id: 'santiago', commissionPercent: 20, maxCommissionPercent: 25 },
        vendor: null,
        sourceCodeId: 'santiago',
      })),
      generateCommissionsForPayment: vi.fn(),
    };
    svc.generateReferralCommission = vi.fn(async () => undefined);

    await svc.generarComisionesDeCobro({ tenantId: 'motilart', transaccionId: 'HP-4' });

    expect(svc.generateReferralCommission).toHaveBeenCalledTimes(1);
    expect(svc.referralsService.generateCommissionsForPayment).not.toHaveBeenCalled();
  });
});
