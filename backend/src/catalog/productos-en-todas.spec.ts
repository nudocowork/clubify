import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { bdVacia, crearPrismaFalso, type BaseDeDatos } from './catalogo-prisma-falso';
import type { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * «En todas las cartas» al crear, editar y eliminar un producto (pedido de
 * Nudo, 2026-10-12: una carta por sala). Llama al `ProductsService` real contra
 * un Prisma en memoria — no a una copia de su lógica.
 */

const DUENO = { role: 'TENANT_OWNER', tenantId: 't1' } as unknown as AuthUser;

let bd: BaseDeDatos;
let svc: ProductsService;
let transacciones: { opciones: any; consultas: number }[];

function montar() {
  const doble = crearPrismaFalso(bd);
  svc = new ProductsService(doble.prisma);
  transacciones = doble.transacciones;
}

/** Negocio con el menú principal y dos salas. La categoría «Bebidas» existe en
 *  el principal y en la Sala 1 (renombrada, mismo slug); la Sala 2 no la tiene. */
function negocioConDosSalas() {
  bd = bdVacia();
  bd.tenant.push({ id: 't1', sedeMenuEnabled: false }, { id: 't2', sedeMenuEnabled: false });
  bd.menu.push(
    { id: 'sala1', tenantId: 't1', name: 'Sala 1', position: 1, createdAt: new Date(1) },
    { id: 'sala2', tenantId: 't1', name: 'Sala 2', position: 2, createdAt: new Date(2) },
    // Carta de OTRO negocio: no puede recibir nada.
    { id: 'ajena', tenantId: 't2', name: 'Ajena', position: 1, createdAt: new Date(3) },
  );
  bd.category.push(
    { id: 'bebidas-p', tenantId: 't1', menuId: null, parentId: null, slug: 'bebidas', name: 'Bebidas', position: 0, imageUrl: 'https://img/bebidas.jpg' },
    { id: 'bebidas-s1', tenantId: 't1', menuId: 'sala1', parentId: null, slug: 'bebidas', name: 'Bebidas frías', position: 0 },
    { id: 'postres-s2', tenantId: 't1', menuId: 'sala2', parentId: null, slug: 'postres', name: 'Postres', position: 4 },
    { id: 'bebidas-ajena', tenantId: 't2', menuId: null, parentId: null, slug: 'bebidas', name: 'Bebidas', position: 0 },
  );
  montar();
}

const NUEVO = {
  name: 'Limonada',
  basePrice: 8000,
  stock: 12,
  variants: [{ name: 'Grande', priceDelta: 2000 }],
  extras: [{ name: 'Hielo', price: 0 }],
};

describe('crear un producto «en todas las cartas»', () => {
  beforeEach(negocioConDosSalas);

  it('sin alcance lo crea solo en la carta actual (lo de siempre)', async () => {
    await svc.create(DUENO, { ...NUEVO, menuId: 'sala1', categoryId: 'bebidas-s1' });
    expect(bd.product).toHaveLength(1);
    expect(bd.product[0].menuId).toBe('sala1');
  });

  it('lo crea en cada carta, enganchado al del menú principal', async () => {
    const r: any = await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: 'bebidas-p' });

    expect(bd.product).toHaveLength(3);
    const original = bd.product.find((p) => p.menuId === null)!;
    expect(original.sourceProductId).toBeNull();
    for (const sala of ['sala1', 'sala2']) {
      const copia = bd.product.find((p) => p.menuId === sala)!;
      expect(copia.sourceProductId).toBe(original.id);
      expect(copia.syncWithSource).toBe(true);
      expect(copia.name).toBe('Limonada');
      expect(bd.productVariant.filter((v) => v.productId === copia.id)).toHaveLength(1);
      expect(bd.productExtra.filter((e) => e.productId === copia.id)).toHaveLength(1);
      // El stock es físico de cada sede: solo lo lleva la carta donde se creó.
      expect(copia.stock).toBeNull();
    }
    expect(original.stock).toBe(12);
    // Nada en la carta del otro negocio.
    expect(bd.product.some((p) => p.menuId === 'ajena' || p.tenantId !== 't1')).toBe(false);
    expect(r.id).toBe(original.id);
    expect(r.enTodas.cartas).toBe(3);
  });

  it('empareja la categoría por slug aunque esté renombrada, y crea la que falta', async () => {
    const r: any = await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: 'bebidas-p' });

    expect(bd.product.find((p) => p.menuId === 'sala1')!.categoryId).toBe('bebidas-s1');

    const enSala2 = bd.product.find((p) => p.menuId === 'sala2')!;
    const creada = bd.category.find((c) => c.id === enSala2.categoryId)!;
    expect(creada).toMatchObject({ tenantId: 't1', menuId: 'sala2', slug: 'bebidas', name: 'Bebidas', imageUrl: 'https://img/bebidas.jpg' });
    // Al final de la carta, no encima de lo que ya tenía.
    expect(creada.position).toBe(5);
    expect(r.enTodas.categoriasCreadas).toEqual([{ carta: 'Sala 2', categoria: 'Bebidas' }]);
  });

  it('una subcategoría casa dentro de su padre equivalente', async () => {
    bd.category.push(
      { id: 'jugos-p', tenantId: 't1', menuId: null, parentId: 'bebidas-p', slug: 'jugos', name: 'Jugos', position: 0 },
      { id: 'jugos-s1', tenantId: 't1', menuId: 'sala1', parentId: 'bebidas-s1', slug: 'jugos', name: 'Jugos', position: 0 },
    );
    await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: 'jugos-p' });

    expect(bd.product.find((p) => p.menuId === 'sala1')!.categoryId).toBe('jugos-s1');
    // En la Sala 2 no había ni el padre: se crean los dos, el hijo colgando
    // del padre nuevo.
    const hijo = bd.category.find((c) => c.id === bd.product.find((p) => p.menuId === 'sala2')!.categoryId)!;
    const padre = bd.category.find((c) => c.id === hijo.parentId)!;
    expect(hijo.slug).toBe('jugos');
    expect(padre).toMatchObject({ menuId: 'sala2', slug: 'bebidas', parentId: null });
  });

  it('creado desde una sala, el original igual queda en el menú principal', async () => {
    const r: any = await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: 'sala1', categoryId: 'bebidas-s1' });

    const original = bd.product.find((p) => p.menuId === null)!;
    const enSala1 = bd.product.find((p) => p.menuId === 'sala1')!;
    expect(original.categoryId).toBe('bebidas-p');
    expect(enSala1.sourceProductId).toBe(original.id);
    // Lo que vuelve es el de la carta que se estaba editando, con su stock.
    expect(r.id).toBe(enSala1.id);
    expect(enSala1.stock).toBe(12);
    expect(original.stock).toBeNull();
  });

  it('sin categoría, queda sin categoría en todas', async () => {
    await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: null });
    expect(bd.product).toHaveLength(3);
    expect(bd.product.every((p) => p.categoryId === null)).toBe(true);
    expect(bd.category).toHaveLength(4);
  });

  it('una categoría de otro negocio se rechaza y no deja nada a medias', async () => {
    await expect(
      svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: 'bebidas-ajena' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bd.product).toHaveLength(0);
  });

  it('una carta de otro negocio se rechaza', async () => {
    await expect(
      svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: 'ajena' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bd.product).toHaveLength(0);
  });

  it('las consultas no crecen con el número de cartas (no repetir el error de editar)', async () => {
    const consultasCon = async (n: number) => {
      negocioConDosSalas();
      bd.menu = bd.menu.filter((m) => m.tenantId !== 't1');
      for (let i = 1; i <= n; i++) bd.menu.push({ id: `s${i}`, tenantId: 't1', name: `Sala ${i}`, position: i });
      montar();
      await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: 'bebidas-p' });
      // Los productos sí son uno por carta.
      expect(bd.product).toHaveLength(n + 1);
      expect(bd.productVariant).toHaveLength(n + 1);
      return transacciones[0].consultas - bd.category.filter((c) => c.menuId?.startsWith('s')).length;
    };
    // Se descuentan las categorías creadas (una por carta que no la tenía):
    // eso solo pasa la primera vez, no en cada producto.
    expect(await consultasCon(10)).toBe(await consultasCon(2));
  });

  it('con una sola carta «todas» crea uno, como siempre', async () => {
    bd.menu = bd.menu.filter((m) => m.tenantId !== 't1');
    montar();
    await svc.create(DUENO, { ...NUEVO, alcance: 'todas', menuId: null, categoryId: 'bebidas-p' });
    expect(bd.product).toHaveLength(1);
  });
});

/** Un producto del principal con copias en `n` cartas, como deja duplicarlas. */
function productoConCopias(n: number, desenganchadas = 0) {
  bd = bdVacia();
  bd.tenant.push({ id: 't1' }, { id: 't2' });
  bd.product.push({ id: 'cafe', tenantId: 't1', menuId: null, name: 'Café', basePrice: 5000, maxVariantsTotal: null, tags: [] });
  bd.productVariant.push({ id: 'v0', productId: 'cafe', name: 'Pequeño', priceDelta: 0 });
  for (let i = 1; i <= n + desenganchadas; i++) {
    bd.menu.push({ id: `m${i}`, tenantId: 't1', name: `Sala ${i}`, position: i });
    bd.product.push({
      id: `cafe-${i}`, tenantId: 't1', menuId: `m${i}`, name: 'Café', basePrice: 5000,
      sourceProductId: 'cafe', syncWithSource: i <= n, isAvailable: i !== 1,
    });
    bd.productVariant.push({ id: `v${i}`, productId: `cafe-${i}`, name: 'Pequeño', priceDelta: 0 });
  }
  // Ruido: otro producto del negocio y uno de otro negocio que no se tocan.
  bd.product.push(
    { id: 'te', tenantId: 't1', menuId: null, name: 'Té', basePrice: 4000 },
    { id: 'cafe-ajeno', tenantId: 't2', menuId: null, name: 'Café', basePrice: 9000, sourceProductId: 'cafe', syncWithSource: true },
  );
  montar();
}

const EDICION = {
  name: 'Café de origen',
  basePrice: 6500,
  maxVariantsTotal: 1,
  variants: [{ name: 'Pequeño', priceDelta: 0 }, { name: 'Grande', priceDelta: 1500 }],
  extras: [],
};

describe('editar «en todas las cartas» — el error que no guardaba', () => {
  it('cambia el original y todas las copias enganchadas', async () => {
    productoConCopias(10, 1);
    await svc.update(DUENO, 'cafe', { ...EDICION, alcance: 'todas' });

    const enganchadas = bd.product.filter((p) => /^cafe-\d+$/.test(p.id) && p.syncWithSource);
    expect(enganchadas).toHaveLength(10);
    for (const p of [bd.product.find((x) => x.id === 'cafe')!, ...enganchadas]) {
      expect(p.name).toBe('Café de origen');
      expect(p.basePrice).toBe(6500);
      expect(bd.productVariant.filter((v) => v.productId === p.id).map((v) => v.name)).toEqual(['Pequeño', 'Grande']);
    }
    // Lo que es de cada carta no viaja: la Sala 1 lo tenía escondido.
    expect(bd.product.find((p) => p.id === 'cafe-1')!.isAvailable).toBe(false);
    // La desenganchada va por libre.
    expect(bd.product.find((p) => p.id === 'cafe-11')!.name).toBe('Café');
    // La de otro negocio tampoco, aunque apunte al mismo original.
    expect(bd.product.find((p) => p.id === 'cafe-ajeno')!.name).toBe('Café');
  });

  it('la causa: las consultas de la transacción NO crecen con el número de cartas', async () => {
    // Antes: 5 consultas por carta dentro de una transacción con el límite de
    // 5 s de Prisma. A ~140 ms por consulta (proxy público de Railway), 10
    // cartas = más de 7 s → P2028, rollback entero y «no guarda».
    productoConCopias(2);
    await svc.update(DUENO, 'cafe', { ...EDICION, alcance: 'todas' });
    const conDos = transacciones[0].consultas;

    productoConCopias(10);
    await svc.update(DUENO, 'cafe', { ...EDICION, alcance: 'todas' });
    const conDiez = transacciones[0].consultas;

    expect(conDiez).toBe(conDos);
    expect(conDiez * 140).toBeLessThan(5_000);
  });

  it('la transacción se abre con margen sobre los 5 s por defecto', async () => {
    productoConCopias(3);
    await svc.update(DUENO, 'cafe', { ...EDICION, alcance: 'todas' });
    expect(transacciones[0].opciones?.timeout).toBeGreaterThanOrEqual(20_000);
  });

  it('las copias guardan los valores normalizados igual que el original', async () => {
    productoConCopias(2);
    await svc.update(DUENO, 'cafe', { ...EDICION, alcance: 'todas' });
    // «Elige 1» es el comportamiento por defecto y se guarda como null, también
    // en la copia (antes la copia se quedaba con un 1).
    for (const id of ['cafe', 'cafe-1', 'cafe-2']) {
      expect(bd.product.find((p) => p.id === id)!.maxVariantsTotal).toBeNull();
    }
  });

  it('«solo en esta» no toca las copias', async () => {
    productoConCopias(3);
    await svc.update(DUENO, 'cafe', { ...EDICION, alcance: 'solo-esta' });
    expect(bd.product.find((p) => p.id === 'cafe')!.name).toBe('Café de origen');
    expect(bd.product.find((p) => p.id === 'cafe-2')!.name).toBe('Café');
    expect(bd.productVariant.filter((v) => v.productId === 'cafe-2')).toHaveLength(1);
  });

  it('el aviso cuenta las mismas cartas que se van a cambiar', async () => {
    productoConCopias(3, 2);
    const r = await svc.copiasEnganchadas(DUENO, 'cafe');
    expect(r.count).toBe(3);
    expect(r.cartas).toEqual(['Sala 1', 'Sala 2', 'Sala 3']);
  });
});

describe('eliminar «de todas las cartas»', () => {
  it('sin alcance elimina solo el de esta carta (lo de siempre)', async () => {
    productoConCopias(3);
    await svc.remove(DUENO, 'cafe-2');
    expect(bd.product.find((p) => p.id === 'cafe-2')).toBeUndefined();
    expect(bd.product.filter((p) => p.tenantId === 't1')).toHaveLength(4);
  });

  it('desde una copia, elimina el original y todas sus copias, también las desenganchadas', async () => {
    productoConCopias(3, 1);
    const r = await svc.remove(DUENO, 'cafe-2', 'todas');

    expect(r.eliminados).toBe(5);
    expect(bd.product.map((p) => p.id).sort()).toEqual(['cafe-ajeno', 'te']);
    // Las variantes se van con ellos (Cascade).
    expect(bd.productVariant).toHaveLength(0);
  });

  it('nunca toca otro negocio, aunque su producto apunte al mismo original', async () => {
    productoConCopias(2);
    await svc.remove(DUENO, 'cafe', 'todas');
    expect(bd.product.find((p) => p.id === 'cafe-ajeno')).toBeDefined();
  });

  it('copias de copias (duplicar una carta que ya era copia) también caen', async () => {
    productoConCopias(2);
    bd.product.push({ id: 'cafe-nieto', tenantId: 't1', menuId: 'm9', name: 'Café', basePrice: 5000, sourceProductId: 'cafe-1', syncWithSource: true });
    await svc.remove(DUENO, 'cafe-nieto', 'todas');
    expect(bd.product.filter((p) => p.tenantId === 't1').map((p) => p.id)).toEqual(['te']);
  });

  it('antes de eliminar, dice en qué otras cartas está', async () => {
    productoConCopias(2, 1);
    const r = await svc.enOtrasCartas(DUENO, 'cafe-1');
    expect(r.count).toBe(3);
    expect(r.cartas.sort()).toEqual(['Menú principal', 'Sala 2', 'Sala 3']);
  });

  it('un producto sin copias no está en otras cartas', async () => {
    productoConCopias(2);
    expect((await svc.enOtrasCartas(DUENO, 'te')).count).toBe(0);
  });
});
