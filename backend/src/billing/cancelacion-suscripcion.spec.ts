import { describe, it, expect } from 'vitest';
import {
  codigoDeSuscriptor,
  correoDelComprador,
  type HotmartWebhookPayload,
} from './hotmart.service';

/**
 * De dónde se saca a quién pertenece un evento de Hotmart.
 *
 * EL FALLO, CON NOMBRE Y FECHA
 * ----------------------------
 * El 2026-09-10 llegó el aviso de cancelación de **Veterinaria Con Sentido**
 * (tx HP3350553540) y el sistema **no lo reconoció**: el evento se guardó con
 * `tenantId: null`, el negocio se quedó en ACTIVE y siguió en la lista de
 * recordatorios de cobro de un servicio que el cliente ya había cancelado.
 *
 * La causa no era el evento: era la FORMA del payload. En una compra, el
 * comprador va en `data.buyer` y el suscriptor en
 * `data.subscription.subscriber`. En una cancelación **no hay `buyer` ni
 * `purchase`**, y el suscriptor cuelga de `data.subscriber` a secas — con el
 * correo dentro. Leer solo la primera forma dejaba las dos búsquedas vacías.
 *
 * Los payloads de aquí son los REALES de producción.
 */

/** El de la cancelación de Veterinaria Con Sentido, tal cual llegó. */
const CANCELACION: HotmartWebhookPayload = {
  id: '1f96b826-206c-4801-b42a-e467de8b7088',
  event: 'SUBSCRIPTION_CANCELLATION',
  data: {
    product: { id: 6504901, name: 'CLUBIFY - TARJETAS DE FIDELIZACION' },
    subscriber: {
      code: 'AMEKND7I',
      name: 'Diana Salazar',
      email: 'veterinariaconsentido@gmail.com',
    },
    subscription: { id: 44634876, plan: { id: 1327568, name: 'Plan Trimestral 150 USD' } },
  } as HotmartWebhookPayload['data'],
};

/** La forma de siempre, la de una compra. */
const COMPRA: HotmartWebhookPayload = {
  event: 'PURCHASE_APPROVED',
  data: {
    buyer: { email: 'Dueno@Negocio.com', name: 'Dueño' },
    subscription: { subscriber: { code: 'ABC123' }, plan: { name: 'Plan Trimestral 150 USD' } },
    purchase: { transaction: 'HP111', status: 'APPROVED' },
  },
};

describe('el correo del comprador', () => {
  it('en una CANCELACIÓN sale de `data.subscriber`, que es donde lo pone Hotmart', () => {
    expect(correoDelComprador(CANCELACION)).toBe('veterinariaconsentido@gmail.com');
  });

  it('en una compra sigue saliendo de `data.buyer`', () => {
    expect(correoDelComprador(COMPRA)).toBe('dueno@negocio.com');
  });

  it('se normaliza a minúsculas en las dos formas', () => {
    expect(
      correoDelComprador({
        data: { subscriber: { email: 'MAYUS@X.COM' } },
      } as HotmartWebhookPayload),
    ).toBe('mayus@x.com');
  });

  it('manda `buyer` cuando vienen los dos', () => {
    // Si algún día llegan ambos, el comprador es quien pagó.
    expect(
      correoDelComprador({
        data: {
          buyer: { email: 'comprador@x.com' },
          subscriber: { email: 'suscriptor@x.com' },
        },
      } as HotmartWebhookPayload),
    ).toBe('comprador@x.com');
  });

  it('sin ninguno de los dos, undefined y no una cadena vacía', () => {
    // Una cadena vacía casaría con cualquier `where` mal construido.
    expect(correoDelComprador({ data: {} } as HotmartWebhookPayload)).toBeUndefined();
    expect(correoDelComprador({} as HotmartWebhookPayload)).toBeUndefined();
  });
});

describe('el código de suscriptor', () => {
  it('en una CANCELACIÓN sale de `data.subscriber.code`', () => {
    // `data.subscription` existe en ese payload, pero solo con id y plan: no
    // trae suscriptor dentro. Ahí murió la búsqueda original.
    expect(codigoDeSuscriptor(CANCELACION)).toBe('AMEKND7I');
    expect(CANCELACION.data?.subscription?.subscriber).toBeUndefined();
  });

  it('en una compra sale de `data.subscription.subscriber.code`', () => {
    expect(codigoDeSuscriptor(COMPRA)).toBe('ABC123');
  });

  it('sin ninguno, undefined', () => {
    expect(codigoDeSuscriptor({ data: {} } as HotmartWebhookPayload)).toBeUndefined();
  });
});

describe('el caso completo: la cancelación ya encuentra al negocio', () => {
  it('con la forma nueva hay CON QUÉ buscar; con la vieja no había nada', () => {
    // Esto es exactamente lo que decidía que el evento se quedara huérfano.
    const viejoCorreo = CANCELACION.data?.buyer?.email;
    const viejoCodigo = CANCELACION.data?.subscription?.subscriber?.code;
    expect(viejoCorreo).toBeUndefined();
    expect(viejoCodigo).toBeUndefined();

    expect(correoDelComprador(CANCELACION)).toBeTruthy();
    expect(codigoDeSuscriptor(CANCELACION)).toBeTruthy();
  });
});
