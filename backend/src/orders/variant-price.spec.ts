import { describe, it, expect } from 'vitest';
import { variantUnitPrice } from './variant-price';

/**
 * Contrato DELTA vs ABSOLUTE del precio por variante. Un error aquí se
 * traduce directo en cobrarle mal a un cliente real: el caso que motivó
 * ABSOLUTE es una «Bandeja Paisa» con Torre pequeña $34.900, Torre
 * personal $44.900 y Montañita pequeña $39.900 — si ese producto se
 * interpretara como DELTA, la Torre personal costaría $34.900 + $44.900.
 */
describe('variantUnitPrice', () => {
  describe('DELTA (histórico): la variante suma al precio base', () => {
    it('suma el delta al base', () => {
      expect(variantUnitPrice(20_000, 'DELTA', 10_000)).toBe(30_000);
    });

    it('delta 0 deja el precio base intacto', () => {
      expect(variantUnitPrice(20_000, 'DELTA', 0)).toBe(20_000);
    });

    it('acepta deltas negativos (variante más barata que el base)', () => {
      expect(variantUnitPrice(20_000, 'DELTA', -5_000)).toBe(15_000);
    });
  });

  describe('ABSOLUTE: la variante define su precio propio total', () => {
    it('ignora el base y usa el precio de la variante', () => {
      // Bandeja Paisa base $34.900 — «Torre personal» vale $44.900, no
      // 34.900 + 44.900.
      expect(variantUnitPrice(34_900, 'ABSOLUTE', 44_900)).toBe(44_900);
    });

    it('la variante más barata también reemplaza al base, no lo descuenta', () => {
      expect(variantUnitPrice(44_900, 'ABSOLUTE', 34_900)).toBe(34_900);
    });
  });

  describe('fallback: cualquier modo desconocido cobra como DELTA', () => {
    // Los productos creados antes de que existiera variantPriceMode (o con
    // un valor corrupto) deben seguir cobrando igual que siempre: sumar.
    // Caer en ABSOLUTE por accidente reemplazaría el precio del producto
    // por el delta (ej. base $20.000 + delta $2.000 → cobraría $2.000).
    it.each([null, undefined, '', 'delta', 'absolute', 'OTRO'])(
      'modo %j suma como DELTA',
      (mode) => {
        expect(variantUnitPrice(20_000, mode as any, 2_000)).toBe(22_000);
      },
    );
  });

  it('los extras suman encima del resultado en ambos modos (composición del caller)', () => {
    // Réplica de la secuencia de OrdersService: primero la variante
    // resuelve el unitario, después cada extra suma encima.
    const extra = 3_000;
    expect(variantUnitPrice(20_000, 'DELTA', 10_000) + extra).toBe(33_000);
    expect(variantUnitPrice(34_900, 'ABSOLUTE', 44_900) + extra).toBe(47_900);
  });
});
