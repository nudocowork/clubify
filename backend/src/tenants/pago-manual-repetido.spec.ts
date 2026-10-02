import { describe, it, expect, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { TenantsService } from './tenants.service';

/**
 * Oh! Cookies (2026-09-15 y 16): su trimestre pagado el 2-sep se registró DOS
 * veces como pago manual, y Contabilidad contó $300 por un cobro de $150. El
 * segundo registro del mismo ciclo ahora se rechaza antes de tocar nada.
 */

const NEGOCIO = {
  id: 't-cookies',
  brandName: 'Oh! Cookies',
  status: 'ACTIVE',
  planPeriodicity: 'TRIMESTRAL',
  currentPeriodEnd: new Date('2026-09-02T12:00:00Z'),
  whiteLabelId: null,
  manualPayment: true,
};

function servicio(pagosPrevios: Array<{ periodStart: Date; paidAt: Date; amount: number; currency: string }>) {
  const svc = Object.create(TenantsService.prototype) as any;
  const creados: any[] = [];
  svc.prisma = {
    tenant: {
      findFirst: vi.fn(async () => NEGOCIO),
      update: vi.fn(async () => NEGOCIO),
    },
    manualPayment: {
      findFirst: vi.fn(async ({ where }: any) =>
        pagosPrevios.find(
          (p) => p.periodStart >= where.periodStart.gte && p.periodStart <= where.periodStart.lte,
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        creados.push(data);
        return { id: 'nuevo', ...data };
      }),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
  svc.chargeBrandCreditForActivation = vi.fn(async () => ({
    rollback: vi.fn(),
    commit: vi.fn(),
  }));
  svc.incomeRecord = { record: vi.fn(async () => null) };
  svc.audit = { log: vi.fn() };
  svc.onboardingWebhook = { emitBusinessActivated: vi.fn() };
  svc.referrals = { backfillCommissionForCurrentAssignment: vi.fn(async () => null) };
  return { svc: svc as TenantsService, creados };
}

const PAGO = { method: 'NEQUI', amount: 150, currency: 'USD', paidAt: '2026-09-02T12:00:00.000Z' } as any;

describe('el mismo pago manual dos veces', () => {
  it('el segundo registro del mismo ciclo se rechaza y no crea nada', async () => {
    const { svc, creados } = servicio([
      {
        periodStart: new Date('2026-09-02T12:00:00Z'),
        paidAt: new Date('2026-09-02T12:00:00Z'),
        amount: 150,
        currency: 'USD',
      },
    ]);
    await expect(svc.registerManualPayment('t-cookies', PAGO, 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(creados).toHaveLength(0);
  });

  it('un pago de OTRO ciclo sí se registra', async () => {
    const { svc, creados } = servicio([
      {
        periodStart: new Date('2026-06-02T12:00:00Z'),
        paidAt: new Date('2026-06-02T12:00:00Z'),
        amount: 150,
        currency: 'USD',
      },
    ]);
    await svc.registerManualPayment('t-cookies', PAGO, 'admin');
    expect(creados).toHaveLength(1);
  });
});
