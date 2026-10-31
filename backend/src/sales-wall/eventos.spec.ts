import { describe, it, expect } from 'vitest';
import { afiliadoQueVendio, esCompraPorActivar, nombreDelPlan, planDelPago, tipoDeIngreso } from './eventos';

describe('Sales Wall · reglas', () => {
  it('NUEVA es venta; RENOVACION y UPGRADE, renovación; lo demás no sale', () => {
    expect(tipoDeIngreso('NUEVA')).toBe('venta');
    expect(tipoDeIngreso('renovacion')).toBe('renovacion');
    expect(tipoDeIngreso('UPGRADE')).toBe('renovacion');
    expect(tipoDeIngreso('OTRO')).toBeNull();
    expect(tipoDeIngreso(null)).toBeNull();
  });

  it('vendió el vendedor antes que el embajador y el influencer', () => {
    expect(
      afiliadoQueVendio([
        { role: 'INFLUENCER', ownerName: 'Nicolas Quintero' },
        { role: 'VENDOR', ownerName: 'Samuel Navarro' },
        { role: 'AMBASSADOR', ownerName: 'Sara Plata' },
      ]),
    ).toBe('Samuel Navarro');
    expect(afiliadoQueVendio([{ role: 'INFLUENCER', ownerName: 'Nicolas Quintero' }])).toBe('Nicolas Quintero');
  });

  it('sin afiliado (o solo un socio), «Venta directa»', () => {
    expect(afiliadoQueVendio([])).toBe('Venta directa');
    expect(afiliadoQueVendio([{ role: 'SOCIO', ownerName: 'Javier' }])).toBe('Venta directa');
  });

  it('nombre del plan', () => {
    expect(nombreDelPlan('TRIMESTRAL', 150)).toBe('Plan Trimestral');
    expect(nombreDelPlan('MENSUAL', 25)).toBe('Mensualidad básica');
    expect(nombreDelPlan('MENSUAL', 68)).toBe('Plan Mensual');
    expect(nombreDelPlan(null, 50)).toBe('');
  });

  describe('compra por activar', () => {
    const pago = (compra: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      subscriberCode: 'SUB1',
      compradorTieneCuenta: false,
      rawPayload: { data: { purchase: compra, subscription: { plan: { name: ' Plan Anual ' } } } },
      ...extra,
    }) as Parameters<typeof esCompraPorActivar>[0];

    it('una suscripción nueva de quien no tiene cuenta se anuncia', () => {
      expect(esCompraPorActivar(pago({ price: { value: 500 }, recurrence_number: 1 }))).toBe(true);
      expect(planDelPago(pago({}).rawPayload)).toBe('Plan Anual');
    });

    it('un servicio suelto no es una venta: sin suscripción o con cuenta no se anuncia', () => {
      expect(esCompraPorActivar(pago({ price: { value: 20 } }, { subscriberCode: null }))).toBe(false);
      expect(esCompraPorActivar(pago({ price: { value: 20 } }, { compradorTieneCuenta: true }))).toBe(false);
    });

    it('ni la prueba gratis ni una recurrencia se anuncian como venta', () => {
      expect(esCompraPorActivar(pago({ price: { value: 0 } }))).toBe(false);
      expect(esCompraPorActivar(pago({ price: { value: 68 }, recurrence_number: 2 }))).toBe(false);
    });
  });
});
