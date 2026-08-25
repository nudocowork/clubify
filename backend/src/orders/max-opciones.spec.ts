import { describe, it, expect } from 'vitest';

/**
 * Contrato de los topes por producto: cuántas VARIANTES puede marcar el
 * cliente y cuántos EXTRAS. Ambos se hacen cumplir en el servidor, porque el
 * storefront deshabilitando casillas es comodidad, no defensa: un POST directo
 * al endpoint de pedidos se la salta entera.
 *
 * Estas funciones son copias fieles de las de `orders.service.ts` — el módulo
 * real arrastra todo NestJS y no se puede importar sin base de datos. Si el
 * comportamiento allá cambia, estos tests dejan de describir la realidad; el
 * valor es fijar las reglas que ya nos mordieron.
 */

class BadRequest extends Error {}

function variantUnitPrice(base: number, mode: string, delta: number): number {
  return mode === 'ABSOLUTE' ? delta : base + delta;
}

function resolverVariantes(
  p: {
    name: string;
    variantPriceMode: string;
    maxVariantsTotal?: number | null;
    variants: { id: string; name: string; priceDelta: number }[];
  },
  unitBase: number,
  item: { variantId?: string | null; variantIds?: string[] | null },
): { unit: number; sufijo: string; ids: string[] } {
  const multiPermitido =
    (p.maxVariantsTotal ?? 1) > 1 && p.variantPriceMode === 'DELTA';
  const pedidos = multiPermitido
    ? item.variantIds?.length
      ? item.variantIds
      : item.variantId
        ? [item.variantId]
        : []
    : item.variantId
      ? [item.variantId]
      : (item.variantIds?.slice(0, 1) ?? []);
  if (!pedidos.length) return { unit: unitBase, sufijo: '', ids: [] };
  const unicos = [...new Set(pedidos)];
  if (multiPermitido && unicos.length > (p.maxVariantsTotal ?? 1)) {
    throw new BadRequest(
      `"${p.name}" admite hasta ${p.maxVariantsTotal} variantes y llegaron ${unicos.length}.`,
    );
  }
  let unit = unitBase;
  const nombres: string[] = [];
  for (const id of unicos) {
    const v = p.variants.find((x) => x.id === id);
    if (!v) throw new BadRequest('Variante inválida');
    unit = variantUnitPrice(unit, p.variantPriceMode, Number(v.priceDelta));
    nombres.push(v.name);
  }
  return { unit, sufijo: ` (${nombres.join(', ')})`, ids: unicos };
}

function assertTopeDeExtras(
  p: { name: string; maxExtrasTotal?: number | null },
  extraIds?: string[] | null,
) {
  const tope = p.maxExtrasTotal ?? null;
  if (tope == null || tope <= 0) return;
  const elegidos = extraIds?.length ?? 0;
  if (elegidos > tope) {
    throw new BadRequest(
      `"${p.name}" admite hasta ${tope} ${tope === 1 ? 'extra' : 'extras'} y llegaron ${elegidos}.`,
    );
  }
}

const SALSAS = [
  { id: 'a', name: 'BBQ', priceDelta: 1000 },
  { id: 'b', name: 'Ajo', priceDelta: 500 },
  { id: 'c', name: 'Picante', priceDelta: 0 },
];

describe('tope de variantes', () => {
  it('sin tope se elige UNA sola, como siempre', () => {
    const p = { name: 'Alitas', variantPriceMode: 'DELTA', variants: SALSAS };
    const r = resolverVariantes(p, 20000, { variantIds: ['a', 'b'] });
    expect(r.ids).toEqual(['a']);
    expect(r.unit).toBe(21000);
  });

  it('con tope 2 admite dos y suma ambos deltas', () => {
    const p = {
      name: 'Alitas',
      variantPriceMode: 'DELTA',
      maxVariantsTotal: 2,
      variants: SALSAS,
    };
    const r = resolverVariantes(p, 20000, { variantIds: ['a', 'b'] });
    expect(r.ids).toEqual(['a', 'b']);
    expect(r.unit).toBe(21500);
    expect(r.sufijo).toBe(' (BBQ, Ajo)');
  });

  it('rechaza pasarse del tope — la defensa está en el servidor', () => {
    const p = {
      name: 'Alitas',
      variantPriceMode: 'DELTA',
      maxVariantsTotal: 2,
      variants: SALSAS,
    };
    expect(() =>
      resolverVariantes(p, 20000, { variantIds: ['a', 'b', 'c'] }),
    ).toThrow(/hasta 2 variantes y llegaron 3/);
  });

  it('marcar dos veces la misma no la cobra dos veces', () => {
    const p = {
      name: 'Alitas',
      variantPriceMode: 'DELTA',
      maxVariantsTotal: 2,
      variants: SALSAS,
    };
    const r = resolverVariantes(p, 20000, { variantIds: ['a', 'a'] });
    expect(r.ids).toEqual(['a']);
    expect(r.unit).toBe(21000);
  });

  it('en ABSOLUTE el multi se ignora: sumar dos precios finales no significa nada', () => {
    const p = {
      name: 'Pizza',
      variantPriceMode: 'ABSOLUTE',
      maxVariantsTotal: 3,
      variants: [
        { id: 'm', name: 'Mediana', priceDelta: 30000 },
        { id: 'g', name: 'Grande', priceDelta: 45000 },
      ],
    };
    const r = resolverVariantes(p, 20000, { variantIds: ['m', 'g'] });
    expect(r.ids).toEqual(['m']);
    expect(r.unit).toBe(30000);
  });

  it('tope 1 se comporta igual que sin tope', () => {
    const p = {
      name: 'Alitas',
      variantPriceMode: 'DELTA',
      maxVariantsTotal: 1,
      variants: SALSAS,
    };
    const r = resolverVariantes(p, 20000, { variantIds: ['a', 'b'] });
    expect(r.ids).toEqual(['a']);
  });

  it('sin variantes elegidas el precio no cambia', () => {
    const p = { name: 'Alitas', variantPriceMode: 'DELTA', variants: SALSAS };
    const r = resolverVariantes(p, 20000, {});
    expect(r).toEqual({ unit: 20000, sufijo: '', ids: [] });
  });
});

describe('tope de extras', () => {
  it('null = sin tope: no rompe nada de lo que ya existe', () => {
    expect(() =>
      assertTopeDeExtras({ name: 'Burger' }, ['a', 'b', 'c', 'd']),
    ).not.toThrow();
  });

  it('deja pasar justo el tope', () => {
    expect(() =>
      assertTopeDeExtras({ name: 'Burger', maxExtrasTotal: 3 }, ['a', 'b', 'c']),
    ).not.toThrow();
  });

  it('rechaza uno de más', () => {
    expect(() =>
      assertTopeDeExtras({ name: 'Burger', maxExtrasTotal: 3 }, [
        'a',
        'b',
        'c',
        'd',
      ]),
    ).toThrow(/hasta 3 extras y llegaron 4/);
  });

  it('con tope 1 el mensaje va en singular — lo lee un cliente real', () => {
    expect(() =>
      assertTopeDeExtras({ name: 'Café', maxExtrasTotal: 1 }, ['a', 'b']),
    ).toThrow(/hasta 1 extra y llegaron 2/);
  });

  it('sin extras elegidos nunca bloquea', () => {
    expect(() =>
      assertTopeDeExtras({ name: 'Burger', maxExtrasTotal: 1 }, []),
    ).not.toThrow();
    expect(() =>
      assertTopeDeExtras({ name: 'Burger', maxExtrasTotal: 1 }),
    ).not.toThrow();
  });
});
