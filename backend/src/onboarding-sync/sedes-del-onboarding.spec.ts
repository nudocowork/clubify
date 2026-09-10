import { describe, it, expect } from 'vitest';
import {
  indexarSedes,
  llaveDeSede,
  resolverOverridesDeProducto,
  resolverSede,
  resolverSedesDeProducto,
  type SedeConocida,
} from './sedes-del-onboarding';

/**
 * Lo que decide si un plato sale en la carta de un local.
 *
 * La prueba que manda es la última del primer bloque: **un onboarding que no
 * habla de sedes no toca nada**. Es el caso de todos los negocios de menú
 * único, que son la mayoría, y romperlo les borraría del panel lo que
 * configuraron a mano.
 */

const SEDES: SedeConocida[] = [
  { id: 'loc-cab', name: 'Sede Cabecera' },
  { id: 'loc-cac', name: 'Sede Cacique' },
  { id: 'loc-cen', name: 'Sede Centro' },
];

describe('resolverSedesDeProducto', () => {
  it('sin modo ni nombres devuelve null: el payload no habla de sedes', () => {
    expect(resolverSedesDeProducto({}, SEDES)).toBeNull();
  });

  it('TODAS explícito no deja filas', () => {
    expect(resolverSedesDeProducto({ locationMode: 'TODAS' }, SEDES)).toEqual({
      modo: 'TODAS',
      locationIds: [],
      desconocidas: [],
    });
  });

  it('casa los nombres del formulario con las sedes reales', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['Sede Cabecera', 'Sede Cacique'] },
      SEDES,
    );
    expect(r).toEqual({
      modo: 'SELECCIONADAS',
      locationIds: ['loc-cab', 'loc-cac'],
      desconocidas: [],
    });
  });

  it('ignora tildes, mayúsculas y espacios de más', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['  sede   CABECERA '] },
      [{ id: 'loc-cab', name: 'Sede Cábecera' }],
    );
    expect(r?.locationIds).toEqual(['loc-cab']);
  });

  it('no repite la sede si el formulario la trae dos veces', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['Sede Centro', 'sede centro'] },
      SEDES,
    );
    expect(r?.locationIds).toEqual(['loc-cen']);
  });

  it('un nombre que no existe se informa y no arrastra a los demás', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['Sede Cabecera', 'Sede Piedecuesta'] },
      SEDES,
    );
    expect(r?.locationIds).toEqual(['loc-cab']);
    expect(r?.desconocidas).toEqual(['Sede Piedecuesta']);
  });

  // El daño que este archivo existe para evitar: si el push de sedes falló o
  // alguien las renombró, SELECCIONADAS con cero sedes deja el producto fuera
  // de TODAS las cartas y nadie se entera hasta que un cliente escanea el QR.
  it('si NINGÚN nombre casa, el producto queda en TODAS y no desaparece', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['Sede Norte', 'Sede Sur'] },
      SEDES,
    );
    expect(r?.modo).toBe('TODAS');
    expect(r?.locationIds).toEqual([]);
    expect(r?.desconocidas).toEqual(['Sede Norte', 'Sede Sur']);
  });

  it('lista vacía = el formulario no eligió ninguna: se vende en todas', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: [] },
      SEDES,
    );
    expect(r?.modo).toBe('TODAS');
  });

  it('sin sedes creadas todavía, nada casa y el producto se ve', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['Sede Cabecera'] },
      [],
    );
    expect(r?.modo).toBe('TODAS');
    expect(r?.desconocidas).toEqual(['Sede Cabecera']);
  });

  // Marcar las tres casillas de hoy NO es «y también las que abran mañana».
  it('marcar todas las sedes de hoy sigue siendo SELECCIONADAS', () => {
    const r = resolverSedesDeProducto(
      {
        locationMode: 'SELECCIONADAS',
        locationNames: ['Sede Cabecera', 'Sede Cacique', 'Sede Centro'],
      },
      SEDES,
    );
    expect(r?.modo).toBe('SELECCIONADAS');
    expect(r?.locationIds).toHaveLength(3);
  });

  it('nombres sin modo se entienden como selección', () => {
    const r = resolverSedesDeProducto({ locationNames: ['Sede Centro'] }, SEDES);
    expect(r?.modo).toBe('SELECCIONADAS');
    expect(r?.locationIds).toEqual(['loc-cen']);
  });
});

describe('llaveDeSede', () => {
  it('normaliza para comparar, no para mostrar', () => {
    expect(llaveDeSede('Sede Cabecera')).toBe('sede cabecera');
    expect(llaveDeSede('SEDE  CABECERA')).toBe('sede cabecera');
    expect(llaveDeSede('Sede — Cabecera')).toBe('sede cabecera');
    expect(llaveDeSede(null)).toBe('');
  });
});

describe('resolverOverridesDeProducto', () => {
  const ov = (locationOverrides: unknown) =>
    resolverOverridesDeProducto({ locationOverrides }, SEDES);

  it('sin la clave no hay nada que escribir', () => {
    expect(resolverOverridesDeProducto({}, SEDES)).toEqual({
      overrides: [],
      desconocidas: [],
    });
  });

  it('recoge precio, foto, texto y agotado de cada sede', () => {
    const r = ov([
      {
        name: 'Sede Cabecera',
        price: 25000,
        imageUrl: 'https://cdn/cesta.jpg',
        description: 'En cesta',
      },
      { name: 'Sede Cacique', price: 28000, isAvailable: false },
    ]);
    expect(r.overrides).toEqual([
      {
        locationId: 'loc-cab',
        price: 25000,
        imageUrl: 'https://cdn/cesta.jpg',
        description: 'En cesta',
      },
      { locationId: 'loc-cac', price: 28000, isAvailable: false },
    ]);
  });

  // «Sin filas = como el producto». Una línea que no cambia nada no es una fila.
  it('una sede que no cambia nada no genera fila', () => {
    expect(ov([{ name: 'Sede Centro' }]).overrides).toEqual([]);
    expect(ov([{ name: 'Sede Centro', price: '', description: '  ' }]).overrides).toEqual(
      [],
    );
  });

  // Una data: URL en base64 no se puede servir desde el menú y además infla la
  // fila a varios MB. Es el error que convirtió QrPoster en el 77% de la base.
  it('descarta imágenes que no son una URL descargable', () => {
    expect(
      ov([{ name: 'Sede Centro', imageUrl: 'data:image/png;base64,AAAA' }])
        .overrides,
    ).toEqual([]);
  });

  it('un precio que no es número se ignora, no rompe el sync', () => {
    expect(ov([{ name: 'Sede Centro', price: 'Consultar' }]).overrides).toEqual([]);
  });

  it('un precio de 0 es un precio', () => {
    expect(ov([{ name: 'Sede Centro', price: 0 }]).overrides).toEqual([
      { locationId: 'loc-cen', price: 0 },
    ]);
  });

  it('un precio negativo no', () => {
    expect(ov([{ name: 'Sede Centro', price: -5 }]).overrides).toEqual([]);
  });

  it('una sede que no existe se informa y no arrastra a las demás', () => {
    const r = ov([
      { name: 'Sede Piedecuesta', price: 9000 },
      { name: 'Sede Centro', price: 9000 },
    ]);
    expect(r.overrides).toEqual([{ locationId: 'loc-cen', price: 9000 }]);
    expect(r.desconocidas).toEqual(['Sede Piedecuesta']);
  });

  it('dos líneas para la misma sede: manda la primera', () => {
    const r = ov([
      { name: 'Sede Centro', price: 1000 },
      { name: 'sede centro', price: 2000 },
    ]);
    expect(r.overrides).toEqual([{ locationId: 'loc-cen', price: 1000 }]);
  });

  it('«disponible» solo cuenta si viene como booleano de verdad', () => {
    expect(ov([{ name: 'Sede Centro', isAvailable: 'si' }]).overrides).toEqual([]);
    expect(ov([{ name: 'Sede Centro', isAvailable: true }]).overrides).toEqual([
      { locationId: 'loc-cen', isAvailable: true },
    ]);
  });

  it('aguanta basura sin reventar', () => {
    expect(ov([null, 'texto', 42, { sinNombre: 1 }]).overrides).toEqual([]);
    expect(resolverOverridesDeProducto({ locationOverrides: 'no es lista' }, SEDES))
      .toEqual({ overrides: [], desconocidas: [] });
  });
});

describe('el id del Onboarding manda sobre el nombre', () => {
  // Las sedes ya sincronizadas llevan el id que les puso el Onboarding.
  const CON_ID: SedeConocida[] = [
    { id: 'loc-cab', name: 'Sede Cabecera', externalId: 'ob-1' },
    { id: 'loc-cac', name: 'Sede Cacique', externalId: 'ob-2' },
    { id: 'loc-cen', name: 'Sede Centro', externalId: 'ob-3' },
  ];

  it('casa por externalId aunque el nombre no se parezca', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationExternalIds: ['ob-1', 'ob-2'] },
      CON_ID,
    );
    expect(r?.locationIds).toEqual(['loc-cab', 'loc-cac']);
  });

  // El daño que este campo existe para evitar: sin él, corregir el nombre en el
  // formulario creaba una SEGUNDA sede y repartía los productos entre las dos.
  it('renombrar la sede en el formulario sigue apuntando a la misma sede', () => {
    const r = resolverSedesDeProducto(
      {
        locationMode: 'SELECCIONADAS',
        locationExternalIds: ['ob-2'],
        locationNames: ['Cacique Mall'],
      },
      CON_ID,
    );
    expect(r?.locationIds).toEqual(['loc-cac']);
    expect(r?.desconocidas).toEqual([]);
  });

  // Compatibilidad: las 161 sedes de producción se crearon antes del id.
  it('sin externalId todavía casa por nombre', () => {
    const r = resolverSedesDeProducto(
      { locationMode: 'SELECCIONADAS', locationNames: ['Sede Centro'] },
      SEDES,
    );
    expect(r?.locationIds).toEqual(['loc-cen']);
  });

  // Un id que no conocemos es una sede NUEVA. Engancharla a otra que se llame
  // parecido le metería los productos a la sede equivocada.
  it('un externalId desconocido no se cae al nombre de otra sede', () => {
    const r = resolverSedesDeProducto(
      {
        locationMode: 'SELECCIONADAS',
        locationExternalIds: ['ob-nueva'],
      },
      CON_ID,
    );
    expect(r?.modo).toBe('TODAS');
    expect(r?.desconocidas).toEqual(['#ob-nueva']);
  });

  it('no duplica cuando la misma sede llega por id y por nombre', () => {
    const r = resolverSedesDeProducto(
      {
        locationMode: 'SELECCIONADAS',
        locationExternalIds: ['ob-3'],
        locationNames: ['Sede Centro'],
      },
      CON_ID,
    );
    expect(r?.locationIds).toEqual(['loc-cen']);
  });

  it('los cambios por sede también casan por externalId', () => {
    const r = resolverOverridesDeProducto(
      {
        locationOverrides: [
          { externalId: 'ob-2', price: 28000, imageUrl: 'https://cdn/plato.jpg' },
        ],
      },
      CON_ID,
    );
    expect(r.overrides).toEqual([
      { locationId: 'loc-cac', price: 28000, imageUrl: 'https://cdn/plato.jpg' },
    ]);
  });

  it('una sede sin id del Onboarding se identifica por su nombre', () => {
    const mixtas: SedeConocida[] = [
      { id: 'loc-vieja', name: 'Principal', externalId: null },
      { id: 'loc-cab', name: 'Sede Cabecera', externalId: 'ob-1' },
    ];
    const r = resolverOverridesDeProducto(
      { locationOverrides: [{ name: 'Principal', price: 100 }] },
      mixtas,
    );
    expect(r.overrides).toEqual([{ locationId: 'loc-vieja', price: 100 }]);
  });
});

describe('resolverSede', () => {
  const idx = indexarSedes([
    { id: 'a', name: 'Sede Norte', externalId: 'x1' },
    { id: 'b', name: 'Sede Sur', externalId: null },
  ]);

  it('encuentra por id, por nombre, y devuelve null si no hay nada', () => {
    expect(resolverSede({ externalId: 'x1' }, idx)).toBe('a');
    expect(resolverSede({ name: 'sede sur' }, idx)).toBe('b');
    expect(resolverSede({ name: 'Sede Este' }, idx)).toBeNull();
    expect(resolverSede({}, idx)).toBeNull();
  });

  it('con id conocido ignora el nombre que venga', () => {
    expect(resolverSede({ externalId: 'x1', name: 'Sede Sur' }, idx)).toBe('a');
  });
});
