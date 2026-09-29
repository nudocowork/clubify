import { describe, it, expect, vi } from 'vitest';
import { BillingService } from './billing.service';
import { quienRecibeMensajesDeCobro } from './quien-recibe-cobros';

/**
 * NINGÚN MENSAJE DEL CICLO DE COBRO A UN NEGOCIO QUE NO PAGA.
 *
 * El caso real (Humberto vía Javier, 2026-09-29): Corks Arts, un InfoLink de
 * Sellea —GRATIS para el negocio, lo paga su marca con créditos—, recibió
 * «verifica que tu tarjeta tenga fondos» por SMS y correo (MessageLog, 24 y
 * 28 de septiembre). Entraba al ciclo por la rama de marcas Stripe (PDF 1256
 * §4), que no distinguía tipo de negocio.
 *
 * Estas pruebas ejercitan las CINCO selecciones del cron (D-7, D-3, D-1, día
 * del cobro y mora) contra un prisma falso y exigen que cada una lleve la
 * regla única — si alguien escribe una a mano y se olvida del filtro, esto
 * se pone rojo.
 */

function exigeExclusionDeInfolinks(where: any, via: string) {
  expect(
    where.businessType,
    `${via}: falta la exclusión de INFOLINK`,
  ).toEqual({ not: 'INFOLINK' });
  // Y PDF 1256 §4 sigue en pie: las marcas Stripe reciben sus recordatorios.
  expect(JSON.stringify(where), `${via}: se cayó la rama de marcas Stripe`).toContain(
    '"paymentGateway":"STRIPE"',
  );
}

function makeService() {
  const wheres: Array<{ via: string; where: any }> = [];
  let via = '';
  const prisma = {
    tenant: {
      findMany: vi.fn(async (args: any) => {
        wheres.push({ via, where: args?.where ?? {} });
        return [];
      }),
    },
    setting: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async () => ({})),
    },
  };
  const svc = new BillingService(
    prisma as any,
    {} as any, // growBusiness
    {} as any, // smsTemplates
    {} as any, // brandEmail
    {} as any, // audit
    {} as any, // prereg
  );
  return { svc: svc as any, wheres, setVia: (v: string) => (via = v) };
}

describe('quién recibe mensajes del ciclo de cobro', () => {
  it('la regla única excluye INFOLINK y conserva a los cancelados fuera', () => {
    const r = quienRecibeMensajesDeCobro();
    expect(r.businessType).toEqual({ not: 'INFOLINK' });
    expect(r.canceledAt).toBeNull();
    expect(r.isCampaignHost).toBe(false);
  });

  it('las CINCO vías del cron seleccionan con la regla única', async () => {
    const { svc, wheres, setVia } = makeService();
    const now = new Date('2026-09-29T14:00:00Z');

    setVia('D-7');
    await svc.sendPreChargeReminder7d(now);
    setVia('D-3');
    await svc.sendPreChargeReminder3d(now);
    setVia('D-1');
    await svc.sendPaymentReminders(now);
    setVia('día del cobro');
    await svc.sendPreChargeReminderToday(now);
    setVia('mora');
    await svc.processOverdueAccounts(now);

    expect(wheres.length).toBeGreaterThanOrEqual(5);
    for (const { via, where } of wheres) {
      exigeExclusionDeInfolinks(where, via);
    }
  });

  it('la mora conserva su propio OR (fallo de cobro o fecha vencida) junto a la regla', async () => {
    const { svc, wheres, setVia } = makeService();
    setVia('mora');
    await svc.processOverdueAccounts(new Date('2026-09-29T14:00:00Z'));
    const s = JSON.stringify(wheres[0].where);
    expect(s).toContain('"failedPaymentCount":{"gt":0}');
    expect(s).toContain('INFOLINK');
  });
});
