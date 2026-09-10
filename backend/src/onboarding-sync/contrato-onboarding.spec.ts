import { describe, it, expect } from 'vitest';
import {
  resolverOverridesDeProducto,
  resolverSedesDeProducto,
  type SedeConocida,
} from './sedes-del-onboarding';

/**
 * La carga REAL que emite el Onboarding, contra el resolutor de Clubify.
 *
 * Copiada de `api/_lib/clubifyMap.js` (Documentos/Unboarding) el 2026-09-10:
 * `externalId: 'ob-' + <uid del formulario>`, `locationExternalIds` con esos
 * mismos ids y `locationOverrides` con su `externalId`.
 *
 * Existe porque las dos mitades se escribieron por separado y «casan» solo
 * mientras nadie cambie un nombre de campo. Si alguien renombra algo de un
 * lado, esto se pone en rojo antes de que un negocio real vea media carta.
 */

// Lo que quedaría en Clubify tras el PUT /sync/locations de ellos.
const SEDES: SedeConocida[] = [
  { id: 'loc-a', name: 'Sede Cabecera', externalId: 'ob-uid1' },
  { id: 'loc-b', name: 'Sede Cacique', externalId: 'ob-uid2' },
  { id: 'loc-c', name: 'Sede Centro', externalId: 'ob-uid3' },
];

// La Hamburguesa BBQ del ejemplo, tal y como la manda su mapeo.
const HAMBURGUESA = {
  name: 'Hamburguesa BBQ',
  basePrice: 25000,
  categoryName: 'Hamburguesas',
  locationMode: 'SELECCIONADAS',
  locationExternalIds: ['ob-uid1', 'ob-uid2'],
  locationOverrides: [
    { externalId: 'ob-uid1', price: 25000 },
    { externalId: 'ob-uid2', price: 28000, imageUrl: 'https://cdn/plato.jpg' },
  ],
};

describe('la carga del Onboarding contra el resolutor de Clubify', () => {
  it('la Hamburguesa BBQ se vende en Cabecera y Cacique, no en Centro', () => {
    const donde = resolverSedesDeProducto(HAMBURGUESA, SEDES);
    expect(donde?.modo).toBe('SELECCIONADAS');
    expect(donde?.locationIds).toEqual(['loc-a', 'loc-b']);
    expect(donde?.desconocidas).toEqual([]);
  });

  it('cada sede se queda con su precio, y Cacique además con su foto', () => {
    const { overrides, desconocidas } = resolverOverridesDeProducto(
      HAMBURGUESA,
      SEDES,
    );
    expect(desconocidas).toEqual([]);
    expect(overrides).toEqual([
      { locationId: 'loc-a', price: 25000 },
      { locationId: 'loc-b', price: 28000, imageUrl: 'https://cdn/plato.jpg' },
    ]);
  });

  it('un producto en todas las sedes no genera filas', () => {
    const limonada = {
      name: 'Limonada',
      basePrice: 8000,
      locationMode: 'TODAS',
    };
    expect(resolverSedesDeProducto(limonada, SEDES)?.modo).toBe('TODAS');
    expect(resolverOverridesDeProducto(limonada, SEDES).overrides).toEqual([]);
  });

  // El orden del contrato: si el PUT /sync/locations no llegó, las sedes no
  // existen todavía. El producto tiene que VERSE, no desaparecer de la carta.
  it('si las sedes no llegaron primero, el producto se ve igual', () => {
    const donde = resolverSedesDeProducto(HAMBURGUESA, []);
    expect(donde?.modo).toBe('TODAS');
    expect(donde?.desconocidas).toEqual(['#ob-uid1', '#ob-uid2']);
  });

  // El motivo de que el id mande: el cliente corrige el nombre en el formulario.
  it('renombrar una sede en el formulario no la duplica ni la pierde', () => {
    const renombrada: SedeConocida[] = [
      { id: 'loc-a', name: 'Cabecera Mall', externalId: 'ob-uid1' },
      ...SEDES.slice(1),
    ];
    const donde = resolverSedesDeProducto(HAMBURGUESA, renombrada);
    expect(donde?.locationIds).toEqual(['loc-a', 'loc-b']);
  });
});
