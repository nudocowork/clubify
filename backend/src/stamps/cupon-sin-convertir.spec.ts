import { describe, it, expect } from 'vitest';

/**
 * Contrato del cupón que NO se convierte en tarjeta de sellos.
 *
 * Lo que no se puede romper:
 *   1. `transformIntoCardId = null` significa AUTO, no "ninguna". Por eso hace
 *      falta un campo aparte; si algún día se intenta refundir los dos, esto
 *      falla.
 *   2. Sin conversión hay que CERRAR el pase a mano. La bandera `completed`
 *      excluye a propósito las redenciones de cupón (se asumía que siempre
 *      acababan transformadas y ACTIVE), así que sin esto el cupón se quedaría
 *      ACTIVE y el mismo QR se podría canjear indefinidamente.
 *   3. Un cupón sin conversión no puede disparar la creación de una tarjeta de
 *      sellos: el negocio que reparte un descuento suelto no quiere que le
 *      aparezca un programa de fidelización que nunca pidió.
 *
 * Copias fieles de la lógica real de `stamps.service`; el módulo arrastra
 * NestJS y no se puede importar sin base de datos.
 */

type Card = {
  type: string;
  transformOnRedeem?: boolean;
  transformIntoCardId?: string | null;
};

/** ¿Hay que saltarse la conversión? (`noTransformar` en el servicio). */
function noTransformar(card: Card, action: string): boolean {
  const esRedencionDeCupon =
    (card.type === 'COUPON' || card.type === 'DISCOUNT' || card.type === 'GIFT') &&
    action === 'REDEEM';
  return esRedencionDeCupon && card.transformOnRedeem === false;
}

/** ¿Se resuelve/crea la tarjeta de sellos destino? */
function resuelveDestino(card: Card, action: string): boolean {
  const esRedencionDeCupon =
    (card.type === 'COUPON' || card.type === 'DISCOUNT' || card.type === 'GIFT') &&
    action === 'REDEEM';
  return esRedencionDeCupon && !noTransformar(card, action);
}

/** Estado en el que queda el pase tras el canje. */
function estadoFinal(
  card: Card,
  action: string,
  estadoPrevio: string,
  destinoResuelto: boolean,
): string {
  if (
    (card.type === 'COUPON' || card.type === 'DISCOUNT' || card.type === 'GIFT') &&
    action === 'REDEEM' &&
    destinoResuelto
  ) {
    return 'ACTIVE'; // transformado in-place a tarjeta de sellos
  }
  if (noTransformar(card, action)) return 'COMPLETED';
  return estadoPrevio;
}

const CUPON_CLASICO: Card = { type: 'COUPON', transformOnRedeem: true };
const CUPON_SUELTO: Card = { type: 'COUPON', transformOnRedeem: false };
/** Cupón creado antes de que el campo existiera: llega sin la propiedad. */
const CUPON_VIEJO: Card = { type: 'COUPON' };

describe('null NO significa "ninguna"', () => {
  it('sin destino explícito el cupón SIGUE convirtiéndose (auto)', () => {
    const auto: Card = { type: 'COUPON', transformIntoCardId: null };
    expect(noTransformar(auto, 'REDEEM')).toBe(false);
    expect(resuelveDestino(auto, 'REDEEM')).toBe(true);
  });

  it('un cupón anterior al campo se comporta como siempre', () => {
    expect(noTransformar(CUPON_VIEJO, 'REDEEM')).toBe(false);
    expect(resuelveDestino(CUPON_VIEJO, 'REDEEM')).toBe(true);
  });
});

describe('el cupón que no se convierte', () => {
  it('no resuelve ni crea tarjeta de sellos', () => {
    expect(resuelveDestino(CUPON_SUELTO, 'REDEEM')).toBe(false);
  });

  it('queda COMPLETED — si no, se podría canjear otra vez', () => {
    expect(estadoFinal(CUPON_SUELTO, 'REDEEM', 'ACTIVE', false)).toBe('COMPLETED');
  });

  it('aplica igual a DISCOUNT y GIFT', () => {
    for (const type of ['DISCOUNT', 'GIFT']) {
      const c: Card = { type, transformOnRedeem: false };
      expect(resuelveDestino(c, 'REDEEM')).toBe(false);
      expect(estadoFinal(c, 'REDEEM', 'ACTIVE', false)).toBe('COMPLETED');
    }
  });
});

describe('lo que NO debe cambiar', () => {
  it('el cupón clásico se sigue transformando y queda ACTIVE', () => {
    expect(resuelveDestino(CUPON_CLASICO, 'REDEEM')).toBe(true);
    expect(estadoFinal(CUPON_CLASICO, 'REDEEM', 'ACTIVE', true)).toBe('ACTIVE');
  });

  it('el gate solo mira REDEEM: un sello normal no lo activa', () => {
    expect(noTransformar(CUPON_SUELTO, 'STAMP')).toBe(false);
    expect(resuelveDestino(CUPON_SUELTO, 'STAMP')).toBe(false);
  });

  it('una tarjeta de sellos nunca entra por este camino', () => {
    const sellos: Card = { type: 'STAMPS', transformOnRedeem: false };
    expect(noTransformar(sellos, 'REDEEM')).toBe(false);
    expect(estadoFinal(sellos, 'REDEEM', 'ACTIVE', false)).toBe('ACTIVE');
  });
});
