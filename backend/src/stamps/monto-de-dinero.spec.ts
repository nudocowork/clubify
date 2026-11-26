import { describe, expect, it } from 'vitest';
import { montoDeLaAccion, saldoInsuficiente } from './monto-de-dinero';

const base = { esSuperAdmin: false, card: { cashbackPercent: 5, cashbackMinPurchase: null } };

describe('montoDeLaAccion', () => {
  it('el cashback lo calcula el servidor con la compra, no con lo que mande el navegador', () => {
    const r = montoDeLaAccion({ ...base, accion: 'CASHBACK_ADD', amount: 999999, purchaseAmount: 20000 });
    expect(r.amount).toBe(1000);
    expect(r.purchaseAmount).toBe(20000);
  });

  it('sin % en la tarjeta usa el 5 %, como el escáner', () => {
    const r = montoDeLaAccion({
      ...base,
      card: { cashbackPercent: null },
      accion: 'CASHBACK_ADD',
      amount: 1,
      purchaseAmount: 10000,
    });
    expect(r.amount).toBe(500);
  });

  it('respeta la compra mínima de la tarjeta', () => {
    const card = { cashbackPercent: 5, cashbackMinPurchase: '30000' };
    expect(() =>
      montoDeLaAccion({ ...base, card, accion: 'CASHBACK_ADD', amount: 1, purchaseAmount: 20000 }),
    ).toThrow(/Compra mínima/);
    expect(montoDeLaAccion({ ...base, card, accion: 'CASHBACK_ADD', amount: 1, purchaseAmount: 30000 }).amount).toBe(
      1500,
    );
  });

  it('sin compra no abona; solo un SUPER_ADMIN puede ajustar a mano', () => {
    expect(() => montoDeLaAccion({ ...base, accion: 'CASHBACK_ADD', amount: 500, purchaseAmount: undefined })).toThrow(
      /monto de la compra/,
    );
    expect(
      montoDeLaAccion({ ...base, esSuperAdmin: true, accion: 'CASHBACK_ADD', amount: 500, purchaseAmount: undefined })
        .amount,
    ).toBe(500);
  });

  it('un canje con monto negativo ya no suma saldo: se rechaza', () => {
    expect(() => montoDeLaAccion({ ...base, accion: 'CASHBACK_REDEEM', amount: -5000, purchaseAmount: undefined })).toThrow(
      /negativo/,
    );
    expect(() => montoDeLaAccion({ ...base, accion: 'CASHBACK_REDEEM', amount: 0, purchaseAmount: undefined })).toThrow(
      /cuánto saldo/,
    );
    expect(() => montoDeLaAccion({ ...base, accion: 'POINTS_DEDUCT', amount: -1, purchaseAmount: undefined })).toThrow(
      /negativo/,
    );
  });

  it('texto en vez de número es un 400, no un 500', () => {
    expect(() => montoDeLaAccion({ ...base, accion: 'POINTS_ADD', amount: 'abc', purchaseAmount: undefined })).toThrow(
      /no es un número/,
    );
    expect(() => montoDeLaAccion({ ...base, accion: 'STAMP', amount: 'abc', purchaseAmount: undefined })).toThrow(
      /no es un número/,
    );
  });

  it('a las acciones de sellos no les cambia nada salvo validar los números', () => {
    expect(montoDeLaAccion({ ...base, accion: 'STAMP', amount: undefined, purchaseAmount: 15000 })).toEqual({
      amount: undefined,
      purchaseAmount: 15000,
    });
    expect(montoDeLaAccion({ ...base, accion: 'STAMP', amount: 2, purchaseAmount: '15000' }).purchaseAmount).toBe(15000);
  });
});

describe('saldoInsuficiente', () => {
  it('dice cuánto tiene', () => {
    expect(saldoInsuficiente('CASHBACK_REDEEM', 12500)).toMatch(/12\.500/);
    expect(saldoInsuficiente('POINTS_DEDUCT', 40.6)).toMatch(/40/);
  });
});
