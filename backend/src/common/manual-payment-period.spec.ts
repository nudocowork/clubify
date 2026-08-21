import { describe, it, expect } from 'vitest';
import { resolveManualPaymentPeriod } from './manual-payment-period';

// Fechas en UTC fijo para que el spec no dependa del reloj ni del huso local.
const NOW = new Date('2026-08-20T15:00:00.000Z');

describe('resolveManualPaymentPeriod', () => {
  it('ciclo vigente → encadena desde currentPeriodEnd (no le quita al cliente los días ya pagados)', () => {
    const cpe = new Date('2026-08-25T00:00:00.000Z');
    const r = resolveManualPaymentPeriod(NOW, cpe, 'MENSUAL');
    expect(r.chained).toBe(true);
    expect(r.periodStart.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    expect(r.periodEnd.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(r.periodicity).toBe('MENSUAL');
  });

  it('ciclo vencido → arranca HOY, no desde la fecha vencida (no entrega un ciclo ya consumido)', () => {
    const cpe = new Date('2026-08-10T00:00:00.000Z'); // venció hace 10 días
    const r = resolveManualPaymentPeriod(NOW, cpe, 'MENSUAL');
    expect(r.chained).toBe(false);
    expect(r.periodStart.toISOString()).toBe(NOW.toISOString());
    expect(r.periodEnd.toISOString()).toBe('2026-09-20T15:00:00.000Z');
  });

  it('sin ciclo previo (currentPeriodEnd null) → arranca HOY', () => {
    const r = resolveManualPaymentPeriod(NOW, null, 'MENSUAL');
    expect(r.chained).toBe(false);
    expect(r.periodStart.toISOString()).toBe(NOW.toISOString());
    expect(r.periodEnd.toISOString()).toBe('2026-09-20T15:00:00.000Z');
  });

  it('la periodicidad manda el largo del ciclo: 3, 6 y 12 meses reales, nunca 30 días', () => {
    const cpe = new Date('2026-09-01T00:00:00.000Z'); // vigente
    expect(
      resolveManualPaymentPeriod(NOW, cpe, 'TRIMESTRAL').periodEnd.toISOString(),
    ).toBe('2026-12-01T00:00:00.000Z');
    expect(
      resolveManualPaymentPeriod(NOW, cpe, 'SEMESTRAL').periodEnd.toISOString(),
    ).toBe('2027-03-01T00:00:00.000Z');
    expect(
      resolveManualPaymentPeriod(NOW, cpe, 'ANUAL').periodEnd.toISOString(),
    ).toBe('2027-09-01T00:00:00.000Z');
  });

  it('anual vencido: el ciclo nuevo son 12 meses desde hoy — el bug de "30 días fijos" costaría 11 meses', () => {
    const cpe = new Date('2026-08-01T00:00:00.000Z');
    const r = resolveManualPaymentPeriod(NOW, cpe, 'ANUAL');
    expect(r.periodEnd.toISOString()).toBe('2027-08-20T15:00:00.000Z');
  });

  it('periodicidad null/desconocida → MENSUAL (convención global de plan-period)', () => {
    const r = resolveManualPaymentPeriod(NOW, null, null);
    expect(r.periodicity).toBe('MENSUAL');
    expect(r.periodEnd.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    const r2 = resolveManualPaymentPeriod(NOW, null, 'SEMANAL');
    expect(r2.periodicity).toBe('MENSUAL');
  });

  it('fin de mes: encadenar desde el 31 no desborda (31-ene + 1 mes = 28-feb, vía addPlanPeriod)', () => {
    const hoy = new Date('2027-01-15T12:00:00.000Z');
    const cpe = new Date('2027-01-31T12:00:00.000Z'); // vigente
    const r = resolveManualPaymentPeriod(hoy, cpe, 'MENSUAL');
    expect(r.periodEnd.toISOString()).toBe('2027-02-28T12:00:00.000Z');
  });

  it('no muta las fechas de entrada', () => {
    const cpe = new Date('2026-08-25T00:00:00.000Z');
    const nowCopy = new Date(NOW);
    resolveManualPaymentPeriod(nowCopy, cpe, 'ANUAL');
    expect(cpe.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    expect(nowCopy.toISOString()).toBe(NOW.toISOString());
  });
});
