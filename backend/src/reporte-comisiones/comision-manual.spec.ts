import { describe, it, expect } from 'vitest';
import { calcularComisionManual, claveValida, periodKeyManual, yaCobraEstaVenta } from './comision-manual';
import { esDeMontoLibre, NO_ES_DEL_UPGRADE, NO_ES_DE_EQUIPO } from '../referrals/comisiones-de-monto-libre';

describe('cálculo de la comisión manual', () => {
  it('porcentaje sobre la base, redondeado al centavo', () => {
    expect(calcularComisionManual({ baseUsd: 68, porcentaje: 15 })).toEqual({
      ok: true,
      montoUsd: 10.2,
      porcentaje: 15,
      baseUsd: 68,
    });
    expect(calcularComisionManual({ baseUsd: 33.33, porcentaje: 10 })).toMatchObject({ montoUsd: 3.33 });
  });

  it('monto fijo: la base es solo referencia (puede ser 0 en un bono)', () => {
    expect(calcularComisionManual({ baseUsd: 0, montoFijoUsd: 50 })).toMatchObject({ ok: true, montoUsd: 50, porcentaje: null });
  });

  it('exige uno de los dos, no ambos ni ninguno', () => {
    expect(calcularComisionManual({ baseUsd: 68 }).ok).toBe(false);
    expect(calcularComisionManual({ baseUsd: 68, porcentaje: 10, montoFijoUsd: 5 }).ok).toBe(false);
  });

  it('rechaza porcentajes y montos imposibles', () => {
    expect(calcularComisionManual({ baseUsd: 68, porcentaje: 0 }).ok).toBe(false);
    expect(calcularComisionManual({ baseUsd: 68, porcentaje: 120 }).ok).toBe(false);
    expect(calcularComisionManual({ baseUsd: -5, porcentaje: 10 }).ok).toBe(false);
    expect(calcularComisionManual({ baseUsd: 0, porcentaje: 10 }).ok).toBe(false);
    expect(calcularComisionManual({ baseUsd: 10, montoFijoUsd: -1 }).ok).toBe(false);
  });
});

describe('clave y periodKey', () => {
  it('la clave es un uuid del formulario', () => {
    expect(claveValida('6f0c2a1e-1111-4222-8333-444455556666')).toBe(true);
    expect(claveValida('x')).toBe(false);
    expect(claveValida('a b c d e f g h')).toBe(false);
  });

  it('el periodKey empieza por MANUAL- y por su mes', () => {
    expect(periodKeyManual('2026-10-05', '6f0c2a1e-1111-4222')).toBe('MANUAL-2026-10-6f0c2a1e1111');
  });

  it('el motor la trata como monto libre: el recálculo y el arqueo no la tocan', () => {
    const pk = periodKeyManual('2026-10-05', '6f0c2a1e-1111-4222');
    expect(esDeMontoLibre(pk)).toBe(true);
    expect(JSON.stringify(NO_ES_DEL_UPGRADE)).toContain('MANUAL-');
    expect(JSON.stringify(NO_ES_DE_EQUIPO)).toContain('MANUAL-');
  });
});

describe('no duplicar la comisión de una venta', () => {
  const venta = { externalTxId: 'HP1', saleDate: '2026-10-05T15:00:00Z' };
  const c = (p: Record<string, unknown>) => ({
    status: 'APPROVED',
    hotmartTransactionId: null,
    externalTxId: null,
    businessDate: null,
    createdAt: '2026-10-05T15:00:00Z',
    periodKey: '2026-10',
    ...p,
  });

  it('misma transacción → ya cobra', () => {
    expect(yaCobraEstaVenta(venta, [c({ hotmartTransactionId: 'HP1', createdAt: '2026-01-01' })])).toBe(true);
  });
  it('sin transacción, a ±3 días → ya cobra', () => {
    expect(yaCobraEstaVenta(venta, [c({ businessDate: '2026-10-07T00:00:00Z' })])).toBe(true);
  });
  it('otra transacción cercana es otro cobro', () => {
    expect(yaCobraEstaVenta(venta, [c({ hotmartTransactionId: 'HP2' })])).toBe(false);
  });
  it('una reversada o una manual no cuentan', () => {
    expect(yaCobraEstaVenta(venta, [c({ status: 'REJECTED' }), c({ periodKey: 'MANUAL-2026-10-x' })])).toBe(false);
  });
});
