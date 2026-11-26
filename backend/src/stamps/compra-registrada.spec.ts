import { describe, it, expect } from 'vitest';
import { esCompraRegistrada } from './compra-registrada';

describe('esCompraRegistrada', () => {
  it('cashback y VIP con monto cuentan como venta (antes daban $0)', () => {
    expect(esCompraRegistrada({ accion: 'CASHBACK_ADD', purchaseAmount: 50000 })).toBe(true);
    expect(esCompraRegistrada({ accion: 'VISIT', purchaseAmount: '12000.50' })).toBe(true);
    expect(esCompraRegistrada({ accion: 'STAMP', purchaseAmount: 1 })).toBe(true);
  });
  it('sin monto, monto cero o regalo (monto null) → no', () => {
    expect(esCompraRegistrada({ accion: 'STAMP', purchaseAmount: null })).toBe(false);
    expect(esCompraRegistrada({ accion: 'STAMP', purchaseAmount: 0 })).toBe(false);
    expect(esCompraRegistrada({ accion: 'STAMP', purchaseAmount: 'abc' })).toBe(false);
  });
  it('acciones que no son compra → no', () => {
    expect(esCompraRegistrada({ accion: 'CASHBACK_REDEEM', purchaseAmount: 5000 })).toBe(false);
    expect(esCompraRegistrada({ accion: 'REDEEM', purchaseAmount: 5000 })).toBe(false);
  });
  it('lo que viene de un pedido ya cuenta en el pedido → no se suma dos veces', () => {
    expect(esCompraRegistrada({ accion: 'POINTS_ADD', purchaseAmount: 30000, orderId: 'o1' })).toBe(false);
  });
});
