import { describe, expect, it } from 'vitest';
import {
  offerCodeFromUrl,
  periodicityFromOfferCode,
  periodicityFromName,
  periodicityFromValue,
  resolvePeriodicity,
} from '../src/auth/plan-from-offer';

describe('offerCodeFromUrl', () => {
  it('extrae off= de una URL de Hotmart', () => {
    expect(offerCodeFromUrl('https://pay.hotmart.com/ABC123?off=xk29fq')).toBe('xk29fq');
  });
  it('off en medio de la query', () => {
    expect(offerCodeFromUrl('https://pay.hotmart.com/ABC?checkoutMode=10&off=abc&x=1')).toBe('abc');
  });
  it('sin off → null', () => {
    expect(offerCodeFromUrl('https://pay.hotmart.com/ABC123')).toBeNull();
    expect(offerCodeFromUrl(null)).toBeNull();
    expect(offerCodeFromUrl('')).toBeNull();
  });
});

const PLANS = {
  mensual: 'https://pay.hotmart.com/PROD?off=MENS01',
  trimestral: 'https://pay.hotmart.com/PROD?off=TRIM01',
  semestral: 'https://pay.hotmart.com/PROD?off=SEME01',
  anual: 'https://pay.hotmart.com/PROD?off=ANU001',
};

describe('periodicityFromOfferCode — determinista', () => {
  it('matchea el offer del pago al plan mensual', () => {
    expect(periodicityFromOfferCode('MENS01', PLANS)).toBe('MENSUAL');
  });
  it('case-insensitive', () => {
    expect(periodicityFromOfferCode('trim01', PLANS)).toBe('TRIMESTRAL');
  });
  it('offer que no matchea ningún plan → null', () => {
    expect(periodicityFromOfferCode('OTRO99', PLANS)).toBeNull();
  });
  it('sin offer o sin plans → null', () => {
    expect(periodicityFromOfferCode(null, PLANS)).toBeNull();
    expect(periodicityFromOfferCode('MENS01', null)).toBeNull();
  });
});

describe('periodicityFromValue — NO adivina sin moneda USD (el bug)', () => {
  it('mensual pagado en moneda local (currency null) → null, NO ANUAL', () => {
    expect(periodicityFromValue(340, null)).toBeNull();
    expect(periodicityFromValue(272000, null)).toBeNull(); // COP
  });
  it('local currency explícita → null', () => {
    expect(periodicityFromValue(500, 'COP')).toBeNull();
    expect(periodicityFromValue(500, 'BRL')).toBeNull();
  });
  it('USD sí aplica los umbrales', () => {
    expect(periodicityFromValue(500, 'USD')).toBe('ANUAL');
    expect(periodicityFromValue(150, 'USD')).toBe('TRIMESTRAL');
    expect(periodicityFromValue(68, 'USD')).toBe('MENSUAL');
  });
});

describe('periodicityFromName', () => {
  it('detecta la periodicidad en el nombre', () => {
    expect(periodicityFromName('Clubify Plan Anual')).toBe('ANUAL');
    expect(periodicityFromName('Suscripción Mensual')).toBe('MENSUAL');
    expect(periodicityFromName('Producto sin periodo')).toBeNull();
  });
});

describe('resolvePeriodicity — precedencia offer > nombre > monto', () => {
  it('el OFFER gana aunque el nombre/monto digan otra cosa', () => {
    expect(
      resolvePeriodicity({
        offerCode: 'MENS01',
        plans: PLANS,
        productName: 'Clubify Plan Anual', // nombre engañoso
        value: 500,
        currency: 'USD', // monto también diría anual
      }),
    ).toBe('MENSUAL');
  });
  it('sin offer, cae al NOMBRE', () => {
    expect(
      resolvePeriodicity({ offerCode: 'X', plans: PLANS, productName: 'Semestral' }),
    ).toBe('SEMESTRAL');
  });
  it('EL BUG arreglado: mensual local sin currency → null (no ANUAL)', () => {
    expect(
      resolvePeriodicity({
        offerCode: null,
        plans: PLANS,
        productName: 'Clubify Pro', // sin keyword
        value: 340000, // COP
        currency: null,
      }),
    ).toBeNull();
  });
});
