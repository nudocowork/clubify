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

describe('addPlanPeriod — fin de mes', () => {
  // Regresión del bug medido el 2026-08-20: `setMonth` a secas desbordaba al
  // mes siguiente cuando el día no existía en el destino (31-ene + 1 mes daba
  // 3-mar, saltándose febrero entero). Eso corría la fecha de cobro y hacía
  // que los recordatorios apuntaran a un día que no era.
  const dia = (iso: string, p: string) =>
    addPlanPeriod(new Date(`${iso}T12:00:00Z`), p).toISOString().slice(0, 10);

  it('acota al último día del mes destino en vez de desbordar', () => {
    expect(dia('2026-01-31', 'MENSUAL')).toBe('2026-02-28');
    expect(dia('2026-03-31', 'MENSUAL')).toBe('2026-04-30');
    expect(dia('2026-08-31', 'SEMESTRAL')).toBe('2027-02-28');
  });

  it('respeta el 29 de febrero de un año bisiesto', () => {
    expect(dia('2028-02-29', 'ANUAL')).toBe('2029-02-28');
  });

  it('no toca las fechas que sí existen en el mes destino', () => {
    expect(dia('2026-01-15', 'MENSUAL')).toBe('2026-02-15');
    expect(dia('2026-05-31', 'TRIMESTRAL')).toBe('2026-08-31');
  });
});
