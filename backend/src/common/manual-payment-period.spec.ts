import { describe, it, expect } from 'vitest';
import { resolveManualPaymentPeriod } from './manual-payment-period';

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dia = (x: Date) => x.toISOString().slice(0, 10);

describe('resolveManualPaymentPeriod', () => {
  // El caso real que destapó el bug (2026-08-21): un negocio pagó su plan
  // trimestral el 4 de julio y el sistema le devolvió 21-nov → 21-feb, porque
  // calculaba desde `now` y encadenaba con la fecha vieja, ignorando por
  // completo la fecha que había escrito el usuario.
  it('el ciclo arranca en la FECHA DE PAGO, no en hoy', () => {
    const r = resolveManualPaymentPeriod(d('2026-07-04'), d('2026-11-21'), 'TRIMESTRAL');
    expect(dia(r.periodStart)).toBe('2026-07-04');
    expect(dia(r.periodEnd)).toBe('2026-10-04');
  });

  it('no encadena desde la cobertura vigente: la fecha escrita manda', () => {
    const r = resolveManualPaymentPeriod(d('2026-07-04'), d('2027-01-01'), 'MENSUAL');
    expect(dia(r.periodEnd)).toBe('2026-08-04');
  });

  it('cada periodicidad corre sus meses reales', () => {
    const p = d('2026-03-10');
    expect(dia(resolveManualPaymentPeriod(p, null, 'MENSUAL').periodEnd)).toBe('2026-04-10');
    expect(dia(resolveManualPaymentPeriod(p, null, 'TRIMESTRAL').periodEnd)).toBe('2026-06-10');
    expect(dia(resolveManualPaymentPeriod(p, null, 'SEMESTRAL').periodEnd)).toBe('2026-09-10');
    expect(dia(resolveManualPaymentPeriod(p, null, 'ANUAL').periodEnd)).toBe('2027-03-10');
  });

  it('sin periodicidad cae a mensual', () => {
    expect(dia(resolveManualPaymentPeriod(d('2026-05-20'), null, null).periodEnd)).toBe(
      '2026-06-20',
    );
  });

  it('acota el fin de mes en vez de desbordar (31-ene + 1 mes = 28-feb)', () => {
    expect(dia(resolveManualPaymentPeriod(d('2026-01-31'), null, 'MENSUAL').periodEnd)).toBe(
      '2026-02-28',
    );
  });

  it('avisa cuando el pago ACORTA la cobertura que ya tenía', () => {
    // No lo bloquea: solo lo marca para que el panel lo advierta y decida un
    // humano. Decidir por él fue justo lo que produjo el bug original.
    const r = resolveManualPaymentPeriod(d('2026-07-04'), d('2026-11-21'), 'TRIMESTRAL');
    expect(r.acorta).toBe(true);
  });

  it('no avisa cuando el pago extiende la cobertura', () => {
    const r = resolveManualPaymentPeriod(d('2026-07-04'), d('2026-08-01'), 'TRIMESTRAL');
    expect(r.acorta).toBe(false);
  });

  it('sin cobertura previa nunca avisa de acortamiento', () => {
    expect(resolveManualPaymentPeriod(d('2026-07-04'), null, 'ANUAL').acorta).toBe(false);
  });

  it('devuelve la periodicidad normalizada', () => {
    expect(resolveManualPaymentPeriod(d('2026-07-04'), null, 'trimestral').periodicity).toBe(
      'TRIMESTRAL',
    );
  });
});
