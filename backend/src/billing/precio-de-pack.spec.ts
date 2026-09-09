import { describe, it, expect } from 'vitest';
import { precioDePackUsd } from './precio-de-pack';

/**
 * Los casos son payloads REALES de producción (arqueo del 2026-09-09, script
 * `scripts/arqueo-creditos-ingreso.cjs`). Si alguno cambia, es que Hotmart
 * cambió el formato y hay que volver a mirar los datos, no ajustar el test.
 */
describe('el precio sale de la oferta, no de lo que cobró la pasarela', () => {
  it('pago en COP: vale el USD de la oferta, no los 66.944 pesos', () => {
    const r = precioDePackUsd({
      price: { value: 66944.28, currency_value: 'COP' },
      original_offer_price: { value: 20.9, currency_value: 'USD' },
    });
    expect(r).toEqual({ usd: 20.9, fuente: 'oferta' });
  });

  it('pago en PAB y en PEN: igual, manda la oferta', () => {
    expect(
      precioDePackUsd({
        price: { value: 21.79, currency_value: 'PAB' },
        original_offer_price: { value: 21.67, currency_value: 'USD' },
      }).usd,
    ).toBe(21.67);
    expect(
      precioDePackUsd({
        price: { value: 71.3, currency_value: 'PEN' },
        original_offer_price: { value: 21.18, currency_value: 'USD' },
      }).usd,
    ).toBe(21.18);
  });

  it('pago en USD: los dos campos coinciden y da igual cuál gane', () => {
    const r = precioDePackUsd({
      price: { value: 17.83, currency_value: 'USD' },
      original_offer_price: { value: 17.83, currency_value: 'USD' },
    });
    expect(r).toEqual({ usd: 17.83, fuente: 'oferta' });
  });

  it('el trimestral que se coló en la tabla de créditos también se cuenta', () => {
    // 2026-08-01: una compra con oferta "Trimestral 150 USD" quedó guardada
    // como pack porque comparte productId. El dinero entró igual.
    const r = precioDePackUsd({
      price: { value: 505703.63, currency_value: 'COP' },
      original_offer_price: { value: 156.71, currency_value: 'USD' },
    });
    expect(r.usd).toBe(156.71);
  });
});

describe('sin precio en el payload cae al pack configurado', () => {
  const pack = { price: 160, currency: 'USD' };

  it('la compra de Sellea del 31-jul no trae precio: valen los 160 del pack', () => {
    const r = precioDePackUsd({}, pack);
    expect(r).toEqual({ usd: 160, fuente: 'pack' });
  });

  it('un payload nulo entero tampoco revienta', () => {
    expect(precioDePackUsd(null, pack).usd).toBe(160);
    expect(precioDePackUsd(undefined, undefined).usd).toBeNull();
  });

  it('un pack en MXN NO se toma por dólares', () => {
    // El campo admite otras monedas (por defecto MXN) y nadie convierte:
    // contarlo como USD inflaría la contabilidad ~20 veces.
    const r = precioDePackUsd({}, { price: 350, currency: 'MXN' });
    expect(r.usd).toBeNull();
    expect(r.motivo).toContain('MXN');
  });
});

describe('lo que NO se acepta', () => {
  it('un precio sin moneda declarada no se supone en dólares', () => {
    // Los pagos en COP venían con currency_value puesto, así que un campo
    // vacío es un payload raro. Preferimos no contar a contar de más.
    expect(precioDePackUsd({ price: { value: 20 } }).usd).toBeNull();
  });

  it('un importe por encima del techo es moneda local sin etiqueta', () => {
    expect(
      precioDePackUsd({ original_offer_price: { value: 505703.63, currency_value: 'USD' } }).usd,
    ).toBeNull();
  });

  it('cero, negativo o no numérico no es un ingreso', () => {
    expect(precioDePackUsd({ price: { value: 0, currency_value: 'USD' } }).usd).toBeNull();
    expect(precioDePackUsd({ price: { value: -18, currency_value: 'USD' } }).usd).toBeNull();
    expect(
      precioDePackUsd({ price: { value: 'diez' as unknown as number, currency_value: 'USD' } }).usd,
    ).toBeNull();
  });

  it('currency_code también se respeta cuando viene en vez de currency_value', () => {
    expect(precioDePackUsd({ price: { value: 20, currency_code: 'BRL' } }).usd).toBeNull();
    expect(precioDePackUsd({ price: { value: 20, currency_code: 'USD' } }).usd).toBe(20);
  });
});

describe('el total del histórico cuadra', () => {
  it('las 18 compras de producción suman 646,80 USD', () => {
    // Arqueo del 2026-09-09. Es la cifra que debe aparecer en Contabilidad
    // cuando se corra el backfill.
    const compras: Array<[number | null, string | null]> = [
      [null, null], // Sellea 31-jul, sin precio → pack de 160
      [156.71, 'USD'],
      [19.81, 'USD'],
      [21.79, 'USD'],
      [17.83, 'USD'],
      [20.9, 'USD'],
      [20.9, 'USD'],
      [20.9, 'USD'],
      [20.9, 'USD'],
      [20.9, 'USD'],
      [20.9, 'USD'],
      [18.81, 'USD'],
      [20.9, 'USD'],
      [20.9, 'USD'],
      [21.67, 'USD'],
      [20.9, 'USD'],
      [21.18, 'USD'],
      [20.9, 'USD'],
    ];
    const total = compras.reduce((acc, [value, ccy]) => {
      const r = precioDePackUsd(
        value == null ? {} : { original_offer_price: { value, currency_value: ccy ?? undefined } },
        { price: 160, currency: 'USD' },
      );
      return acc + (r.usd ?? 0);
    }, 0);
    expect(Math.round(total * 100) / 100).toBe(646.8);
  });
});
