import { describe, it, expect } from 'vitest';
import { canjeAnteriorDelCupon } from './cupon-ya-canjeado';
import { esCuponUsado, estadoDelObjetoDeGoogle } from '../wallet/cupon-usado';

/**
 * Caso guía: John Fredy Velandia, &N COFFEE. Canjeó el café de bienvenida el
 * 30-oct a las 9:25; el pase se transformó en su tarjeta de sellos y a las
 * 9:34 volvió a registrarse y recibió OTRO café gratis.
 */
const CUPON = { id: 'card-cupon', tenantId: 't-n', type: 'COUPON', couponIndefinido: false };

function base(sellos: Array<Record<string, any>>, cuponesDelNegocio = 1) {
  const coincide = (s: any, w: any) =>
    Object.entries(w).every(([k, v]) => (v === null ? s[k] == null : s[k] === v));
  return {
    stamp: {
      findFirst: async ({ where }: any) => sellos.find((s) => coincide(s, where)) ?? null,
    },
    card: { count: async () => cuponesDelNegocio },
  };
}
const canje = (extra: Record<string, any> = {}) => ({
  tenantId: 't-n',
  customerId: 'john',
  action: 'REDEEM',
  redeemKind: 'COUPON',
  passId: 'pase-sellos-john',
  ...extra,
});

describe('canjeAnteriorDelCupon', () => {
  it('ya canjeó ESTE cupón → se le devuelve su tarjeta de sellos, no un cupón nuevo', async () => {
    const r = await canjeAnteriorDelCupon(base([canje({ cardId: 'card-cupon' })]), CUPON, 'john');
    expect(r).toEqual({ passId: 'pase-sellos-john' });
  });

  it('nunca canjeó → puede recibirlo', async () => {
    expect(await canjeAnteriorDelCupon(base([]), CUPON, 'john')).toBeNull();
  });

  it('canjeó OTRO cupón del negocio → este sí puede recibirlo', async () => {
    const db = base([canje({ cardId: 'card-otro-cupon' })], 2);
    expect(await canjeAnteriorDelCupon(db, CUPON, 'john')).toBeNull();
  });

  it('canje viejo sin tarjeta guardada: cuenta solo si el negocio tiene UN cupón', async () => {
    const viejo = [canje({ cardId: null })];
    expect(await canjeAnteriorDelCupon(base(viejo, 1), CUPON, 'john')).toEqual({ passId: 'pase-sellos-john' });
    expect(await canjeAnteriorDelCupon(base(viejo, 3), CUPON, 'john')).toBeNull();
  });

  it('un premio de sellos (REWARD) no cuenta como cupón canjeado', async () => {
    const db = base([canje({ redeemKind: 'REWARD', cardId: 'card-cupon' })]);
    expect(await canjeAnteriorDelCupon(db, CUPON, 'john')).toBeNull();
  });

  it('cupón indefinido o tarjeta de sellos: no aplica', async () => {
    const db = base([canje({ cardId: 'card-cupon' })]);
    expect(await canjeAnteriorDelCupon(db, { ...CUPON, couponIndefinido: true }, 'john')).toBeNull();
    expect(await canjeAnteriorDelCupon(db, { ...CUPON, type: 'STAMPS' }, 'john')).toBeNull();
  });
});

describe('cupón usado en el teléfono (Apple voided / Google INACTIVE)', () => {
  it('cupón, descuento o regalo COMPLETED → usado e INACTIVE', () => {
    for (const type of ['COUPON', 'DISCOUNT', 'GIFT']) {
      const p = { status: 'COMPLETED', card: { type } };
      expect(esCuponUsado(p)).toBe(true);
      expect(estadoDelObjetoDeGoogle(p)).toBe('INACTIVE');
    }
  });
  it('activo, de sellos completa o indefinido → sigue ACTIVE', () => {
    expect(estadoDelObjetoDeGoogle({ status: 'ACTIVE', card: { type: 'COUPON' } })).toBe('ACTIVE');
    expect(estadoDelObjetoDeGoogle({ status: 'COMPLETED', card: { type: 'STAMPS' } })).toBe('ACTIVE');
    expect(estadoDelObjetoDeGoogle({ status: 'COMPLETED', card: { type: 'COUPON', couponIndefinido: true } })).toBe('ACTIVE');
  });
  it('revocado → INACTIVE', () => {
    expect(estadoDelObjetoDeGoogle({ status: 'REVOKED', card: { type: 'STAMPS' } })).toBe('INACTIVE');
  });
});
