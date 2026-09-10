import { describe, it, expect } from 'vitest';
import {
  catalogoDeSede,
  indexarFilas,
  resolverEnSede,
  sedesDeProducto,
  seVendeEn,
  type FilaDeSede,
} from './producto-en-sede';

/**
 * Lo que ve el cliente al escanear el QR de un local.
 *
 * La prueba que manda es la primera: **un negocio que comparte carta no cambia
 * nada**. Son 25 de los 26 negocios con más de una sede, y ninguno pidió esto.
 * Si alguna vez se rompe, se rompe para casi todos los que tienen sedes.
 */

const prod = (
  id: string,
  extra: Partial<{
    locationMode: string | null;
    basePrice: unknown;
    isAvailable: boolean | null;
    stock: number | null;
    imageUrl: string | null;
    description: string | null;
  }> = {},
) => ({
  id,
  locationMode: 'TODAS' as string | null,
  basePrice: 10,
  isAvailable: true as boolean | null,
  stock: null as number | null,
  imageUrl: 'catalogo.jpg' as string | null,
  description: 'La del catálogo' as string | null,
  ...extra,
});

const fila = (
  productId: string,
  locationId: string,
  extra: Partial<FilaDeSede> = {},
): FilaDeSede => ({
  productId,
  locationId,
  selected: true,
  ...extra,
});

describe('el que comparte carta no cambia nada', () => {
  const carta = [prod('cafe'), prod('tostada'), prod('zumo')];

  it('sin ninguna fila, la sede vende el catálogo entero', () => {
    const r = catalogoDeSede(carta, 'centro', []);
    expect(r.map((x) => x.producto.id)).toEqual(['cafe', 'tostada', 'zumo']);
  });

  it('sin filas, los precios son los de siempre', () => {
    const r = catalogoDeSede(carta, 'centro', []);
    expect(r.every((x) => x.price === 10)).toBe(true);
    expect(r.every((x) => !x.personalizado)).toBe(true);
  });

  it('una sede que se abre MAÑANA vende lo mismo, sin tocar nada', () => {
    const hoy = catalogoDeSede(carta, 'centro', []);
    const manana = catalogoDeSede(carta, 'sede-nueva-de-manana', []);
    expect(manana.map((x) => x.producto.id)).toEqual(
      hoy.map((x) => x.producto.id),
    );
  });

  it('un modo viejo o corrupto se trata como «todas»: ante la duda, se vende', () => {
    const raro = [prod('cafe', { locationMode: null }), prod('te', { locationMode: 'VETE_A_SABER' })];
    const r = catalogoDeSede(raro, 'centro', []);
    expect(r).toHaveLength(2);
  });
});

describe('«todas» no es «todas las casillas marcadas»', () => {
  it('en TODAS, la sede nueva entra sola', () => {
    const p = prod('cafe', { locationMode: 'TODAS' });
    expect(seVendeEn(p, 'sede-nueva', indexarFilas([]))).toBe(true);
  });

  it('en SELECCIONADAS, la sede nueva NO entra sola', () => {
    const p = prod('cafe', { locationMode: 'SELECCIONADAS' });
    const filas = [fila('cafe', 'centro'), fila('cafe', 'norte')];
    expect(seVendeEn(p, 'centro', indexarFilas(filas))).toBe(true);
    expect(seVendeEn(p, 'sede-nueva', indexarFilas(filas))).toBe(false);
  });

  it('en SELECCIONADAS, una casilla desmarcada no vende', () => {
    const p = prod('cafe', { locationMode: 'SELECCIONADAS' });
    const filas = [fila('cafe', 'centro', { selected: false })];
    expect(seVendeEn(p, 'centro', indexarFilas(filas))).toBe(false);
  });

  it('el panel enseña «todas» como estado, no como lista de sedes', () => {
    expect(sedesDeProducto(prod('cafe'), [])).toBeNull();
    expect(
      sedesDeProducto(prod('cafe', { locationMode: 'SELECCIONADAS' }), [
        fila('cafe', 'centro'),
        fila('cafe', 'norte', { selected: false }),
        fila('otro', 'sur'),
      ]),
    ).toEqual(['centro']);
  });
});

describe('precio propio de una sede', () => {
  it('sin precio propio, cobra el del producto', () => {
    const r = resolverEnSede(prod('cafe', { basePrice: 12 }), 'centro', indexarFilas([]));
    expect(r.price).toBe(12);
    expect(r.personalizado).toBe(false);
  });

  it('con precio propio, cobra el de la sede', () => {
    const r = resolverEnSede(
      prod('cafe', { basePrice: 12 }),
      'centro',
      indexarFilas([fila('cafe', 'centro', { price: 15 })]),
    );
    expect(r.price).toBe(15);
    expect(r.personalizado).toBe(true);
  });

  it('el precio de una sede NO se le aplica a otra', () => {
    const filas = indexarFilas([fila('cafe', 'centro', { price: 15 })]);
    expect(resolverEnSede(prod('cafe'), 'norte', filas).price).toBe(10);
  });

  it('cambiar el precio base lo hereda la sede que no personalizó', () => {
    const filas = indexarFilas([fila('cafe', 'centro', { isAvailable: false })]);
    // La sede tiene fila, pero sin precio: sigue el del producto.
    expect(resolverEnSede(prod('cafe', { basePrice: 99 }), 'centro', filas).price).toBe(99);
  });

  it('un precio de 0 es un precio, no un «sin precio»', () => {
    const r = resolverEnSede(
      prod('cafe'),
      'centro',
      indexarFilas([fila('cafe', 'centro', { price: 0 })]),
    );
    expect(r.price).toBe(0);
  });

  it('un precio corrupto cae al del producto, no a cero', () => {
    const r = resolverEnSede(
      prod('cafe', { basePrice: 10 }),
      'centro',
      indexarFilas([fila('cafe', 'centro', { price: 'no soy un número' })]),
    );
    expect(r.price).toBe(10);
  });
});

describe('agotado', () => {
  it('agotado solo en una sede', () => {
    const filas = indexarFilas([fila('cafe', 'centro', { isAvailable: false })]);
    expect(resolverEnSede(prod('cafe'), 'centro', filas).isAvailable).toBe(false);
    expect(resolverEnSede(prod('cafe'), 'norte', filas).isAvailable).toBe(true);
  });

  it('agotado en general gana: una sede no puede vender lo que el negocio apagó', () => {
    const p = prod('cafe', { isAvailable: false });
    const filas = indexarFilas([fila('cafe', 'centro', { isAvailable: true })]);
    expect(resolverEnSede(p, 'centro', filas).isAvailable).toBe(false);
  });

  it('el stock de la sede manda sobre el del producto', () => {
    const p = prod('cafe', { stock: 100 });
    const filas = indexarFilas([fila('cafe', 'centro', { stock: 3 })]);
    expect(resolverEnSede(p, 'centro', filas).stock).toBe(3);
    expect(resolverEnSede(p, 'norte', filas).stock).toBe(100);
  });
});

describe('sin sede en la URL se ve todo', () => {
  it('el enlace general del negocio enseña el catálogo entero', () => {
    const carta = [
      prod('cafe', { locationMode: 'SELECCIONADAS' }),
      prod('tostada'),
    ];
    const r = catalogoDeSede(carta, null, [fila('cafe', 'centro')]);
    expect(r).toHaveLength(2);
  });

  it('sin sede, los precios son los de base aunque haya filas', () => {
    const r = catalogoDeSede([prod('cafe')], null, [
      fila('cafe', 'centro', { price: 99 }),
    ]);
    expect(r[0].price).toBe(10);
  });
});

describe('un caso completo', () => {
  // Una cafetería con 3 sedes: el centro hace repostería propia y cobra más.
  const carta = [
    prod('cafe', { basePrice: 8 }),
    prod('tostada', { basePrice: 12 }),
    prod('tarta', { basePrice: 20, locationMode: 'SELECCIONADAS' }),
  ];
  const filas = [
    fila('tarta', 'centro'),
    fila('cafe', 'centro', { price: 10 }),
    fila('tostada', 'norte', { isAvailable: false }),
  ];

  it('el centro: tiene tarta y el café le cuesta más', () => {
    const r = catalogoDeSede(carta, 'centro', filas);
    expect(r.map((x) => [x.producto.id, x.price])).toEqual([
      ['cafe', 10],
      ['tostada', 12],
      ['tarta', 20],
    ]);
  });

  it('el norte: sin tarta, y la tostada agotada', () => {
    const r = catalogoDeSede(carta, 'norte', filas);
    expect(r.map((x) => x.producto.id)).toEqual(['cafe', 'tostada']);
    expect(r.find((x) => x.producto.id === 'tostada')!.isAvailable).toBe(false);
    expect(r.find((x) => x.producto.id === 'cafe')!.price).toBe(8);
  });

  it('la sede que abran mañana: café y tostada, precios de base, sin tarta', () => {
    const r = catalogoDeSede(carta, 'sede-de-manana', filas);
    expect(r.map((x) => [x.producto.id, x.price])).toEqual([
      ['cafe', 8],
      ['tostada', 12],
    ]);
  });
});

describe('foto y texto propios de la sede', () => {
  // La misma hamburguesa servida en cesta en una sede y en plato en la otra.
  // Si el QR de Cacique enseña la foto de Cabecera, el cliente pide una cosa
  // y le llega otra — que es exactamente la queja que originó todo esto.
  it('la sede que tiene foto propia enseña la suya', () => {
    const r = resolverEnSede(prod('burger'), 'cacique', indexarFilas([
      fila('burger', 'cacique', { imageUrl: 'cacique.jpg' }),
    ]));
    expect(r.imageUrl).toBe('cacique.jpg');
  });

  it('la sede que no la tiene hereda la del catálogo', () => {
    const r = resolverEnSede(prod('burger'), 'centro', indexarFilas([
      fila('burger', 'centro', { price: 25000 }),
    ]));
    expect(r.imageUrl).toBe('catalogo.jpg');
    expect(r.description).toBe('La del catálogo');
  });

  it('el texto propio de la sede reemplaza al del catálogo', () => {
    const r = resolverEnSede(prod('burger'), 'cabecera', indexarFilas([
      fila('burger', 'cabecera', { description: 'Con papas de la casa' }),
    ]));
    expect(r.description).toBe('Con papas de la casa');
  });

  // Esta es la razón de normalizar la cadena vacía a null al escribir: quien
  // borra el texto de una sede quiere volver al del catálogo, no dejar el
  // producto mudo.
  it('null vuelve al catálogo, no deja el producto sin texto', () => {
    const r = resolverEnSede(prod('burger'), 'cabecera', indexarFilas([
      fila('burger', 'cabecera', { description: null, imageUrl: null }),
    ]));
    expect(r.description).toBe('La del catálogo');
    expect(r.imageUrl).toBe('catalogo.jpg');
  });

  it('un producto sin foto en el catálogo no inventa ninguna', () => {
    const r = resolverEnSede(
      prod('burger', { imageUrl: null }),
      'centro',
      indexarFilas([]),
    );
    expect(r.imageUrl).toBeNull();
  });

  it('una sede que solo cambia la foto ya cuenta como personalizada', () => {
    const r = resolverEnSede(prod('burger'), 'cacique', indexarFilas([
      fila('burger', 'cacique', { imageUrl: 'cacique.jpg' }),
    ]));
    expect(r.personalizado).toBe(true);
  });

  it('una fila que no cambia nada NO cuenta como personalizada', () => {
    const r = resolverEnSede(prod('burger'), 'cacique', indexarFilas([
      fila('burger', 'cacique'),
    ]));
    expect(r.personalizado).toBe(false);
  });

  it('sin sede en la URL se ve el catálogo, no lo de ninguna sede', () => {
    const r = resolverEnSede(prod('burger'), null, indexarFilas([
      fila('burger', 'cacique', {
        imageUrl: 'cacique.jpg',
        description: 'En plato',
      }),
    ]));
    expect(r.imageUrl).toBe('catalogo.jpg');
    expect(r.description).toBe('La del catálogo');
  });
});
