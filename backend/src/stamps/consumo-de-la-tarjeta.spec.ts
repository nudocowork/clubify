import { describe, it, expect } from 'vitest';
import { resumirConsumo, type FilaDeConsumo } from './consumo-de-la-tarjeta';

const fila = (dia: number, parcial: Partial<FilaDeConsumo>): FilaDeConsumo => ({
  action: 'STAMP',
  purchaseAmount: null,
  giftReason: null,
  redeemKind: null,
  orderId: null,
  createdAt: new Date(Date.UTC(2026, 9, dia)),
  ...parcial,
});

describe('consumo de una tarjeta', () => {
  it('separa lo gastado para este premio de lo gastado en toda la tarjeta', () => {
    const r = resumirConsumo([
      fila(1, { purchaseAmount: '30000' }),
      fila(2, { action: 'REDEEM', redeemKind: 'REWARD' }),
      fila(3, { purchaseAmount: '10000' }),
      fila(4, { action: 'VISIT', purchaseAmount: '20000' }),
    ]);
    expect(r.historico).toEqual({ total: 60000, compras: 3, ticketPromedio: 20000 });
    expect(r.desdeElCanje).toEqual({ total: 30000, compras: 2, ticketPromedio: 15000 });
    expect(r.ultimoCanjeAt?.getUTCDate()).toBe(2);
    expect(r.ultimaCompraAt?.getUTCDate()).toBe(4);
  });

  it('canjear un cupón no abre un premio nuevo', () => {
    const r = resumirConsumo([
      fila(1, { purchaseAmount: 5000 }),
      fila(2, { action: 'REDEEM', redeemKind: 'COUPON' }),
    ]);
    expect(r.ultimoCanjeAt).toBeNull();
    expect(r.desdeElCanje.total).toBe(5000);
  });

  it('un canje viejo sin clase cuenta como premio', () => {
    const r = resumirConsumo([
      fila(1, { purchaseAmount: 5000 }),
      fila(2, { action: 'REDEEM' }),
    ]);
    expect(r.desdeElCanje.compras).toBe(0);
  });

  it('el regalo y el sello sin monto no suman, y se cuentan aparte', () => {
    const r = resumirConsumo([
      fila(1, { giftReason: 'COURTESY' }),
      fila(2, { giftReason: 'SPECIAL_DATE' }),
      fila(3, {}),
    ]);
    expect(r.historico.total).toBe(0);
    expect(r.regalos).toBe(2);
    expect(r.sinMonto).toBe(1);
  });

  it('el sello de un pedido cancelado no se reporta como dato faltante', () => {
    expect(resumirConsumo([fila(1, { orderId: 'ped-1' })]).sinMonto).toBe(0);
  });

  it('el saldo de cashback no es consumo', () => {
    const r = resumirConsumo([fila(1, { action: 'CASHBACK_ADD', purchaseAmount: 900 })]);
    expect(r.historico.compras).toBe(0);
    expect(r.sinMonto).toBe(0);
  });
});
