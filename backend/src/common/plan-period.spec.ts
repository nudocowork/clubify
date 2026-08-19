import { describe, it, expect } from 'vitest';
import { parsePlanPeriodLabel, normalizePlanPeriod, addPlanPeriod } from './plan-period';

describe('parsePlanPeriodLabel', () => {
  it('lee los nombres de plan reales de Hotmart', () => {
    expect(parsePlanPeriodLabel('Plan Trimestral 150 USD')).toBe('TRIMESTRAL');
    expect(parsePlanPeriodLabel('Plan Mensual 68 USD')).toBe('MENSUAL');
    expect(parsePlanPeriodLabel('Plan Semestral 278 USD')).toBe('SEMESTRAL');
    expect(parsePlanPeriodLabel('Plan Anual 500 USD')).toBe('ANUAL');
  });

  it('no confunde SEMIANUAL con ANUAL (una contiene a la otra)', () => {
    expect(parsePlanPeriodLabel('Plan Semianual')).toBe('SEMESTRAL');
    expect(parsePlanPeriodLabel('Semiannual plan')).toBe('SEMESTRAL');
  });

  it('devuelve null cuando no reconoce — NO asume MENSUAL', () => {
    // Es la diferencia clave con normalizePlanPeriod: acá "no sé" tiene que
    // significar "no toques", sino volvemos al bug de El Arrayán express.
    expect(parsePlanPeriodLabel('CLUBIFY - TARJETAS DE FIDELIZACION')).toBeNull();
    expect(parsePlanPeriodLabel('')).toBeNull();
    expect(parsePlanPeriodLabel(null)).toBeNull();
    expect(parsePlanPeriodLabel(undefined)).toBeNull();
    // Y el contraste con la convención global:
    expect(normalizePlanPeriod(null)).toBe('MENSUAL');
  });

  it('es indiferente a mayúsculas y acentos del entorno', () => {
    expect(parsePlanPeriodLabel('plan trimestral')).toBe('TRIMESTRAL');
    expect(parsePlanPeriodLabel('PLAN TRIMESTRAL')).toBe('TRIMESTRAL');
  });
});

describe('addPlanPeriod', () => {
  it('suma meses reales, no 30 días fijos', () => {
    const desde = new Date('2026-08-18T16:00:00.000Z');
    expect(addPlanPeriod(desde, 'TRIMESTRAL').toISOString()).toBe(
      '2026-11-18T16:00:00.000Z',
    );
    expect(addPlanPeriod(desde, 'MENSUAL').toISOString()).toBe(
      '2026-09-18T16:00:00.000Z',
    );
  });

  it('trata null como MENSUAL — el caso que causó la suspensión indebida', () => {
    const desde = new Date('2026-08-18T16:00:00.000Z');
    expect(addPlanPeriod(desde, null).toISOString()).toBe(
      addPlanPeriod(desde, 'MENSUAL').toISOString(),
    );
  });
});
