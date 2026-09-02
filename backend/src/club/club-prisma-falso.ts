/**
 * Prisma falso en memoria para los tests de la Tarjeta de Club.
 *
 * Existe para poder probar el SERVICIO REAL —`consumir`, `anularConsumo`,
 * `reiniciarCupos`, `darDeAlta`— y no una copia de su lógica. Los tests de
 * Convenios reimplementan las reglas dentro del propio fichero de test: pasan
 * los 31 sin proteger una sola línea de lo que corre en producción.
 *
 * OJO: el saldo vivo del club NO está en `ClubMembresia`, está en
 * `Pass.stampsCount` — el mismo contador que usan todas las tarjetas. Por eso
 * el falso tiene tabla de pases y de tarjetas.
 *
 * Modela a propósito las cuatro cosas de Postgres de las que depende que el
 * cliente no se lleve más de lo que tiene:
 *
 *  · `updateMany` evalúa el `where` y escribe en el MISMO paso, y devuelve
 *    cuántas filas tocó. Es lo que convierte el descuento en atómico, y lo
 *    único que separa este módulo del bug de leer-decidir-escribir.
 *  · Los índices únicos (`[planId,customerId]`, `[cardId,customerId]`,
 *    `[tenantId,slug]`) revientan con P2002.
 *  · `$transaction` deshace lo escrito si la función lanza. Cada transacción
 *    lleva su propio registro de deshacer, atado con `AsyncLocalStorage`: sin
 *    eso, con dos transacciones solapadas el rollback de la que pierde borraba
 *    lo que había escrito la que ganó, y el test acusaba al servicio de un
 *    fallo que era del andamio.
 *  · `select` / `include` se respetan de forma ESTRICTA: sin `include` no
 *    vienen las relaciones. Si alguien quita un `include` del servicio, el test
 *    revienta igual que reventaría producción, en vez de pasar de largo.
 *
 * Lo que NO modela: la instantánea de lectura (`REPEATABLE READ`). Dentro de
 * una transacción, una lectura ve lo que otra ya escribió. Al servicio le da
 * igual —lee una vez y decide con el `count` del `updateMany`—, pero conviene
 * saberlo antes de apoyarse en el falso para otra cosa.
 *
 * Las lecturas devuelven COPIAS. Es importante: el servicio lee la membresía
 * antes de descontar, y si le diéramos la fila viva vería por arte de magia el
 * saldo ya modificado por el otro cajero, que es justo lo que no pasa en
 * producción.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type EstadoMembresia = 'ACTIVA' | 'PAUSADA' | 'CANCELADA';

export type FilaPlan = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string;
  beneficiosPorMes: number;
  unidad: string;
  precioCents: number;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type FilaTramo = {
  id: string;
  planId: string;
  desdeDia: number;
  hastaDia: number;
  beneficios: number;
};

export type FilaTarjeta = {
  id: string;
  tenantId: string;
  clubPlanId: string | null;
  name: string;
  type: string;
  stampsRequired: number;
  rewardText: string;
  isActive: boolean;
};

/** El pase de la billetera. Aquí vive el saldo del club (`stampsCount`). */
export type FilaPase = {
  id: string;
  tenantId: string;
  cardId: string;
  customerId: string;
  serialNumber: string;
  qrToken: string;
  authToken: string;
  stampsCount: number;
  status: string;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FilaMembresia = {
  id: string;
  planId: string;
  customerId: string;
  passId: string | null;
  status: EstadoMembresia;
  periodo: string;
  cupoDelPeriodo: number;
  createdAt: Date;
  pausedAt: Date | null;
  updatedAt: Date;
};

export type FilaConsumo = {
  id: string;
  membresiaId: string;
  cantidad: number;
  saldoResultante: number;
  periodo: string;
  actorId: string | null;
  locationId: string | null;
  revertedAt: Date | null;
  revertedBy: string | null;
  createdAt: Date;
};

export type FilaCliente = { id: string; tenantId: string; fullName: string };

export type BaseDeDatos = {
  planes: FilaPlan[];
  tramos: FilaTramo[];
  tarjetas: FilaTarjeta[];
  /** El interruptor del módulo. Encendido salvo que un test lo apague. */
  clubEnabled: boolean;
  pases: FilaPase[];
  membresias: FilaMembresia[];
  consumos: FilaConsumo[];
  clientes: FilaCliente[];
};

/**
 * Puntos donde el test puede colarse en medio de una operación.
 *
 * Sin esto no se puede escribir el caso que de verdad importa: dos cajeros que
 * LEEN el mismo saldo 1 antes de que ninguno de los dos descuente. Si sólo se
 * lanzan las dos llamadas seguidas, la primera termina el descuento antes de
 * que la segunda lea, y el test pasaría aunque el código tuviera el bug.
 *
 * Todos son de un solo uso: se consumen al dispararse.
 */
export type Ganchos = {
  /** Antes de que `pass.updateMany` (el descuento del cupo) mire nada. */
  antesDeDescontar: (() => void | Promise<void>) | null;
  /** Antes de `pass.update` — reposición del cupo y reinicio mensual. */
  antesDeReponerPase: (() => void | Promise<void>) | null;
  /** Antes de `clubMembresia.updateMany` — el avance de período del cron. */
  antesDeAvanzarPeriodo: (() => void | Promise<void>) | null;
  /** Antes de `clubConsumo.updateMany` — la marca de anulación. */
  antesDeMarcarAnulacion: (() => void | Promise<void>) | null;
  /** Antes de crear la fila de consumo. Simula que la escritura falla. */
  antesDeCrearConsumo: (() => void) | null;
  /** Antes de insertar la membresía. Fuerza la carrera del alta. */
  antesDeCrearMembresia: (() => void | Promise<void>) | null;
  /** Antes de crear la tarjeta-plantilla del plan. */
  antesDeCrearTarjeta: (() => void | Promise<void>) | null;
};

/** El error que lanza Prisma al chocar con un índice único. */
export class ErrorP2002 extends Error {
  code = 'P2002';
  constructor(campos: string[]) {
    super(`Unique constraint failed on the fields: (${campos.join(',')})`);
  }
}

/** El error de `findUniqueOrThrow` / `update` sobre una fila que no está. */
export class ErrorP2025 extends Error {
  code = 'P2025';
  constructor() {
    super(
      'An operation failed because it depends on one or more records that were required but not found.',
    );
  }
}

type Opciones = { select?: any; include?: any } | undefined;

/** ¿Cumple el valor de la columna la condición del `where`? */
function cumple(valor: unknown, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null) return valor === null;
  if (cond instanceof Date) return (valor as Date)?.getTime?.() === cond.getTime();
  if (typeof cond === 'object') {
    if ('not' in cond) return !cumple(valor, cond.not);
    if ('in' in cond) return (cond.in as unknown[]).includes(valor);
    if ('gte' in cond) return (valor as number) >= cond.gte;
    if ('gt' in cond) return (valor as number) > cond.gt;
    if ('lte' in cond) return (valor as number) <= cond.lte;
    if ('lt' in cond) return (valor as number) < cond.lt;
    if ('equals' in cond) return cumple(valor, cond.equals);
    // Lo usa `crearPlan` para traerse de una sola consulta todos los slugs que
    // empiezan por el mismo texto, en vez de probar uno por uno.
    if ('startsWith' in cond) return String(valor ?? '').startsWith(cond.startsWith);
    if ('contains' in cond) {
      const v = String(valor ?? '');
      const q = String(cond.contains);
      return cond.mode === 'insensitive'
        ? v.toLowerCase().includes(q.toLowerCase())
        : v.includes(q);
    }
  }
  return valor === cond;
}

export function crearPrismaFalso(bd: BaseDeDatos) {
  let secuencia = 0;
  const nuevoId = (prefijo: string) => `${prefijo}-${++secuencia}`;

  const ganchos: Ganchos = {
    antesDeDescontar: null,
    antesDeReponerPase: null,
    antesDeAvanzarPeriodo: null,
    antesDeMarcarAnulacion: null,
    antesDeCrearConsumo: null,
    antesDeCrearMembresia: null,
    antesDeCrearTarjeta: null,
  };

  /** Dispara un gancho de un solo uso, si está armado. */
  const disparar = async (nombre: keyof Ganchos) => {
    const fn = ganchos[nombre];
    if (!fn) return;
    ganchos[nombre] = null;
    await fn();
  };

  // Registro de deshacer de la transacción en curso, atado al contexto async
  // para que dos transacciones solapadas no se mezclen los registros. Fuera de
  // transacción no hay registro: las escrituras sueltas no se deshacen, como
  // en Postgres con autocommit.
  const contexto = new AsyncLocalStorage<Array<() => void>>();
  const anotar = (fn: () => void) => {
    contexto.getStore()?.push(fn);
  };

  const escribir = <T extends Record<string, any>>(fila: T, data: any) => {
    const previo = { ...fila };
    anotar(() => Object.assign(fila, previo));
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue; // Prisma ignora undefined; null sí escribe
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const op = v as Record<string, number>;
        if ('increment' in op) {
          (fila as any)[k] = ((fila as any)[k] ?? 0) + op.increment;
          continue;
        }
        if ('decrement' in op) {
          (fila as any)[k] = ((fila as any)[k] ?? 0) - op.decrement;
          continue;
        }
        if ('set' in op) {
          (fila as any)[k] = (op as any).set;
          continue;
        }
      }
      (fila as any)[k] = v;
    }
    if ('updatedAt' in fila) (fila as any).updatedAt = new Date();
  };

  const insertar = <T>(tabla: T[], fila: T) => {
    tabla.push(fila);
    anotar(() => {
      const i = tabla.indexOf(fila);
      if (i >= 0) tabla.splice(i, 1);
    });
    return fila;
  };

  type Relaciones = Record<string, (fila: any, sub: any) => unknown>;

  /**
   * Devuelve la fila tal y como la devolvería Prisma con ese `select`/`include`.
   * Estricto a propósito: sin pedir la relación, la relación no viene.
   */
  function proyectar(fila: any, op: Opciones, rel: Relaciones): any {
    if (op?.select) {
      const salida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(op.select)) {
        if (!v) continue;
        salida[k] = rel[k] ? rel[k](fila, v) : fila[k];
      }
      return salida;
    }
    const salida: Record<string, unknown> = { ...fila };
    if (op?.include) {
      for (const [k, v] of Object.entries(op.include)) {
        if (!v) continue;
        if (rel[k]) salida[k] = rel[k](fila, v);
      }
    }
    return salida;
  }

  const relPlan: Relaciones = {
    tramos: (p: FilaPlan, sub: any) => {
      const lista = bd.tramos.filter((t) => t.planId === p.id);
      if (sub?.orderBy?.desdeDia === 'asc') {
        lista.sort((a, b) => a.desdeDia - b.desdeDia);
      }
      return lista.map((t) => ({ ...t }));
    },
  };

  const relMembresia: Relaciones = {
    plan: (m: FilaMembresia, sub: any) => {
      const p = bd.planes.find((x) => x.id === m.planId);
      return p ? proyectar(p, sub === true ? undefined : sub, relPlan) : null;
    },
    customer: (m: FilaMembresia, sub: any) => {
      const c = bd.clientes.find((x) => x.id === m.customerId);
      return c ? proyectar(c, sub === true ? undefined : sub, {}) : null;
    },
    pass: (m: FilaMembresia, sub: any) => {
      const p = bd.pases.find((x) => x.id === m.passId);
      return p ? proyectar(p, sub === true ? undefined : sub, {}) : null;
    },
  };

  const relConsumo: Relaciones = {
    membresia: (c: FilaConsumo, sub: any) => {
      const m = bd.membresias.find((x) => x.id === c.membresiaId);
      return m ? proyectar(m, sub === true ? undefined : sub, relMembresia) : null;
    },
  };

  /** `where` con relaciones anidadas: `{ plan: { tenantId } }`. */
  const filtra = (fila: any, where: any, rel: Relaciones): boolean => {
    if (!where) return true;
    for (const [k, cond] of Object.entries(where)) {
      if (rel[k]) {
        const relacionada: any = rel[k](fila, true);
        if (!relacionada) return false;
        if (!filtra(relacionada, cond, {})) return false;
        continue;
      }
      if (!cumple(fila[k], cond)) return false;
    }
    return true;
  };

  const buscarMembresia = (where: any): FilaMembresia | undefined => {
    if (where?.planId_customerId) {
      const { planId, customerId } = where.planId_customerId;
      return bd.membresias.find(
        (m) => m.planId === planId && m.customerId === customerId,
      );
    }
    return bd.membresias.find((m) => filtra(m, where, relMembresia));
  };

  const buscarPase = (where: any): FilaPase | undefined => {
    if (where?.cardId_customerId) {
      const { cardId, customerId } = where.cardId_customerId;
      return bd.pases.find(
        (p) => p.cardId === cardId && p.customerId === customerId,
      );
    }
    return bd.pases.find((p) => filtra(p, where, {}));
  };

  const clubPlan = {
    findFirst: async ({ where, include }: any) => {
      const p = bd.planes.find((x) => filtra(x, where, relPlan));
      return p ? proyectar(p, { include }, relPlan) : null;
    },
    findMany: async ({ where, include, orderBy }: any) => {
      const lista = bd.planes.filter((x) => filtra(x, where, relPlan));
      if (orderBy?.createdAt === 'desc') {
        lista.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return lista.map((p) => proyectar(p, { include }, relPlan));
    },
    create: async ({ data, include }: any) => {
      const { tramos, ...campos } = data;
      // El índice único [tenantId, slug]: dos planes con el mismo nombre
      // chocan aquí, igual que en producción.
      if (
        bd.planes.some(
          (p) => p.tenantId === campos.tenantId && p.slug === campos.slug,
        )
      ) {
        throw new ErrorP2002(['tenantId', 'slug']);
      }
      const fila: FilaPlan = {
        id: nuevoId('plan'),
        description: '',
        beneficiosPorMes: 10,
        unidad: 'beneficio',
        precioCents: 0,
        currency: 'COP',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...campos,
      };
      insertar(bd.planes, fila);
      for (const t of tramos?.create ?? []) {
        insertar(bd.tramos, { id: nuevoId('tramo'), planId: fila.id, ...t });
      }
      return proyectar(fila, { include }, relPlan);
    },
    update: async ({ where, data, include }: any) => {
      const p = bd.planes.find((x) => x.id === where.id);
      if (!p) throw new ErrorP2025();
      escribir(p, data);
      return proyectar(p, { include }, relPlan);
    },
  };

  const clubTramoAlta = {
    deleteMany: async ({ where }: any) => {
      const fuera = bd.tramos.filter((t) => filtra(t, where, {}));
      for (const t of fuera) {
        const i = bd.tramos.indexOf(t);
        bd.tramos.splice(i, 1);
        anotar(() => bd.tramos.push(t));
      }
      return { count: fuera.length };
    },
    createMany: async ({ data }: any) => {
      for (const t of data) {
        insertar(bd.tramos, { id: nuevoId('tramo'), ...t });
      }
      return { count: data.length };
    },
  };

  const card = {
    findFirst: async ({ where, select, include }: any) => {
      const c = bd.tarjetas.find((x) => filtra(x, where, {}));
      return c ? proyectar(c, { select, include }, {}) : null;
    },
    findFirstOrThrow: async ({ where, select, include }: any) => {
      const c = bd.tarjetas.find((x) => filtra(x, where, {}));
      if (!c) throw new ErrorP2025();
      return proyectar(c, { select, include }, {});
    },
    create: async ({ data }: any) => {
      await disparar('antesDeCrearTarjeta');
      // El índice único `[tenantId, clubPlanId]`: una sola plantilla por plan.
      if (
        data.clubPlanId &&
        bd.tarjetas.some(
          (c) => c.tenantId === data.tenantId && c.clubPlanId === data.clubPlanId,
        )
      ) {
        throw new ErrorP2002(['tenantId', 'clubPlanId']);
      }
      const fila: FilaTarjeta = {
        id: nuevoId('card'),
        clubPlanId: null,
        type: 'STAMPS',
        stampsRequired: 0,
        rewardText: '',
        isActive: true,
        ...data,
      };
      return { ...insertar(bd.tarjetas, fila) };
    },
    // La usa `actualizarPlan` para llevar el nombre y el cupo nuevos a la
    // tarjeta-plantilla: sin sincronizarla, la billetera decía «15 / 10».
    updateMany: async ({ where, data }: any) => {
      const filas = bd.tarjetas.filter((x) => filtra(x, where, {}));
      for (const f of filas) Object.assign(f, data);
      return { count: filas.length };
    },
  };

  const pass = {
    findUnique: async ({ where, select, include }: any) => {
      const p = buscarPase(where);
      return p ? proyectar(p, { select, include }, {}) : null;
    },
    findUniqueOrThrow: async ({ where, select, include }: any) => {
      const p = buscarPase(where);
      if (!p) throw new ErrorP2025();
      return proyectar(p, { select, include }, {});
    },
    findFirst: async ({ where, select, include }: any) => {
      const p = bd.pases.find((x) => filtra(x, where, {}));
      return p ? proyectar(p, { select, include }, {}) : null;
    },
    create: async ({ data }: any) => {
      // Índice único [cardId, customerId]: un cliente, un pase por tarjeta.
      if (
        bd.pases.some(
          (p) => p.cardId === data.cardId && p.customerId === data.customerId,
        )
      ) {
        throw new ErrorP2002(['cardId', 'customerId']);
      }
      const fila: FilaPase = {
        id: nuevoId('pass'),
        stampsCount: 0,
        status: 'ACTIVE',
        lastActivityAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      return { ...insertar(bd.pases, fila) };
    },
    update: async ({ where, data, select, include }: any) => {
      await disparar('antesDeReponerPase');
      const p = buscarPase(where);
      if (!p) throw new ErrorP2025();
      escribir(p, data);
      return proyectar(p, { select, include }, {});
    },
    updateMany: async ({ where, data }: any) => {
      await disparar('antesDeDescontar');
      const filas = bd.pases.filter((x) => filtra(x, where, {}));
      for (const f of filas) escribir(f, data);
      return { count: filas.length };
    },
  };

  const clubMembresia = {
    findUnique: async ({ where, include, select }: any) => {
      const m = buscarMembresia(where);
      return m ? proyectar(m, { include, select }, relMembresia) : null;
    },
    findUniqueOrThrow: async ({ where, include, select }: any) => {
      const m = buscarMembresia(where);
      if (!m) throw new ErrorP2025();
      return proyectar(m, { include, select }, relMembresia);
    },
    findFirst: async ({ where, include, select }: any) => {
      const m = bd.membresias.find((x) => filtra(x, where, relMembresia));
      return m ? proyectar(m, { include, select }, relMembresia) : null;
    },
    findMany: async ({ where, include, select, take }: any) => {
      const lista = bd.membresias.filter((x) => filtra(x, where, relMembresia));
      const cortada = take ? lista.slice(0, take) : lista;
      return cortada.map((m) => proyectar(m, { include, select }, relMembresia));
    },
    create: async ({ data }: any) => {
      await disparar('antesDeCrearMembresia');
      // El índice único [planId, customerId] es la red de verdad contra el
      // doble clic en «dar de alta».
      if (
        bd.membresias.some(
          (m) => m.planId === data.planId && m.customerId === data.customerId,
        )
      ) {
        throw new ErrorP2002(['planId', 'customerId']);
      }
      const fila: FilaMembresia = {
        id: nuevoId('mem'),
        passId: null,
        status: 'ACTIVA',
        cupoDelPeriodo: 0,
        createdAt: new Date(),
        pausedAt: null,
        updatedAt: new Date(),
        ...data,
      };
      return { ...insertar(bd.membresias, fila) };
    },
    update: async ({ where, data, select, include }: any) => {
      const m = buscarMembresia(where);
      if (!m) throw new ErrorP2025();
      escribir(m, data);
      return proyectar(m, { select, include }, relMembresia);
    },
    updateMany: async ({ where, data }: any) => {
      await disparar('antesDeAvanzarPeriodo');
      const filas = bd.membresias.filter((x) => filtra(x, where, relMembresia));
      for (const f of filas) escribir(f, data);
      return { count: filas.length };
    },
    groupBy: async ({ by, where }: any) => {
      const filas = bd.membresias.filter((x) => filtra(x, where, relMembresia));
      const mapa = new Map<string, any>();
      for (const f of filas) {
        const clave = by.map((c: string) => (f as any)[c]).join('|');
        const previo = mapa.get(clave);
        if (previo) {
          previo._count._all += 1;
          continue;
        }
        const entrada: any = { _count: { _all: 1 } };
        for (const c of by) entrada[c] = (f as any)[c];
        mapa.set(clave, entrada);
      }
      return [...mapa.values()];
    },
  };

  const clubConsumo = {
    findUnique: async ({ where, include, select }: any) => {
      const c = bd.consumos.find((x) => x.id === where.id);
      return c ? proyectar(c, { include, select }, relConsumo) : null;
    },
    findMany: async ({ where, include, select, orderBy, skip, take }: any) => {
      let filas = bd.consumos.filter((x) => filtra(x, where, relConsumo));
      // El historial ordena por fecha descendente y pagina.
      if (orderBy?.createdAt) {
        const dir = orderBy.createdAt === 'desc' ? -1 : 1;
        filas = [...filas].sort(
          (a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()),
        );
      }
      if (skip) filas = filas.slice(skip);
      if (take) filas = filas.slice(0, take);
      return filas.map((c) =>
        include || select ? proyectar(c, { include, select }, relConsumo) : { ...c },
      );
    },
    count: async ({ where }: any) =>
      bd.consumos.filter((x) => filtra(x, where, relConsumo)).length,
    /** Solo `_sum.cantidad`, que es lo único que usa el historial. */
    aggregate: async ({ where }: any) => ({
      _sum: {
        cantidad: bd.consumos
          .filter((x) => filtra(x, where, relConsumo))
          .reduce((t, c) => t + c.cantidad, 0),
      },
    }),
    create: async ({ data }: any) => {
      const fn = ganchos.antesDeCrearConsumo;
      if (fn) {
        ganchos.antesDeCrearConsumo = null;
        fn();
      }
      const fila: FilaConsumo = {
        id: nuevoId('con'),
        cantidad: 1,
        actorId: null,
        locationId: null,
        revertedAt: null,
        revertedBy: null,
        createdAt: new Date(),
        ...data,
      };
      return { ...insertar(bd.consumos, fila) };
    },
    updateMany: async ({ where, data }: any) => {
      await disparar('antesDeMarcarAnulacion');
      const filas = bd.consumos.filter((x) => filtra(x, where, relConsumo));
      for (const f of filas) escribir(f, data);
      return { count: filas.length };
    },
  };

  const customer = {
    findFirst: async ({ where, select }: any) => {
      const c = bd.clientes.find((x) => filtra(x, where, {}));
      return c ? proyectar(c, { select }, {}) : null;
    },
  };

  /**
   * El negocio. Solo hacen falta dos cosas de él y las dos son nuevas:
   *
   *  · `clubEnabled` — el interruptor del módulo. Por defecto ENCENDIDO en los
   *    tests: lo que se prueba aquí es el motor, no el interruptor, y tenerlo
   *    apagado obligaría a encenderlo en cada caso.
   *  · Los colores y el logo — la tarjeta del plan los copia explícitamente
   *    para no nacer con el verde de la plataforma en una marca blanca.
   */
  const tenant = {
    findUnique: async ({ select }: any) => {
      const fila = {
        clubEnabled: bd.clubEnabled,
        primaryColor: '#111111',
        secondaryColor: '#222222',
        logoUrl: null,
        brandName: 'Negocio de prueba',
      };
      return proyectar(fila, { select }, {});
    },
  };

  const prisma: any = {
    tenant,
    clubPlan,
    clubTramoAlta,
    clubMembresia,
    clubConsumo,
    card,
    pass,
    customer,
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      const propio: Array<() => void> = [];
      return contexto.run(propio, async () => {
        try {
          return await fn(prisma);
        } catch (e) {
          // Rollback: se deshace en orden inverso, como haría Postgres, y solo
          // lo de ESTA transacción.
          for (const u of propio.reverse()) u();
          throw e;
        }
      });
    },
  };

  return { prisma, ganchos };
}

/** Base de datos vacía. */
export function bdVacia(): BaseDeDatos {
  return {
    planes: [],
    tramos: [],
    tarjetas: [],
    clubEnabled: true,
    pases: [],
    membresias: [],
    consumos: [],
    clientes: [],
  };
}

/**
 * Dobles de las dos dependencias nuevas del servicio.
 *
 * `empujarPase` es fuego y olvido: encola en BullMQ y, si no hay Redis, cae al
 * push directo. Los tests miran que se avise a la billetera, porque sin eso el
 * cliente consume un café y su tarjeta sigue diciendo lo mismo.
 */
export function crearBilletera() {
  const empujados: Array<{ passId: string; motivo: string }> = [];
  const jobs = {
    enqueue: async (_nombre: string, datos: { passId: string; reason: string }) => {
      empujados.push({ passId: datos.passId, motivo: datos.reason });
    },
  };
  const wallet = {
    pushPassUpdate: async (passId: string) => {
      empujados.push({ passId, motivo: 'directo' });
    },
  };
  return { jobs, wallet, empujados };
}

/** Deja correr las microtareas pendientes: los `await` de la llamada rival. */
export async function respirar(veces = 6): Promise<void> {
  for (let i = 0; i < veces; i++) await Promise.resolve();
}
