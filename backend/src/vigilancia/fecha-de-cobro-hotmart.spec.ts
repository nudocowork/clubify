import { describe, it, expect, vi } from 'vitest';
import { VigilanteService } from './vigilante.service';

/**
 * «Fecha de cobro distinta de Hotmart» — Habibi Bar Cantina (2026-10-02).
 *
 * Pasó del mensual al anual por fuera de Hotmart y el mensual se canceló. Su
 * renovación correcta es el 16-sep-2027, pero la revisión diaria la comparaba
 * con el «próximo cobro» del mensual cancelado (17-oct) y avisaba de una fecha
 * equivocada que era la buena.
 */

const DIA = 86_400_000;

function vigilante(opts: {
  ourDate: Date;
  hotmartNext: Date;
  cobroEl: Date;
  canceladaEl?: Date;
}) {
  const svc = Object.create(VigilanteService.prototype) as any;
  svc.prisma = {
    tenant: {
      findMany: vi.fn(async () => [{ id: 't1', name: 'Habibi Bar Cantina', currentPeriodEnd: opts.ourDate }]),
    },
    hotmartWebhookEvent: {
      findMany: vi.fn(async ({ where }: any) => {
        if (where.eventType === 'SUBSCRIPTION_CANCELLATION') {
          return opts.canceladaEl ? [{ tenantId: 't1', processedAt: opts.canceladaEl }] : [];
        }
        return [
          {
            tenantId: 't1',
            processedAt: opts.cobroEl,
            payload: { data: { purchase: { date_next_charge: opts.hotmartNext.getTime() } } },
          },
        ];
      }),
    },
  };
  return svc;
}

describe('fecha de cobro contra Hotmart', () => {
  const base = {
    ourDate: new Date('2027-09-16T12:00:00Z'),
    hotmartNext: new Date('2026-10-17T12:00:00Z'),
    cobroEl: new Date('2026-09-17T02:30:00Z'),
  };

  it('suscripción cancelada después de su último cobro: no se compara', async () => {
    const r = await vigilante({ ...base, canceladaEl: new Date('2026-09-28T20:35:00Z') }).fechasQueNoCuadranConHotmart();
    expect(r).toBeNull();
  });

  it('suscripción viva con fecha distinta: sí avisa', async () => {
    const r = await vigilante(base).fechasQueNoCuadranConHotmart();
    expect(r?.cuantos).toBe(1);
  });

  it('una cancelación ANTERIOR al último cobro no la silencia (se reactivó y cobró)', async () => {
    const r = await vigilante({ ...base, canceladaEl: new Date(base.cobroEl.getTime() - 5 * DIA) }).fechasQueNoCuadranConHotmart();
    expect(r?.cuantos).toBe(1);
  });
});
