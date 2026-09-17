/**
 * Prisma falso en memoria para probar `StampsService.record` DE VERDAD.
 *
 * Los dos specs que había en esta carpeta copiaban la lógica del servicio
 * dentro del propio test («el módulo arrastra NestJS y no se puede importar»).
 * Sí se puede —`club-ritmo.spec.ts` lo hace con `ClubService`—, y una copia
 * pasa en verde aunque el servicio real se rompa. Este falso existe para que
 * los tests de tarjetas importen el módulo real.
 *
 * Modela lo que el servicio necesita para no mentir:
 *
 *  · `updateMany` evalúa el `where` y escribe en el mismo paso, y devuelve el
 *    `count`. Es lo que decide las transiciones ACTIVE ⇄ COMPLETED.
 *  · `@@unique([cardId, customerId])` revienta con P2002: si el servicio mueve
 *    un pase a una tarjeta donde el cliente ya tiene otro, el test lo ve.
 *  · Borrar un pase arrastra en cascada sus `Stamp` y sus `WalletDevice`,
 *    igual que `onDelete: Cascade` en el esquema. Sin esto no se podría probar
 *    que la conversión de un cupón ya no se lleva el historial por delante.
 *  · `$transaction` deshace lo escrito si la función lanza.
 *  · `select` / `include` estrictos: sin pedir la relación, no viene.
 *
 * Lo que NO modela: los candados (`pg_advisory_xact_lock` es un no-op) ni la
 * concurrencia real más allá del candado. Las lecturas devuelven copias.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type FilaTarjeta = {
  id: string;
  tenantId: string;
  type: string;
  name: string;
  stampsRequired: number | null;
  visitsRequired: number | null;
  clubPlanId: string | null;
  convenioId: string | null;
  isActive: boolean;
  transformIntoCardId: string | null;
  transformOnRedeem: boolean;
  couponIndefinido: boolean;
  rewardText: string | null;
  minAmountPerStamp: number | null;
  validUntil: Date | null;
  validDaysAfterIssue: number | null;
  tiers: unknown;
  tierMetric: string | null;
  multiRewards: unknown;
  createdAt: Date;
};

export type FilaPase = {
  id: string;
  tenantId: string;
  cardId: string;
  customerId: string;
  serialNumber: string;
  qrToken: string;
  legacyQrTokens: string[];
  stampsCount: number;
  visitsCount: number;
  pointsBalance: number;
  cashbackBalance: number;
  tierProgress: number;
  currentTier: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'REVOKED';
  issuedAt: Date;
  lastActivityAt: Date | null;
  walletInstalledAt: Date | null;
  googleObjectId: string | null;
};

export type FilaSello = {
  id: string;
  tenantId: string;
  passId: string;
  customerId: string;
  action: string;
  amount: unknown;
  purchaseAmount: unknown;
  redeemKind: string | null;
  note: string | null;
  createdAt: Date;
};

export type FilaDispositivo = { id: string; passId: string; deviceLibraryId: string };

export type BaseDeDatos = {
  tenants: Array<{ id: string; maxStampsPerDay: number | null }>;
  tarjetas: FilaTarjeta[];
  clientes: Array<{ id: string; tenantId: string; fullName: string }>;
  pases: FilaPase[];
  sellos: FilaSello[];
  dispositivos: FilaDispositivo[];
};

export function bdVacia(): BaseDeDatos {
  return { tenants: [], tarjetas: [], clientes: [], pases: [], sellos: [], dispositivos: [] };
}

export function tarjeta(parcial: Partial<FilaTarjeta> & { id: string; type: string }): FilaTarjeta {
  return {
    tenantId: 't1',
    name: parcial.id,
    stampsRequired: null,
    visitsRequired: null,
    clubPlanId: null,
    convenioId: null,
    isActive: true,
    transformIntoCardId: null,
    transformOnRedeem: true,
    couponIndefinido: false,
    rewardText: null,
    minAmountPerStamp: null,
    validUntil: null,
    validDaysAfterIssue: null,
    tiers: null,
    tierMetric: null,
    multiRewards: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...parcial,
  };
}

export function pase(parcial: Partial<FilaPase> & { id: string; cardId: string }): FilaPase {
  return {
    tenantId: 't1',
    customerId: 'cli1',
    serialNumber: `SER-${parcial.id}`,
    qrToken: `QR-${parcial.id}`,
    legacyQrTokens: [],
    stampsCount: 0,
    visitsCount: 0,
    pointsBalance: 0,
    cashbackBalance: 0,
    tierProgress: 0,
    currentTier: null,
    status: 'ACTIVE',
    issuedAt: new Date('2026-01-01T00:00:00Z'),
    lastActivityAt: null,
    walletInstalledAt: null,
    googleObjectId: null,
    ...parcial,
  };
}

export class ErrorP2002 extends Error {
  code = 'P2002';
}
export class ErrorP2025 extends Error {
  code = 'P2025';
}

const numero = (v: unknown): number => Number(v as number);

/** ¿Cumple el valor de la columna la condición del `where`? */
function cumple(valor: unknown, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null) return valor === null || valor === undefined;
  if (cond instanceof Date) return (valor as Date)?.getTime?.() === cond.getTime();
  if (typeof cond === 'object' && !Array.isArray(cond)) {
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case 'in':
          return (arg as unknown[]).includes(valor);
        case 'not':
          return !cumple(valor, arg);
        case 'lt':
          return valor instanceof Date ? valor < (arg as Date) : numero(valor) < numero(arg);
        case 'lte':
          return valor instanceof Date ? valor <= (arg as Date) : numero(valor) <= numero(arg);
        case 'gt':
          return valor instanceof Date ? valor > (arg as Date) : numero(valor) > numero(arg);
        case 'gte':
          return valor instanceof Date ? valor >= (arg as Date) : numero(valor) >= numero(arg);
        case 'has':
          return Array.isArray(valor) && valor.includes(arg);
        default:
          throw new Error(`prisma falso: operador no modelado «${op}»`);
      }
    });
  }
  return valor === cond;
}

function filtra<T extends Record<string, any>>(fila: T, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'cardId_customerId') {
      const clave = cond as { cardId?: string; customerId?: string };
      return fila.cardId === clave.cardId && fila.customerId === clave.customerId;
    }
    return cumple(fila[k], cond);
  });
}

type Contexto = { deshacer: Array<() => void>; soltar: Array<() => void> };

export function crearPrismaFalso(bd: BaseDeDatos) {
  let secuencia = 0;
  const nuevoId = (prefijo: string) => `${prefijo}-${++secuencia}`;
  // Contexto de la transacción en curso atado al hilo async: con dos
  // transacciones solapadas (el test de concurrencia) cada una deshace y suelta
  // solo lo suyo.
  const contexto = new AsyncLocalStorage<Contexto>();
  const anotar = (fn: () => void) => contexto.getStore()?.deshacer.push(fn);
  const dentroDeTransaccion = () => contexto.getStore() !== undefined;

  // pg_advisory_xact_lock: un candado por clave que se suelta al terminar la
  // transacción. Es lo que serializa dos escaneos del mismo pase en producción,
  // y sin modelarlo no se puede probar nada que dependa de leer DESPUÉS de él.
  const candados = new Map<string, Promise<void>>();
  const tomarCandado = async (clave: string) => {
    const ctx = contexto.getStore();
    if (!ctx) throw new Error('prisma falso: advisory_xact_lock fuera de transacción');
    while (candados.has(clave)) await candados.get(clave);
    let soltar: () => void = () => undefined;
    candados.set(
      clave,
      new Promise<void>((resolver) => {
        soltar = () => resolver();
      }),
    );
    ctx.soltar.push(() => {
      candados.delete(clave);
      soltar();
    });
  };

  /** Operaciones que el test quiere ver (p. ej. que no se borró nada). */
  const registro: string[] = [];

  const copia = <T>(x: T): T => (x ? ({ ...x } as T) : x);

  const escribir = (fila: Record<string, any>, data: Record<string, any>) => {
    const previo: Record<string, any> = { ...fila };
    if (Array.isArray(fila.legacyQrTokens)) previo.legacyQrTokens = [...fila.legacyQrTokens];
    anotar(() => Object.assign(fila, previo));
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        if ('increment' in v) {
          fila[k] = numero(fila[k] ?? 0) + numero(v.increment);
          continue;
        }
        if ('decrement' in v) {
          fila[k] = numero(fila[k] ?? 0) - numero(v.decrement);
          continue;
        }
        if ('set' in v) {
          fila[k] = v.set;
          continue;
        }
        // Prisma.Decimal y compañía: se guardan como número.
        if (typeof (v as { toNumber?: () => number }).toNumber === 'function') {
          fila[k] = (v as { toNumber: () => number }).toNumber();
          continue;
        }
      }
      fila[k] = Array.isArray(v) ? [...v] : v;
    }
  };

  const unicoTarjetaCliente = (fila: FilaPase) => {
    const choque = bd.pases.find(
      (p) => p !== fila && p.cardId === fila.cardId && p.customerId === fila.customerId,
    );
    if (choque) {
      throw new ErrorP2002('Unique constraint failed on the fields: (`cardId`,`customerId`)');
    }
  };

  function proyectarPase(fila: FilaPase, op: any): any {
    if (op?.select) {
      const salida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.select)) {
        if (!v) continue;
        if (k === 'card') {
          const t = bd.tarjetas.find((c) => c.id === fila.cardId);
          salida.card = proyectarSimple(t, v === true ? undefined : (v as any).select);
          continue;
        }
        salida[k] = Array.isArray((fila as any)[k]) ? [...(fila as any)[k]] : (fila as any)[k];
      }
      return salida;
    }
    const salida: any = copia(fila);
    salida.legacyQrTokens = [...fila.legacyQrTokens];
    if (op?.include?.card) salida.card = copia(bd.tarjetas.find((c) => c.id === fila.cardId));
    if (op?.include?.customer) salida.customer = copia(bd.clientes.find((c) => c.id === fila.customerId));
    return salida;
  }

  function proyectarSimple<T extends Record<string, any>>(fila: T | undefined, select: any): any {
    if (!fila) return null;
    if (!select) return copia(fila);
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(select)) if (v) salida[k] = fila[k];
    return salida;
  }

  const pass = {
    count: async (op: any) => bd.pases.filter((p) => filtra(p, op.where)).length,
    findUnique: async (op: any) => {
      const fila = bd.pases.find((p) => filtra(p, op.where));
      return fila ? proyectarPase(fila, op) : null;
    },
    findFirst: async (op: any) => {
      const fila = bd.pases.find((p) => filtra(p, op.where));
      return fila ? proyectarPase(fila, op) : null;
    },
    update: async (op: any) => {
      const fila = bd.pases.find((p) => filtra(p, op.where));
      if (!fila) throw new ErrorP2025('Record to update not found.');
      escribir(fila, op.data);
      unicoTarjetaCliente(fila);
      registro.push(`pass.update:${fila.id}`);
      return proyectarPase(fila, op);
    },
    updateMany: async (op: any) => {
      const filas = bd.pases.filter((p) => filtra(p, op.where));
      for (const f of filas) {
        escribir(f, op.data);
        unicoTarjetaCliente(f);
        registro.push(`pass.updateMany:${f.id}:${JSON.stringify(op.data)}`);
      }
      return { count: filas.length };
    },
    delete: async (op: any) => {
      const fila = bd.pases.find((p) => filtra(p, op.where));
      if (!fila) throw new ErrorP2025('Record to delete does not exist.');
      registro.push(`pass.delete:${fila.id}`);
      // onDelete: Cascade de Stamp y WalletDevice, como en el esquema.
      const sellosIdos = bd.sellos.filter((s) => s.passId === fila.id);
      const dispositivosIdos = bd.dispositivos.filter((d) => d.passId === fila.id);
      const pasesAntes = [...bd.pases];
      const sellosAntes = [...bd.sellos];
      const dispAntes = [...bd.dispositivos];
      bd.pases.splice(bd.pases.indexOf(fila), 1);
      for (const s of sellosIdos) bd.sellos.splice(bd.sellos.indexOf(s), 1);
      for (const d of dispositivosIdos) bd.dispositivos.splice(bd.dispositivos.indexOf(d), 1);
      anotar(() => {
        bd.pases.splice(0, bd.pases.length, ...pasesAntes);
        bd.sellos.splice(0, bd.sellos.length, ...sellosAntes);
        bd.dispositivos.splice(0, bd.dispositivos.length, ...dispAntes);
      });
      return copia(fila);
    },
  };

  const stamp = {
    count: async (op: any) => {
      registro.push(`stamp.count:${dentroDeTransaccion() ? 'dentro' : 'fuera'}`);
      return bd.sellos.filter((s) => filtra(s, op.where)).length;
    },
    findFirst: async (op: any) => {
      const filas = bd.sellos.filter((s) => filtra(s, op.where));
      filas.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return proyectarSimple(filas[0], op.select);
    },
    create: async (op: any) => {
      const fila: FilaSello = {
        id: nuevoId('stamp'),
        redeemKind: null,
        note: null,
        purchaseAmount: null,
        createdAt: new Date(),
        ...op.data,
      };
      if (!bd.pases.some((p) => p.id === fila.passId)) {
        throw new Error(`prisma falso: FK Stamp.passId → Pass «${fila.passId}» no existe`);
      }
      bd.sellos.push(fila);
      anotar(() => bd.sellos.splice(bd.sellos.indexOf(fila), 1));
      return copia(fila);
    },
    updateMany: async (op: any) => {
      const filas = bd.sellos.filter((s) => filtra(s, op.where));
      for (const f of filas) escribir(f, op.data);
      return { count: filas.length };
    },
  };

  const card = {
    findMany: async (op: any) =>
      bd.tarjetas.filter((c) => filtra(c, op.where)).map((c) => proyectarSimple(c, op.select)),
    findUnique: async (op: any) =>
      proyectarSimple(bd.tarjetas.find((c) => filtra(c, op.where)), op.select),
    findFirst: async (op: any) => {
      const filas = bd.tarjetas.filter((c) => filtra(c, op.where));
      filas.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return proyectarSimple(filas[0], op.select);
    },
    create: async (op: any) => {
      const fila = tarjeta({ id: nuevoId('card'), ...op.data });
      bd.tarjetas.push(fila);
      anotar(() => bd.tarjetas.splice(bd.tarjetas.indexOf(fila), 1));
      return proyectarSimple(fila, op.select);
    },
  };

  const prisma: any = {
    pass,
    stamp,
    card,
    tenant: {
      findUnique: async (op: any) =>
        proyectarSimple(bd.tenants.find((t) => t.id === op.where.id), op.select),
    },
    setting: { findUnique: async () => null },
    walletDevice: {
      count: async (op: any) => bd.dispositivos.filter((d) => filtra(d, op.where)).length,
    },
    customer: {
      update: async () => ({}),
      updateMany: async () => ({ count: 0 }),
    },
    $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        await tomarCandado(String(params[0]));
        registro.push(`candado:${String(params[0])}`);
      }
      return 0;
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const ctx: Contexto = { deshacer: [], soltar: [] };
      return contexto.run(ctx, async () => {
        try {
          return await fn(prisma);
        } catch (e) {
          for (const u of ctx.deshacer.reverse()) u();
          throw e;
        } finally {
          for (const s of ctx.soltar) s();
        }
      });
    },
  };

  return { prisma, registro };
}

/** Dobles de las dependencias que el servicio dispara y olvida. */
export function crearDobles() {
  const empujes: Array<{ passId: string; reason: string; message?: unknown }> = [];
  const eventos: Array<{ tipo: string; payload: any }> = [];
  return {
    empujes,
    eventos,
    wallet: { pushPassUpdate: async () => undefined } as any,
    jobs: {
      enqueue: async (_n: string, datos: { passId: string; reason: string; message?: unknown }) => {
        empujes.push(datos);
      },
    } as any,
    gamification: { processStamp: async () => undefined } as any,
    automations: {
      emit: async (tipo: string, payload: any) => {
        eventos.push({ tipo, payload });
      },
    } as any,
    passes: {} as any,
    brand: { resolveTenant: async () => ({ websiteUrl: 'https://marca.test' }) } as any,
  };
}
