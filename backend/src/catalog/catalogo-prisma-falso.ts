/**
 * Prisma falso en memoria para probar `ProductsService` DE VERDAD.
 *
 * `alcance-del-cambio.spec.ts` y `menus.spec.ts` copian la condición del
 * servicio dentro del test («el módulo arrastra NestJS»). Eso no vio el error
 * de «cambiar en todas las cartas»: la copia de la condición estaba bien; lo
 * que fallaba era el NÚMERO de consultas que hacía la propagación dentro de una
 * transacción con el límite de 5 s de Prisma. Con este doble los specs llaman
 * al servicio real y cuentan sus consultas.
 *
 * Reproduce lo que el servicio necesita para ser comprobable:
 *  · `$transaction(fn, opciones)` atómico (si `fn` lanza, se restaura todo) y
 *    guarda las opciones con las que se abrió, para comprobar el `timeout`.
 *  · Cuenta las consultas hechas DENTRO de cada transacción.
 *  · Borrar un producto se lleva sus variantes, extras y precios por sede
 *    (`Cascade`) y deja sin origen a sus copias (`SetNull`), como la base.
 *
 * No reproduce el middleware de negocio (`prisma-tenant-middleware.ts`): el
 * aislamiento que se prueba aquí es el que el servicio escribe a mano.
 */

import type { PrismaService } from '../common/prisma/prisma.service';

export type Fila = Record<string, any>;

type Relacion = { modelo: string; muchos: boolean; local: string; remoto: string };

const RELACIONES: Record<string, Record<string, Relacion>> = {
  product: {
    variants: { modelo: 'productVariant', muchos: true, local: 'id', remoto: 'productId' },
    extras: { modelo: 'productExtra', muchos: true, local: 'id', remoto: 'productId' },
    productLocations: { modelo: 'productLocation', muchos: true, local: 'id', remoto: 'productId' },
    category: { modelo: 'category', muchos: false, local: 'categoryId', remoto: 'id' },
    menu: { modelo: 'menu', muchos: false, local: 'menuId', remoto: 'id' },
    sourceProduct: { modelo: 'product', muchos: false, local: 'sourceProductId', remoto: 'id' },
  },
  category: {
    products: { modelo: 'product', muchos: true, local: 'id', remoto: 'categoryId' },
  },
};

const POR_DEFECTO: Record<string, () => Fila> = {
  product: () => ({
    menuId: null,
    sourceProductId: null,
    syncWithSource: false,
    categoryId: null,
    description: '',
    priceMode: 'FIXED',
    priceMax: null,
    variantPriceMode: 'DELTA',
    imageUrl: null,
    tags: [],
    isAvailable: true,
    availableForMesa: true,
    availableForDelivery: true,
    isRecommended: false,
    position: 0,
    stock: null,
    stockAlert: null,
    maxVariantsTotal: null,
    maxExtrasTotal: null,
    locationMode: 'TODAS',
  }),
  category: () => ({
    menuId: null,
    parentId: null,
    description: null,
    imageUrl: null,
    tagline: null,
    coverConfig: null,
    popupConfig: null,
    position: 0,
    isActive: true,
  }),
  productVariant: () => ({ groupName: 'Tamaño', isDefault: false, position: 0 }),
  productExtra: () => ({ maxQty: 1, isAvailable: true }),
  menu: () => ({ locationId: null, position: 0, isActive: true }),
  tenant: () => ({ sedeMenuEnabled: false }),
  location: () => ({}),
  productLocation: () => ({}),
};

export type BaseDeDatos = Record<string, Fila[]>;

export function bdVacia(): BaseDeDatos {
  return Object.fromEntries(Object.keys(POR_DEFECTO).map((m) => [m, []]));
}

function cumple(fila: Fila, where: any): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === 'AND') {
      if (!(cond as any[]).every((w) => cumple(fila, w))) return false;
      continue;
    }
    if (k === 'OR') {
      if (!(cond as any[]).some((w) => cumple(fila, w))) return false;
      continue;
    }
    const v = fila[k] ?? null;
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as any;
      if ('in' in c && !c.in.includes(v)) return false;
      if ('notIn' in c && c.notIn.includes(v)) return false;
      if ('not' in c && v === (c.not ?? null)) return false;
      continue;
    }
    if (v !== cond) return false;
  }
  return true;
}

let secuencia = 0;
const nuevoId = (modelo: string) => `${modelo}-${++secuencia}`;

export function crearPrismaFalso(bd: BaseDeDatos) {
  /** Transacciones abiertas: opciones y cuántas consultas hizo cada una. */
  const transacciones: { opciones: any; consultas: number }[] = [];
  let actual: { opciones: any; consultas: number } | null = null;
  const contar = () => {
    if (actual) actual.consultas++;
  };

  function proyectar(modelo: string, fila: Fila, args: any): Fila {
    const sel = args?.select;
    const inc = args?.include;
    const base: Fila = sel ? {} : { ...fila };
    const pedidos = sel ?? inc ?? {};
    for (const [k, v] of Object.entries(pedidos)) {
      if (!v) continue;
      const rel = RELACIONES[modelo]?.[k];
      if (!rel) {
        if (sel) base[k] = fila[k];
        continue;
      }
      if (k === '_count') continue;
      const sub = typeof v === 'object' ? v : undefined;
      if (rel.muchos) {
        base[k] = bd[rel.modelo]
          .filter((o) => o[rel.remoto] === fila[rel.local])
          .map((o) => proyectar(rel.modelo, o, sub));
      } else {
        const o = bd[rel.modelo].find((x) => x[rel.remoto] === fila[rel.local]);
        base[k] = o ? proyectar(rel.modelo, o, sub) : null;
      }
    }
    return base;
  }

  function crear(modelo: string, data: Fila): Fila {
    const { variants, extras, ...resto } = data;
    const fila: Fila = {
      id: nuevoId(modelo),
      createdAt: new Date(),
      ...POR_DEFECTO[modelo](),
      ...Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined)),
    };
    bd[modelo].push(fila);
    if (modelo === 'product') {
      for (const v of variants?.create ?? []) crear('productVariant', { ...v, productId: fila.id });
      for (const e of extras?.create ?? []) crear('productExtra', { ...e, productId: fila.id });
    }
    return fila;
  }

  /** Lo que hace la base al borrar un producto: `Cascade` y `SetNull`. */
  function borrarProductos(ids: string[]) {
    bd.product = bd.product.filter((p) => !ids.includes(p.id));
    for (const m of ['productVariant', 'productExtra', 'productLocation']) {
      bd[m] = bd[m].filter((f) => !ids.includes(f.productId));
    }
    for (const p of bd.product) {
      if (p.sourceProductId && ids.includes(p.sourceProductId)) p.sourceProductId = null;
    }
  }

  function modelo(nombre: string) {
    const filas = () => bd[nombre];
    const quitarUndef = (d: Fila) =>
      Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
    return {
      findMany: async (args: any = {}) => {
        contar();
        return filas()
          .filter((f) => cumple(f, args.where))
          .map((f) => proyectar(nombre, f, args));
      },
      findFirst: async (args: any = {}) => {
        contar();
        let lista = filas().filter((f) => cumple(f, args.where));
        const orden = args.orderBy;
        if (orden && !Array.isArray(orden)) {
          const [k, dir] = Object.entries(orden)[0] as [string, string];
          lista = [...lista].sort((a, b) => (dir === 'desc' ? b[k] - a[k] : a[k] - b[k]));
        }
        return lista[0] ? proyectar(nombre, lista[0], args) : null;
      },
      findUnique: async (args: any) => {
        contar();
        const f = filas().find((x) => cumple(x, args.where));
        return f ? proyectar(nombre, f, args) : null;
      },
      count: async (args: any = {}) => {
        contar();
        return filas().filter((f) => cumple(f, args.where)).length;
      },
      create: async (args: any) => {
        contar();
        return proyectar(nombre, crear(nombre, args.data), args);
      },
      createMany: async (args: any) => {
        contar();
        for (const d of args.data) crear(nombre, d);
        return { count: args.data.length };
      },
      update: async (args: any) => {
        contar();
        const f = filas().find((x) => cumple(x, args.where));
        if (!f) throw Object.assign(new Error('P2025'), { code: 'P2025' });
        Object.assign(f, quitarUndef(args.data));
        return proyectar(nombre, f, args);
      },
      updateMany: async (args: any) => {
        contar();
        const lista = filas().filter((x) => cumple(x, args.where));
        for (const f of lista) Object.assign(f, quitarUndef(args.data));
        return { count: lista.length };
      },
      upsert: async (args: any) => {
        contar();
        const clave = Object.values(args.where)[0] as Fila;
        const f = filas().find((x) => cumple(x, clave));
        if (f) Object.assign(f, quitarUndef(args.update));
        else crear(nombre, args.create);
        return f;
      },
      delete: async (args: any) => {
        contar();
        const f = filas().find((x) => cumple(x, args.where));
        if (!f) throw Object.assign(new Error('P2025'), { code: 'P2025' });
        if (nombre === 'product') borrarProductos([f.id]);
        else bd[nombre] = filas().filter((x) => x !== f);
        return f;
      },
      deleteMany: async (args: any = {}) => {
        contar();
        const lista = filas().filter((x) => cumple(x, args.where));
        if (nombre === 'product') borrarProductos(lista.map((x) => x.id));
        else bd[nombre] = filas().filter((x) => !lista.includes(x));
        return { count: lista.length };
      },
    };
  }

  const cliente: any = {};
  for (const m of Object.keys(POR_DEFECTO)) cliente[m] = modelo(m);
  cliente.$transaction = async (fn: any, opciones?: any) => {
    if (Array.isArray(fn)) return Promise.all(fn);
    const copia = JSON.parse(JSON.stringify(bd));
    const tx = { opciones, consultas: 0 };
    transacciones.push(tx);
    actual = tx;
    try {
      return await fn(cliente);
    } catch (e) {
      for (const k of Object.keys(bd)) bd[k] = copia[k];
      throw e;
    } finally {
      actual = null;
    }
  };

  return { prisma: cliente as PrismaService, transacciones };
}
