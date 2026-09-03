import { describe, it, expect, beforeEach } from 'vitest';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { CustomersService } from './customers.service';

/**
 * Fusión de clientes × Tarjeta de Club.
 *
 * El bug que esto vigila: `merge` borra el Customer perdedor y el FK de
 * `ClubMembresia` es onDelete: Cascade — si la membresía no se mueve antes,
 * se va con su saldo y todos sus `ClubConsumo`, en silencio. El Prisma falso
 * de abajo reproduce esos cascades y el índice único (planId, customerId):
 * si alguien quita el traslado, o mueve "a ciegas" cuando los dos clientes
 * tienen membresía del mismo plan, estos tests se ponen rojos.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};

type Membresia = {
  id: string;
  planId: string;
  customerId: string;
  passId: string | null;
  status: string;
  saldo: number;
  periodo: string;
  cupoDelPeriodo: number;
  createdAt: Date;
};
type Consumo = { id: string; membresiaId: string; cantidad: number };
type Cliente = {
  id: string;
  tenantId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthday: Date | null;
  tags: string[];
  notes: string | null;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
};

let clientes: Cliente[];
let membresias: Membresia[];
let consumos: Consumo[];

function cliente(id: string, fullName: string): Cliente {
  return {
    id,
    tenantId: 't1',
    fullName,
    email: null,
    phone: null,
    birthday: null,
    tags: [],
    notes: null,
    firstOrderAt: null,
    lastOrderAt: null,
  };
}

/**
 * Prisma falso mínimo para `merge`. Solo modela de verdad lo que el bug
 * necesita: membresías/consumos con sus cascades y uniques. El resto de
 * entidades (orders, carts, mensajes…) responde vacío.
 */
function crearPrismaFalso() {
  const nada = async () => ({ count: 0 });

  // El saldo vivo no está en la membresía: vive en `Pass.stampsCount`. En este
  // doble, el campo `saldo` de la fila ES ese contador, así que se proyecta
  // como el `include: { pass: ... }` que pide la fusión para decidir cuál
  // sobrevive. Sin esto, ambas membresías parecían tener saldo 0 y ganaba
  // siempre la más antigua.
  const conPase = (m: any) =>
    m && { ...m, pass: { stampsCount: m.saldo } };

  const clubMembresia = {
    findMany: async ({ where }: any) =>
      membresias.filter((m) => m.customerId === where.customerId).map(conPase),
    findUnique: async ({ where }: any) => {
      const k = where.planId_customerId;
      return (
        conPase(
          membresias.find(
            (m) => m.planId === k.planId && m.customerId === k.customerId,
          ),
        ) ?? null
      );
    },
    update: async ({ where, data }: any) => {
      const m = membresias.find((x) => x.id === where.id);
      if (!m) throw new Error(`update de membresía inexistente ${where.id}`);
      const next = { ...m, ...data };
      // Índice único real (planId, customerId): mover a ciegas debe reventar
      // aquí igual que reventaría en Postgres (P2002).
      const choque = membresias.find(
        (x) =>
          x.id !== m.id &&
          x.planId === next.planId &&
          x.customerId === next.customerId,
      );
      if (choque) {
        throw new Error('P2002: unique (planId, customerId) violado');
      }
      // passId también es @unique.
      if (next.passId) {
        const choquePass = membresias.find(
          (x) => x.id !== m.id && x.passId === next.passId,
        );
        if (choquePass) throw new Error('P2002: unique passId violado');
      }
      Object.assign(m, data);
      return m;
    },
    delete: async ({ where }: any) => {
      const m = membresias.find((x) => x.id === where.id);
      if (!m) throw new Error(`delete de membresía inexistente ${where.id}`);
      membresias = membresias.filter((x) => x.id !== where.id);
      // Cascade real: ClubConsumo.membresiaId es onDelete: Cascade. Si el
      // servicio borra la perdedora ANTES de mover sus consumos, se pierden
      // — y este fake lo refleja para que el test lo delate.
      consumos = consumos.filter((c) => c.membresiaId !== where.id);
      return m;
    },
  };

  const fake: any = {
    customer: {
      findUnique: async ({ where }: any) => {
        const c = clientes.find((x) => x.id === where.id);
        return c ? { ...c, passes: [], stamps: [] } : null;
      },
      findMany: async ({ where }: any) =>
        clientes.filter(
          (c) => where.id.in.includes(c.id) && c.tenantId === where.tenantId,
        ),
      update: async ({ where, data }: any) => {
        const c = clientes.find((x) => x.id === where.id);
        if (!c) throw new Error(`update de cliente inexistente ${where.id}`);
        Object.assign(c, data);
        return c;
      },
      delete: async ({ where }: any) => {
        clientes = clientes.filter((x) => x.id !== where.id);
        // Cascade real de ClubMembresia.customerId (y de ahí a ClubConsumo):
        // esto es exactamente la pérdida silenciosa que el traslado evita.
        const muertas = membresias.filter((m) => m.customerId === where.id);
        membresias = membresias.filter((m) => m.customerId !== where.id);
        for (const m of muertas) {
          consumos = consumos.filter((c) => c.membresiaId !== m.id);
        }
        return {};
      },
    },
    pass: { findMany: async () => [] },
    stamp: { updateMany: nada },
    order: {
      findMany: async () => [],
      updateMany: nada,
      aggregate: async ({ _sum }: any) =>
        _sum
          ? { _sum: { total: null } }
          : {
              _count: { _all: 0 },
              _min: { createdAt: null },
              _max: { createdAt: null },
            },
    },
    cart: { updateMany: nada },
    message: { updateMany: nada },
    reservation: { updateMany: nada },
    eventAttendee: { updateMany: nada },
    notification: { updateMany: nada },
    clubMembresia,
    // Estas pruebas van de membresías de club, no de tarjetas de alianza. El
    // doble devuelve vacío para que el bloque de alianzas del merge —añadido
    // después de escribir este fichero— no reviente al no encontrar el modelo.
    convenioTarjeta: {
      findMany: async () => [],
      findUnique: async () => null,
      update: nada,
      delete: nada,
    },
    convenioCanje: { updateMany: nada },
    clubConsumo: {
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const c of consumos) {
          if (c.membresiaId === where.membresiaId) {
            c.membresiaId = data.membresiaId;
            count++;
          }
        }
        return { count };
      },
    },
    $executeRawUnsafe: async () => 0,
  };
  fake.$transaction = async (fn: (tx: any) => Promise<any>) => fn(fake);
  return fake;
}

function crearServicio(): CustomersService {
  return new CustomersService(crearPrismaFalso(), {} as any);
}

beforeEach(() => {
  clientes = [cliente('keep', 'Ana Ruiz'), cliente('src', 'Ana R.')];
  membresias = [];
  consumos = [];
});

describe('merge de clientes con membresías de club', () => {
  it('sin colisión (planes distintos): la membresía se mueve al keeper con saldo y consumos intactos', async () => {
    membresias.push({
      id: 'm-src',
      planId: 'plan-b',
      customerId: 'src',
      passId: null,
      status: 'ACTIVA',
      saldo: 6,
      periodo: '2026-09',
      cupoDelPeriodo: 10,
      createdAt: new Date('2026-08-01'),
    });
    consumos.push({ id: 'c1', membresiaId: 'm-src', cantidad: 1 });

    const r = await crearServicio().merge(DUENO, 'keep', ['src']);

    expect(r.movedMembresias).toBe(1);
    expect(r.mergedMembresias).toBe(0);
    expect(membresias).toHaveLength(1);
    expect(membresias[0]).toMatchObject({
      id: 'm-src',
      customerId: 'keep',
      saldo: 6,
    });
    expect(consumos).toHaveLength(1);
  });

  it('colisión del MISMO plan: sobrevive la de mayor saldo y hereda los consumos de la otra', async () => {
    membresias.push(
      {
        id: 'm-keep',
        planId: 'plan-a',
        customerId: 'keep',
        passId: null,
        status: 'ACTIVA',
        saldo: 2,
        periodo: '2026-09',
        cupoDelPeriodo: 10,
        createdAt: new Date('2026-07-01'),
      },
      {
        id: 'm-src',
        planId: 'plan-a',
        customerId: 'src',
        passId: null,
        status: 'ACTIVA',
        saldo: 7,
        periodo: '2026-09',
        cupoDelPeriodo: 10,
        createdAt: new Date('2026-08-15'),
      },
    );
    consumos.push(
      { id: 'c-keep', membresiaId: 'm-keep', cantidad: 1 },
      { id: 'c-src1', membresiaId: 'm-src', cantidad: 1 },
      { id: 'c-src2', membresiaId: 'm-src', cantidad: 2 },
    );

    const r = await crearServicio().merge(DUENO, 'keep', ['src']);

    expect(r.mergedMembresias).toBe(1);
    // El cliente perdedor ya no existe, pero su saldo (el mayor) sobrevive
    // colgado del keeper — perderlo sería quitarle beneficios ya pagados.
    expect(membresias).toHaveLength(1);
    expect(membresias[0]).toMatchObject({
      id: 'm-src',
      customerId: 'keep',
      saldo: 7,
    });
    // Ningún consumo se pierde: los de la membresía borrada se re-cuelgan.
    expect(consumos).toHaveLength(3);
    expect(consumos.every((c) => c.membresiaId === 'm-src')).toBe(true);
  });

  it('colisión con empate de saldo: sobrevive la más antigua', async () => {
    membresias.push(
      {
        id: 'm-keep',
        planId: 'plan-a',
        customerId: 'keep',
        passId: null,
        status: 'ACTIVA',
        saldo: 5,
        periodo: '2026-09',
        cupoDelPeriodo: 10,
        createdAt: new Date('2026-03-01'), // la más antigua: alta real del socio
      },
      {
        id: 'm-src',
        planId: 'plan-a',
        customerId: 'src',
        passId: null,
        status: 'ACTIVA',
        saldo: 5,
        periodo: '2026-09',
        cupoDelPeriodo: 10,
        createdAt: new Date('2026-08-15'),
      },
    );
    consumos.push({ id: 'c-src', membresiaId: 'm-src', cantidad: 1 });

    const r = await crearServicio().merge(DUENO, 'keep', ['src']);

    expect(r.mergedMembresias).toBe(1);
    expect(membresias).toHaveLength(1);
    expect(membresias[0]).toMatchObject({ id: 'm-keep', customerId: 'keep' });
    expect(consumos).toEqual([
      { id: 'c-src', membresiaId: 'm-keep', cantidad: 1 },
    ]);
  });

  it('si la ganadora quedó sin pase, hereda el passId de la perdedora (el push sigue llegando)', async () => {
    membresias.push(
      {
        id: 'm-keep',
        planId: 'plan-a',
        customerId: 'keep',
        passId: 'pass-k', // el pase que sobrevivió a la fusión de pases
        status: 'ACTIVA',
        saldo: 1,
        periodo: '2026-09',
        cupoDelPeriodo: 10,
        createdAt: new Date('2026-07-01'),
      },
      {
        id: 'm-src',
        planId: 'plan-a',
        customerId: 'src',
        passId: null, // el suyo se borró en el paso 1 (SetNull)
        status: 'ACTIVA',
        saldo: 9,
        periodo: '2026-09',
        cupoDelPeriodo: 10,
        createdAt: new Date('2026-08-15'),
      },
    );

    await crearServicio().merge(DUENO, 'keep', ['src']);

    expect(membresias).toHaveLength(1);
    expect(membresias[0]).toMatchObject({
      id: 'm-src',
      customerId: 'keep',
      passId: 'pass-k',
    });
  });
});
