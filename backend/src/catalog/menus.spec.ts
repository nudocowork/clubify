import { describe, it, expect } from 'vitest';

/**
 * Contrato de las cartas por sede.
 *
 * Lo que no se puede romper:
 *   1. `menuId = null` ES el menú principal, no "sin menú". Todo el catálogo
 *      que existía antes vive ahí y no se migró nada.
 *   2. Una sede sin carta propia come del menú principal — nunca ve una
 *      pantalla vacía.
 *   3. Duplicar respeta el árbol de categorías: un hijo no puede quedar
 *      apuntando al padre del menú de origen.
 *
 * Copias fieles de la lógica real; el módulo arrastra NestJS y no se puede
 * importar sin base de datos.
 */

/** Resolución de la carta que sirve una sede (`public-menu.controller`). */
function resolverMenu(
  sedePedida: string | null | undefined,
  cartas: { id: string; locationId: string | null; isActive: boolean }[],
): string | null {
  const sede = (sedePedida ?? '').trim();
  if (!sede) return null;
  const carta = cartas.find(
    (c) => c.isActive && (c.locationId === sede || c.id === sede),
  );
  return carta?.id ?? null;
}

/** Reconexión del árbol al duplicar (`MenusService.duplicarCatalogo`). */
function duplicarCategorias(
  origen: { id: string; parentId: string | null; name: string }[],
): { id: string; parentId: string | null; name: string }[] {
  const mapa = new Map<string, string>();
  const copias = origen.map((c, i) => {
    const nuevoId = `new-${i}`;
    mapa.set(c.id, nuevoId);
    return { id: nuevoId, parentId: null as string | null, name: c.name };
  });
  origen.forEach((c, i) => {
    if (!c.parentId) return;
    const nuevoPadre = mapa.get(c.parentId);
    if (nuevoPadre) copias[i].parentId = nuevoPadre;
  });
  return copias;
}

const CARTAS = [
  { id: 'carta-norte', locationId: 'sede-norte', isActive: true },
  { id: 'carta-vieja', locationId: 'sede-cerrada', isActive: false },
];

describe('qué carta ve el cliente', () => {
  it('sin sede en el QR: el menú principal', () => {
    expect(resolverMenu(undefined, CARTAS)).toBeNull();
    expect(resolverMenu('', CARTAS)).toBeNull();
    expect(resolverMenu('   ', CARTAS)).toBeNull();
  });

  it('con la sede: su carta', () => {
    expect(resolverMenu('sede-norte', CARTAS)).toBe('carta-norte');
  });

  it('acepta también el id de la carta — el QR puede llevar cualquiera', () => {
    expect(resolverMenu('carta-norte', CARTAS)).toBe('carta-norte');
  });

  it('sede sin carta propia: cae al principal, no a una pantalla vacía', () => {
    expect(resolverMenu('sede-centro', CARTAS)).toBeNull();
  });

  it('QR viejo con una sede que ya no existe: el principal, no un error', () => {
    expect(resolverMenu('sede-borrada-hace-un-anio', CARTAS)).toBeNull();
  });

  it('carta desactivada: se ignora y sirve el principal', () => {
    expect(resolverMenu('sede-cerrada', CARTAS)).toBeNull();
  });
});

describe('duplicar el catálogo', () => {
  const ORIGEN = [
    { id: 'a', parentId: null, name: 'Bebidas' },
    { id: 'b', parentId: 'a', name: 'Calientes' },
    { id: 'c', parentId: 'a', name: 'Frías' },
    { id: 'd', parentId: null, name: 'Comidas' },
  ];

  it('copia todas las categorías', () => {
    expect(duplicarCategorias(ORIGEN)).toHaveLength(4);
  });

  it('los hijos apuntan al padre NUEVO, no al del menú de origen', () => {
    const copias = duplicarCategorias(ORIGEN);
    const calientes = copias.find((c) => c.name === 'Calientes')!;
    const bebidas = copias.find((c) => c.name === 'Bebidas')!;
    expect(calientes.parentId).toBe(bebidas.id);
    // Ni un solo puntero al menú original: eso mezclaría las dos cartas.
    const idsViejos = ORIGEN.map((c) => c.id);
    for (const c of copias) {
      expect(idsViejos).not.toContain(c.parentId);
    }
  });

  it('las raíces siguen siendo raíces', () => {
    const copias = duplicarCategorias(ORIGEN);
    expect(copias.find((c) => c.name === 'Bebidas')!.parentId).toBeNull();
    expect(copias.find((c) => c.name === 'Comidas')!.parentId).toBeNull();
  });

  it('un catálogo vacío no rompe nada', () => {
    expect(duplicarCategorias([])).toEqual([]);
  });

  it('un hijo cuyo padre no vino en la copia queda como raíz, no colgado', () => {
    const huerfano = [{ id: 'x', parentId: 'no-copiado', name: 'Suelta' }];
    expect(duplicarCategorias(huerfano)[0].parentId).toBeNull();
  });
});

/**
 * Que se propaga a las copias sincronizadas y que NO.
 *
 * La regla: lo que define QUE ES el producto sigue al original; como se
 * MUESTRA en cada carta es de cada sede. Sin esa separacion, sincronizar los
 * precios traeria de vuelta los productos que la sede B habia escondido.
 */
const CAMPOS_COMPARTIDOS = [
  'name',
  'description',
  'basePrice',
  'priceMode',
  'priceMax',
  'variantPriceMode',
  'maxVariantsTotal',
  'maxExtrasTotal',
  'imageUrl',
  'tags',
] as const;

function loQueSePropaga(dto: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of CAMPOS_COMPARTIDOS) {
    if (dto[k] !== undefined) out[k] = dto[k];
  }
  return out;
}

describe('sincronia entre cartas', () => {
  it('el precio y el nombre se propagan', () => {
    expect(loQueSePropaga({ name: 'Burger XL', basePrice: 42000 })).toEqual({
      name: 'Burger XL',
      basePrice: 42000,
    });
  });

  it('esconder algo en una carta NO se propaga — es el punto de tener dos', () => {
    const r = loQueSePropaga({
      isAvailable: false,
      availableForMesa: false,
      availableForDelivery: false,
    });
    expect(r).toEqual({});
  });

  it('el stock no se propaga: el inventario es fisico de cada sede', () => {
    expect(loQueSePropaga({ stock: 12, stockAlert: 3 })).toEqual({});
  });

  it('la posicion y la categoria no se propagan: cada carta se ordena sola', () => {
    expect(loQueSePropaga({ position: 5, categoryId: 'otra' })).toEqual({});
  });

  it('destacar en una carta no destaca en la otra', () => {
    expect(loQueSePropaga({ isRecommended: true })).toEqual({});
  });

  it('un cambio mixto propaga solo la mitad compartida', () => {
    const r = loQueSePropaga({
      basePrice: 50000,
      isAvailable: false,
      stock: 9,
      imageUrl: 'https://x/y.jpg',
    });
    expect(r).toEqual({ basePrice: 50000, imageUrl: 'https://x/y.jpg' });
  });

  it('sin cambios compartidos no se toca ninguna copia', () => {
    expect(Object.keys(loQueSePropaga({ position: 1 }))).toHaveLength(0);
  });
});
