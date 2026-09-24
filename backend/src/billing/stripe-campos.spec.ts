import { describe, it, expect } from 'vitest';
import { precioDeLaFactura, suscripcionDeLaFactura } from './stripe-campos';

/**
 * Los dos objetos de abajo son la forma REAL de una factura, copiada de
 * `StripeWebhookEvent.payload` en producción (solo los campos que se leen).
 * Si Stripe vuelve a mover algo, esta prueba es la que avisa.
 */

/** Como llega hoy de la cuenta de Sellea: `2026-05-27.dahlia`. */
const FACTURA_NUEVA = {
  parent: {
    type: 'subscription_details',
    quote_details: null,
    subscription_details: {
      metadata: {},
      subscription: 'sub_1U8q2uKAK6ubdwt6ZOQQKgwg',
    },
  },
  lines: {
    data: [
      {
        pricing: {
          type: 'price_details',
          price_details: {
            price: 'price_1TlZHFKAK6ubdwt6OoN2w7bl',
            product: 'prod_Ul5Sqk0SWQDcYv',
          },
          unit_amount_decimal: '10000',
        },
        period: { end: 1790464549, start: 1787786149 },
      },
    ],
  },
};

/** Como llegaba antes, y como puede seguir llegando de una cuenta sin migrar. */
const FACTURA_VIEJA = {
  subscription: 'sub_viejo',
  lines: { data: [{ price: { id: 'price_viejo' }, period: { end: 1790464549 } }] },
};

describe('la suscripción de una factura', () => {
  it('se encuentra en el sitio NUEVO', () => {
    expect(suscripcionDeLaFactura(FACTURA_NUEVA)).toBe('sub_1U8q2uKAK6ubdwt6ZOQQKgwg');
  });

  it('se sigue encontrando en el sitio viejo', () => {
    expect(suscripcionDeLaFactura(FACTURA_VIEJA)).toBe('sub_viejo');
  });

  it('el sitio viejo manda cuando llegan los dos', () => {
    expect(
      suscripcionDeLaFactura({ ...FACTURA_NUEVA, subscription: 'sub_viejo' }),
    ).toBe('sub_viejo');
  });

  it('sin suscripción devuelve null, no una cadena vacía', () => {
    expect(suscripcionDeLaFactura({ parent: { subscription_details: null } })).toBeNull();
    expect(suscripcionDeLaFactura({ subscription: '' })).toBeNull();
    expect(suscripcionDeLaFactura(null)).toBeNull();
  });
});

describe('el precio de una factura', () => {
  it('se encuentra en el sitio NUEVO', () => {
    expect(precioDeLaFactura(FACTURA_NUEVA)).toBe('price_1TlZHFKAK6ubdwt6OoN2w7bl');
  });

  it('se sigue encontrando en el sitio viejo', () => {
    expect(precioDeLaFactura(FACTURA_VIEJA)).toBe('price_viejo');
  });

  it('una factura sin líneas no revienta', () => {
    expect(precioDeLaFactura({ lines: { data: [] } })).toBeNull();
    expect(precioDeLaFactura({})).toBeNull();
    expect(precioDeLaFactura(undefined)).toBeNull();
  });
});

describe('la prueba sabe ponerse en rojo', () => {
  it('leyendo solo el sitio viejo, la factura de hoy se queda sin datos', () => {
    // Esto es literalmente lo que hacía el backend hasta hoy.
    const comoAntes = (f: typeof FACTURA_NUEVA) => ({
      sub: (f as Record<string, unknown>).subscription ?? null,
      price: f.lines?.data?.[0]?.['price' as never] ?? null,
    });
    expect(comoAntes(FACTURA_NUEVA)).toEqual({ sub: null, price: null });
  });
});
