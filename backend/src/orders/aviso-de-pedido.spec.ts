import { describe, it, expect } from 'vitest';
import { OwnerOrderAlertService } from './owner-order-alert.service';
import {
  lineaDeProductos,
  origenDelPedido,
  sinPictogramas,
} from './aviso-de-pedido';

/**
 * EL AVISO INTERNO TIENE QUE DECIR QUÉ SE PIDIÓ Y DE DÓNDE VIENE.
 *
 * Javier, con el pedido #YD6J7P de Nudo Cowork: «El mensaje que sale de
 * Clubify a NudoCowork solo dice esto, me gustaría que diga el pedido y de
 * dónde viene; en este caso se hizo desde el menú de Sala de Juntas».
 *
 * Ojo con no confundirlo con el mensaje de WhatsApp del pedido, que ya lleva
 * la oficina: este es el aviso que manda la PLATAFORMA al teléfono del
 * negocio, por SMS, cuando entra un pedido.
 *
 * Y por eso las pruebas de longitud y de caracteres no son decorado: cada
 * segmento lo paga el negocio en cada pedido, y un emoji lo parte a la mitad.
 *
 * No necesita base de datos.
 */

const MOCCA = { qty: 1, name: 'Mocca frío (Deslactosada)' };
const CAPUCHINO = { qty: 2, name: 'Capuchino' };
const SALA_DE_JUNTAS = { id: 'carta-sala', nombre: 'Sala de Juntas' };

function texto(pedido: Record<string, unknown>, whiteLabel: unknown = null) {
  const svc = new OwnerOrderAlertService({} as any, {} as any) as any;
  return svc.texto(
    {
      code: 'YD6J7P',
      total: 20000,
      fulfillment: 'DELIVERY',
      tableNumber: null,
      customer: { fullName: 'Javier Prueba' },
      ...pedido,
    },
    { currencySymbol: '$', whiteLabel },
  );
}

describe('el aviso interno de pedido nuevo', () => {
  it('dice qué se pidió', () => {
    const t = texto({ items: [MOCCA] });
    // Sin la tilde: la «í» no está en GSM-7 y multiplicaba por cuatro los
    // segmentos del SMS. Ver «los caracteres» en aviso-de-pedido.ts.
    expect(t).toContain('1x Mocca frio (Deslactosada)');
  });

  it('dice que viene de una OFICINA, que es lo que se reportó', () => {
    const t = texto({
      items: [MOCCA],
      deliveryAddress: { oficina: SALA_DE_JUNTAS, direccion: 'Sala de Juntas' },
    });
    expect(t).toContain('Oficina: Sala de Juntas');
    expect(t).not.toContain('Sede:');
  });

  it('dice de qué SEDE viene cuando el pedido tiene sede', () => {
    const t = texto({ items: [MOCCA], location: { name: 'Sambil Margarita' } });
    expect(t).toContain('Sede: Sambil Margarita');
    expect(t).not.toContain('Oficina:');
  });

  it('el menú general no inventa un origen', () => {
    const t = texto({ items: [MOCCA] });
    expect(t).not.toContain('Oficina:');
    expect(t).not.toContain('Sede:');
  });

  it('sigue diciendo lo de siempre: código, cliente, total, tipo y panel', () => {
    const t = texto({ items: [MOCCA] });
    expect(t).toContain('YD6J7P');
    expect(t).toContain('Javier Prueba');
    expect(t).toContain('$20.000');
    expect(t).toContain('Domicilio');
    expect(t).toContain('/app/orders');
  });

  it('un pedido sin artículos (payload viejo) no ensucia el mensaje', () => {
    const t = texto({});
    expect(t).not.toContain('undefined');
    expect(t).toContain('YD6J7P');
  });

  it('una MARCA BLANCA no ve Clubify por ningún lado, tampoco con oficina', () => {
    const t = texto(
      { items: [MOCCA], deliveryAddress: { oficina: SALA_DE_JUNTAS } },
      { appDomain: 'app.selleala.com', domain: 'selleala.com' },
    );
    expect(t).toContain('https://app.selleala.com/app/orders');
    expect(t.toLowerCase()).not.toContain('clubify');
  });
});

describe('la línea de productos', () => {
  it('lista los artículos con su cantidad', () => {
    expect(lineaDeProductos([MOCCA, CAPUCHINO])).toBe(
      '1x Mocca frio (Deslactosada), 2x Capuchino',
    );
  });

  it('un corte en el límite de una palabra no se lleva una de más', () => {
    // «Torre de pan» son 12 caracteres justos: el corte cae en el espacio
    // siguiente y antes se quedaba en «Torre de».
    expect(
      lineaDeProductos([{ qty: 1, name: 'Torre de pan artesanal' }], {
        topeNombre: 12,
      }),
    ).toBe('1x Torre de pan');
  });

  it('un pedido largo se resume en vez de dispararse', () => {
    const r = lineaDeProductos([MOCCA, CAPUCHINO, MOCCA, CAPUCHINO, MOCCA]);
    expect(r).toContain('y otros 3');
    expect(r.length).toBeLessThan(80);
  });

  it('no mete emojis: un solo pictograma parte el SMS a la mitad', () => {
    // Las promociones se guardan con un 🎁 delante del nombre.
    const r = lineaDeProductos([{ qty: 1, name: '🎁 2x1 en cafés' }]);
    expect(r).toBe('1x 2x1 en cafés');
    expect(/\p{Extended_Pictographic}/u.test(r)).toBe(false);
  });

  it('un nombre larguísimo se recorta sin dejar media palabra', () => {
    const r = lineaDeProductos([
      { qty: 1, name: 'Frappuccino de caramelo con crema y trocitos de galleta' },
    ]);
    expect(r.length).toBeLessThanOrEqual(40);
    expect(r.endsWith(' ')).toBe(false);
    expect(r).toContain('Frappuccino de caramelo');
  });

  it('sin artículos legibles no hay línea', () => {
    expect(lineaDeProductos(undefined)).toBe('');
    expect(lineaDeProductos([])).toBe('');
    expect(lineaDeProductos([{ qty: 1 }])).toBe('');
    expect(lineaDeProductos('no es una lista')).toBe('');
  });

  it('una cantidad rara no rompe la línea', () => {
    expect(lineaDeProductos([{ name: 'Capuchino' }])).toBe('1x Capuchino');
    expect(lineaDeProductos([{ qty: 'dos', name: 'Capuchino' }])).toBe('1x Capuchino');
  });
});

/**
 * LO QUE DE VERDAD SE PAGA: SEGMENTOS.
 *
 * Un SMS son 160 caracteres por segmento SOLO si todo está en GSM-7. Basta un
 * carácter fuera —una «í», una «ó», un emoji— para que pase a 16 bits y el
 * segmento se quede en 70. Por eso la garantía se mide en segmentos y no en
 * «longitud»: es lo único que se traduce en dinero.
 *
 * La tabla es la de GSM 03.38. Ojo con lo que SÍ entra: é, ù, ì, ò, à, ñ, ü,
 * ä, ö, å, æ, ø, ß, ç. Y lo que no: á, í, ó, ú.
 */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

function segmentosSms(texto: string): number {
  const esGsm = [...texto].every(
    (c) => GSM7.includes(c) || GSM7_EXT.includes(c),
  );
  if (!esGsm) return Math.ceil([...texto].length / 67) || 1;
  let unidades = 0;
  for (const c of texto) unidades += GSM7_EXT.includes(c) ? 2 : 1;
  return unidades <= 160 ? 1 : Math.ceil(unidades / 153);
}

describe('lo que el negocio paga por el aviso', () => {
  const PEDIDO_TIPICO = {
    items: [MOCCA, CAPUCHINO, { qty: 1, name: 'Té verde' }],
    deliveryAddress: { oficina: SALA_DE_JUNTAS },
  };

  it('el aviso entero cabe en 2 segmentos', () => {
    const t = texto(PEDIDO_TIPICO);
    expect(segmentosSms(t)).toBeLessThanOrEqual(2);
  });

  it('no queda ni un carácter fuera de GSM-7 puesto por nosotros', () => {
    const t = texto(PEDIDO_TIPICO);
    const fuera = [...t].filter(
      (c) => !GSM7.includes(c) && !GSM7_EXT.includes(c),
    );
    expect(fuera).toEqual([]);
  });

  it('la ñ, la é y la ü se respetan: esas SÍ están en GSM-7', () => {
    expect(lineaDeProductos([{ qty: 1, name: 'Piña café über' }])).toBe(
      '1x Piña café über',
    );
    // La ñ se queda porque está en GSM-7; la ó no está y se va. Las dos cosas
    // en el mismo nombre, que es como llegan de verdad.
    expect(origenDelPedido({ sede: { name: 'Barranquilla Peñón' } })).toBe(
      'Sede: Barranquilla Peñon',
    );
  });

  it('las tildes que rompen el SMS se quitan, en producto, oficina y sede', () => {
    expect(lineaDeProductos([{ qty: 1, name: 'Mocca frío' }])).toBe(
      '1x Mocca frio',
    );
    expect(origenDelPedido({ oficina: { nombre: 'Salón Príncipe' } })).toBe(
      'Oficina: Salon Principe',
    );
    expect(origenDelPedido({ sede: { name: 'Bogotá Centro' } })).toBe(
      'Sede: Bogota Centro',
    );
  });
});

describe('el origen del pedido', () => {
  it('la oficina manda sobre la sede', () => {
    expect(
      origenDelPedido({ oficina: { nombre: 'Sala de Juntas' }, sede: { name: 'Centro' } }),
    ).toBe('Oficina: Sala de Juntas');
  });

  it('sin oficina ni sede no hay etiqueta que alargue el mensaje', () => {
    expect(origenDelPedido({})).toBe('');
    expect(origenDelPedido({ oficina: null, sede: null })).toBe('');
    expect(origenDelPedido({ oficina: { nombre: '   ' } })).toBe('');
  });

  it('sinPictogramas deja el texto utilizable', () => {
    expect(sinPictogramas('🎁 2x1 en cafés')).toBe('2x1 en cafés');
    expect(sinPictogramas('Sala de Juntas')).toBe('Sala de Juntas');
  });
});
