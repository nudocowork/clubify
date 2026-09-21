import { describe, it, expect, vi } from 'vitest';
import { ReferralsService } from './referrals.service';
import { CommissionRecalcService } from './commission-recalc.service';

/**
 * Una comisión ya generada NO se reescribe con el precio de HOY.
 *
 * EL CASO (Javier, 2026-09-21): «si el cliente compra un plan mensual, se genera
 * la comisión en base a ese plan, y si hace upgrade, en base al monto del
 * upgrade». Eso es lo que pasa al GENERARLAS. El problema estaba después:
 *
 *   1. Wok Explosivo paga su trimestre de $150 → comisión de $15, pendiente.
 *   2. Se le hace upgrade a anual: el negocio pasa a valer $500.
 *   3. Semanas más tarde alguien cambia el % del afiliado, o edita una
 *      excepción, o toca el negocio → los dos recálculos rehacían TODAS las
 *      pendientes con el precio de HOY: la de $15 se convertía en $50, por un
 *      cobro trimestral que nunca fue de $500.
 *
 * Ahora cada comisión se rehace sobre el monto con el que NACIÓ
 * (`baseAmountUsd`), y solo cae al precio del negocio si no lo tiene guardado
 * —que en producción era el caso de 16 de los 29 negocios con comisión viva—.
 */

const TRIMESTRE = 150;
const ANUAL_HOY = 500;

function servicio(comisiones: any[]) {
  const actualizadas: Record<string, number> = {};
  const prisma: any = {
    tenant: {
      findUnique: async () => ({ subscriptionPriceUsd: null, planPeriodicity: 'ANUAL' }),
    },
    commission: {
      findMany: async () => comisiones,
      update: async ({ where, data }: any) => {
        actualizadas[where.id] = Number(data.amount);
        return {};
      },
    },
  };
  const svc = Object.create(ReferralsService.prototype) as any;
  svc.prisma = prisma;
  svc.logger = { log: vi.fn(), warn: vi.fn() };
  svc.audit = { log: vi.fn(async () => undefined) };
  // El negocio, hoy, vale el anual.
  svc.recalc = { getCommissionBase: vi.fn(async () => ANUAL_HOY) };
  // El reparto real se prueba en sus propios specs; aquí lo que importa es
  // sobre QUÉ base se pide el esperado.
  svc.computeExpectedCommissionRows = vi.fn(async (_t: string, base: number) => ({
    mode: 'DISCOUNT',
    rows: [{ recipientCodeId: 'afiliado', amount: Math.round(base * 10) / 100, appliedPercent: 10 }],
  }));
  return { svc, actualizadas };
}

describe('recalcular no reescribe la historia', () => {
  it('la comisión del trimestre se rehace sobre los $150 del trimestre, no sobre el anual de hoy', async () => {
    const { svc, actualizadas } = servicio([
      { id: 'c-trimestre', amount: 15, baseAmountUsd: TRIMESTRE, recipientCodeId: 'afiliado', referralUse: { referralCodeId: 'afiliado' } },
    ]);

    await svc.recalcTenantSplit('wok', null, 'cambio de %');

    // 10 % de 150 = 15 → no cambia. Con el precio de hoy habría salido 50.
    expect(actualizadas['c-trimestre']).toBeUndefined();
    expect(svc.computeExpectedCommissionRows).toHaveBeenCalledWith('wok', TRIMESTRE);
  });

  it('una comisión SIN monto guardado sigue usando el precio del negocio', async () => {
    // No se puede saber de qué cobro salió: es lo único que hay. 16 de los 29
    // negocios con comisión viva estaban así.
    const { svc, actualizadas } = servicio([
      { id: 'c-vieja', amount: 15, baseAmountUsd: null, recipientCodeId: 'afiliado', referralUse: { referralCodeId: 'afiliado' } },
    ]);

    await svc.recalcTenantSplit('wok', null, 'cambio de %');

    expect(actualizadas['c-vieja']).toBe(50);
  });

  it('cada comisión va con la suya: el trimestre y el upgrade no se mezclan', async () => {
    const { svc, actualizadas } = servicio([
      { id: 'c-trimestre', amount: 99, baseAmountUsd: TRIMESTRE, recipientCodeId: 'afiliado', referralUse: { referralCodeId: 'afiliado' } },
      { id: 'c-upgrade', amount: 99, baseAmountUsd: 350, recipientCodeId: 'afiliado', referralUse: { referralCodeId: 'afiliado' } },
    ]);

    await svc.recalcTenantSplit('wok', null, 'cambio de %');

    expect(actualizadas['c-trimestre']).toBe(15); // 10 % de 150
    expect(actualizadas['c-upgrade']).toBe(35); // 10 % de 350
  });
});

describe('el recálculo por afiliado tampoco reescribe la historia', () => {
  function recalc(comisiones: any[]) {
    const actualizadas: Record<string, number> = {};
    const prisma: any = {
      commission: {
        findMany: async () => comisiones,
        count: async () => 0,
        update: async ({ where, data }: any) => {
          actualizadas[where.id] = Number(data.amount);
          return {};
        },
      },
      referralCode: { findUnique: async () => ({ commissionPercent: 10 }) },
    };
    const svc = Object.create(CommissionRecalcService.prototype) as any;
    svc.prisma = prisma;
    svc.logger = { log: vi.fn(), warn: vi.fn() };
    svc.audit = { log: vi.fn(async () => undefined) };
    svc.getCommissionBase = vi.fn(async () => ANUAL_HOY);
    svc.resolveEffectivePct = vi.fn(async () => 10);
    return { svc, actualizadas };
  }

  const fila = (id: string, base: number | null) => ({
    id,
    amount: 99,
    baseAmountUsd: base,
    recipientCodeId: 'afiliado',
    referralUse: {
      tenantId: 'wok',
      referralCodeId: 'afiliado',
      tenant: { planPeriodicity: 'ANUAL', subscriptionPriceUsd: null, plan: { priceMonthly: 0 } },
    },
  });

  it('usa el monto con el que nació la comisión', async () => {
    const { svc, actualizadas } = recalc([fila('c-trimestre', TRIMESTRE)]);
    await svc.recalcForRecipientCode({ recipientCodeId: 'afiliado' });
    expect(actualizadas['c-trimestre']).toBe(15);
  });

  it('sin monto guardado, el precio del negocio', async () => {
    const { svc, actualizadas } = recalc([fila('c-vieja', null)]);
    await svc.recalcForRecipientCode({ recipientCodeId: 'afiliado' });
    expect(actualizadas['c-vieja']).toBe(50);
  });
});
