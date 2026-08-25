import { describe, it, expect } from 'vitest';

/**
 * Contrato del sello REGALADO (cortesía / fecha especial).
 *
 * Dos reglas que no se pueden romper:
 *   1. Un regalo NO exige monto de compra — no hubo compra que exigir.
 *   2. Un regalo NUNCA guarda monto, aunque el cliente mande uno. Si entrara,
 *      un sello de cortesía sumaría a las ventas del negocio y el dueño vería
 *      ingresos que nunca existieron.
 *
 * Copia fiel de la lógica de `stamps.service.ts` — el módulo real arrastra
 * NestJS entero y no se puede importar sin base de datos.
 */

class BadRequest extends Error {}

type Dto = {
  action: 'STAMP' | 'VISIT' | 'REDEEM';
  purchaseAmount?: number | null;
  giftReason?: string;
};

function resolver(
  dto: Dto,
  card: { type: string; minAmountPerStamp?: number | null },
  role = 'TENANT_STAFF',
): { purchaseAmount: number | null | undefined; giftReason: string | null } {
  const esRegalo =
    dto.giftReason === 'COURTESY' || dto.giftReason === 'SPECIAL_DATE';
  if (dto.giftReason && !esRegalo) {
    throw new BadRequest('Motivo de regalo invalido.');
  }

  const requiresPurchase =
    !esRegalo &&
    (dto.action === 'STAMP' || dto.action === 'VISIT') &&
    ['STAMPS', 'VISITS', 'HYBRID'].includes(card.type);

  if (
    requiresPurchase &&
    role !== 'SUPER_ADMIN' &&
    (dto.purchaseAmount === undefined ||
      dto.purchaseAmount === null ||
      Number(dto.purchaseAmount) <= 0)
  ) {
    throw new BadRequest('Monto de compra requerido para registrar el sello.');
  }

  if (
    requiresPurchase &&
    role !== 'SUPER_ADMIN' &&
    card.minAmountPerStamp &&
    dto.purchaseAmount != null &&
    Number(dto.purchaseAmount) < Number(card.minAmountPerStamp)
  ) {
    throw new BadRequest('Monto mínimo por sello no alcanzado.');
  }

  return {
    purchaseAmount: esRegalo
      ? null
      : dto.purchaseAmount !== undefined && dto.purchaseAmount !== null
        ? dto.purchaseAmount
        : undefined,
    giftReason: esRegalo ? (dto.giftReason as string) : null,
  };
}

const TARJETA = { type: 'STAMPS' as const };

describe('sello de compra (lo de siempre)', () => {
  it('exige el monto', () => {
    expect(() => resolver({ action: 'STAMP' }, TARJETA)).toThrow(
      /Monto de compra requerido/,
    );
  });

  it('rechaza monto en cero', () => {
    expect(() =>
      resolver({ action: 'STAMP', purchaseAmount: 0 }, TARJETA),
    ).toThrow(/Monto de compra requerido/);
  });

  it('guarda el monto y no marca regalo', () => {
    const r = resolver({ action: 'STAMP', purchaseAmount: 25000 }, TARJETA);
    expect(r).toEqual({ purchaseAmount: 25000, giftReason: null });
  });

  it('respeta el mínimo por sello de la tarjeta', () => {
    expect(() =>
      resolver({ action: 'STAMP', purchaseAmount: 5000 }, {
        type: 'STAMPS',
        minAmountPerStamp: 20000,
      }),
    ).toThrow(/Monto mínimo/);
  });
});

describe('sello regalado', () => {
  it('cortesía: no exige monto', () => {
    const r = resolver({ action: 'STAMP', giftReason: 'COURTESY' }, TARJETA);
    expect(r).toEqual({ purchaseAmount: null, giftReason: 'COURTESY' });
  });

  it('fecha especial: no exige monto', () => {
    const r = resolver(
      { action: 'STAMP', giftReason: 'SPECIAL_DATE' },
      TARJETA,
    );
    expect(r).toEqual({ purchaseAmount: null, giftReason: 'SPECIAL_DATE' });
  });

  it('NUNCA guarda monto, aunque lo manden — un regalo no es una venta', () => {
    const r = resolver(
      { action: 'STAMP', purchaseAmount: 99000, giftReason: 'COURTESY' },
      TARJETA,
    );
    expect(r.purchaseAmount).toBeNull();
  });

  it('se salta el mínimo por sello: no hay compra que comparar', () => {
    expect(() =>
      resolver({ action: 'STAMP', giftReason: 'COURTESY' }, {
        type: 'STAMPS',
        minAmountPerStamp: 20000,
      }),
    ).not.toThrow();
  });

  it('un motivo inventado se rechaza, no se ignora en silencio', () => {
    expect(() =>
      resolver({ action: 'STAMP', giftReason: 'PORQUE_SI' }, TARJETA),
    ).toThrow(/Motivo de regalo invalido/);
  });

  it('vale igual para tarjetas de visitas', () => {
    const r = resolver(
      { action: 'VISIT', giftReason: 'SPECIAL_DATE' },
      { type: 'VISITS' },
    );
    expect(r).toEqual({ purchaseAmount: null, giftReason: 'SPECIAL_DATE' });
  });
});
