import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import {
  bdVacia,
  crearPrismaFalso,
  type FilaMembresia,
  crearBilletera,
  type BaseDeDatos,
  type EstadoMembresia,
  type Ganchos,
} from './club-prisma-falso';

/**
 * El reinicio mensual del cupo, contra el cron REAL (`reiniciarCupos`).
 *
 * La regla que define el producto: el cupo se ASIGNA cada mes, no se acumula.
 * Consumir 3 de 10 deja 10 el mes siguiente, no 17. Y como el cron corre cada
 * hora, tiene que poder correr cien veces el mismo mes sin regalar nada.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};

let bd: BaseDeDatos;
let ganchos: Ganchos;
let svc: ClubService;

function montar(beneficiosPorMes = 10) {
  bd = bdVacia();
  bd.planes.push({
    id: 'p1',
    tenantId: 't1',
    name: 'Café Diario',
    slug: 'cafe-diario',
    description: '',
    beneficiosPorMes,
    unidad: 'café',
    precioCents: 60000,
    currency: 'COP',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' });
  const falso = crearPrismaFalso(bd);
  ganchos = falso.ganchos;
  const billetera = crearBilletera();
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
  );
}

function conMembresia(
  id: string,
  saldo: number,
  periodo: string,
  status: EstadoMembresia = 'ACTIVA',
  planId = 'p1',
) {
  // El saldo vivo NO está en la membresía: vive en `Pass.stampsCount`, el mismo
  // contador que usan todas las tarjetas. Por eso el helper crea las DOS filas.
  bd.pases.push({
    id: `pass-${id}`,
    tenantId: 't1',
    cardId: 'card1',
    customerId: `cli-${id}`,
    serialNumber: `CLB-${id.toUpperCase()}`,
    qrToken: `qr-${id}`,
    authToken: `auth-${id}`,
    stampsCount: saldo,
    status: 'ACTIVE',
    lastActivityAt: null,
    createdAt: new Date('2026-01-05'),
    updatedAt: new Date('2026-01-05'),
  });
  bd.membresias.push({
    id,
    planId,
    customerId: `cli-${id}`,
    passId: `pass-${id}`,
    status,
    periodo,
    cupoDelPeriodo: 10,
    createdAt: new Date('2026-01-05'),
    pausedAt: status === 'PAUSADA' ? new Date('2026-06-10') : null,
    updatedAt: new Date('2026-01-05'),
  });
  // Se devuelve la fila VIVA, no una copia: las pruebas comprueban que el
  // servicio le cambió el período y el cupo, y sobre una copia esos cambios
  // no se verían nunca.
  const fila = bd.membresias[bd.membresias.length - 1];
  // `saldo` derivado, para que las pruebas se lean igual que antes: siempre
  // devuelve lo que hay AHORA en el pase.
  Object.defineProperty(fila, 'saldo', {
    get: () => bd.pases.find((x) => x.id === `pass-${id}`)?.stampsCount ?? 0,
    // Con setter: sin él, cualquier escritura sobre la fila que mencione
    // `saldo` revienta con «only a getter» y el fallo no dice nada útil.
    // Escribirlo va al pase, que es donde vive de verdad.
    set: (v: number) => {
      const pase = bd.pases.find((x) => x.id === `pass-${id}`);
      if (pase) pase.stampsCount = v;
    },
    enumerable: false,
    configurable: true,
  });
  return fila as FilaMembresia & { saldo: number };
}

/** Congela el reloj en un instante de Bogotá dado en UTC. */
function enFecha(iso: string) {
  vi.setSystemTime(new Date(iso));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  enFecha('2026-09-15T17:00:00Z'); // 15 de septiembre, mediodía en Bogotá
  montar();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('el cupo se asigna cada mes, nunca se suma', () => {
  it('quien gastó 3 de 10 empieza el mes nuevo con 10, no con 17', async () => {
    const m = conMembresia('m1', 7, '2026-08');
    const r = await svc.reiniciarCupos();
    expect(r).toEqual({ periodo: '2026-09', reiniciadas: 1 });
    expect(m.saldo).toBe(10);
    expect(m.periodo).toBe('2026-09');
  });

  it('quien no gastó nada tampoco arrastra: 10 y 10', async () => {
    const gastoTodo = conMembresia('m1', 0, '2026-08');
    const gastoNada = conMembresia('m2', 10, '2026-08');
    await svc.reiniciarCupos();
    expect(gastoTodo.saldo).toBe(10);
    expect(gastoNada.saldo).toBe(10);
  });

  it('dos pasadas seguidas del cron no regalan un segundo cupo', async () => {
    // Es toda la idempotencia del reinicio: se compara el período GUARDADO con
    // el actual. Con un `saldo += cupo` la segunda pasada duplicaría el mes.
    const m = conMembresia('m1', 2, '2026-08');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 1 });
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(m.saldo).toBe(10);
  });

  it('el cron no pisa lo que el cliente ya gastó este mes', async () => {
    // Alguien ya está en el período actual con saldo 4 porque consumió 6.
    // Una pasada del cron no puede devolvérselos.
    const m = conMembresia('m1', 4, '2026-09');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(m.saldo).toBe(4);
  });

  it('también actualiza el cupo del período, no solo el saldo', async () => {
    const m = conMembresia('m1', 0, '2026-08');
    bd.planes[0].beneficiosPorMes = 25;
    await svc.reiniciarCupos();
    expect(m.saldo).toBe(25);
    expect(m.cupoDelPeriodo).toBe(25);
  });
});

describe('pausas', () => {
  it('una membresía pausada no se reinicia: si no paga, no recibe', async () => {
    const m = conMembresia('m1', 2, '2026-08', 'PAUSADA');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(m.saldo).toBe(2);
    expect(m.periodo).toBe('2026-08'); // se queda congelada donde estaba
  });

  it('una cancelada tampoco', async () => {
    const m = conMembresia('m1', 5, '2026-08', 'CANCELADA');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(m.saldo).toBe(5);
  });

  it('volver de tres meses de pausa da UN cupo, no tres', async () => {
    // Se compara el período guardado con el ACTUAL; no se cuentan los meses
    // transcurridos. Si se contaran, quien vuelve de una pausa larga cobraría
    // los meses que no pagó.
    const m = conMembresia('m1', 2, '2026-06', 'PAUSADA');
    await svc.cambiarEstado(DUENO, 'm1', 'ACTIVA');
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 1 });
    expect(m.saldo).toBe(10); // no 30
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });
    expect(m.saldo).toBe(10);
  });

  it('reactivar dentro del mismo mes conserva el saldo, no lo rellena', async () => {
    const m = conMembresia('m1', 3, '2026-09');
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');
    await svc.cambiarEstado(DUENO, 'm1', 'ACTIVA');
    await svc.reiniciarCupos();
    expect(m.saldo).toBe(3);
  });

  it('reactivar el día 28 da el mes entero: la reactivación NO prorratea', async () => {
    // Los tramos de alta sólo se aplican al alta. Quien vuelve de una pausa el
    // 28 recibe el cupo completo por tres días. Queda pinchado aquí porque es
    // una decisión, no un descuido: si algún día se prorratea, este test se
    // pone rojo y obliga a mirarlo.
    enFecha('2026-09-28T17:00:00Z');
    const m = conMembresia('m1', 1, '2026-08', 'PAUSADA');
    await svc.cambiarEstado(DUENO, 'm1', 'ACTIVA');
    await svc.reiniciarCupos();
    expect(m.saldo).toBe(10);
  });
});

describe('cuando el negocio toca el plan a mitad de mes', () => {
  it('subir el cupo no le da nada a nadie hasta el mes siguiente', async () => {
    const m = conMembresia('m1', 4, '2026-09');
    await svc.actualizarPlan(DUENO, 'p1', { beneficiosPorMes: 20 });
    // El mes en curso no cambia: el histórico de "llevas 6 de 10" se mantiene.
    expect(m.saldo).toBe(4);
    expect(m.cupoDelPeriodo).toBe(10);
    expect(await svc.reiniciarCupos()).toMatchObject({ reiniciadas: 0 });

    enFecha('2026-10-03T17:00:00Z');
    await svc.reiniciarCupos();
    expect(m.saldo).toBe(20);
    expect(m.cupoDelPeriodo).toBe(20);
  });

  it('bajar el cupo no le quita al que ya lo tiene este mes', async () => {
    // Sería feísimo: el cliente ve 9 cafés en el pase y de repente tiene 2.
    const m = conMembresia('m1', 9, '2026-09');
    await svc.actualizarPlan(DUENO, 'p1', { beneficiosPorMes: 2 });
    expect(m.saldo).toBe(9);

    enFecha('2026-10-03T17:00:00Z');
    await svc.reiniciarCupos();
    expect(m.saldo).toBe(2); // el mes siguiente sí manda el plan nuevo
  });

  it('apagar el plan no corta el cupo de los que ya están dentro', async () => {
    // `isActive:false` sólo impide altas nuevas. Para cortarle el cupo a un
    // miembro hay que pausarlo. Pinchado porque es fácil creer lo contrario.
    const m = conMembresia('m1', 0, '2026-08');
    await svc.actualizarPlan(DUENO, 'p1', { isActive: false });
    await svc.reiniciarCupos();
    expect(m.saldo).toBe(10);
  });
});

describe('el cron corriendo dos veces a la vez', () => {
  it('si otra pasada ya reinició la fila, ésta no vuelve a asignar', async () => {
    // El `updateMany` va condicionado al período VIEJO. Sin esa condición, la
    // pasada lenta pisaría lo que el cliente ya gastó del mes nuevo.
    const m = conMembresia('m1', 0, '2026-08');
    // `antesDeAvanzarPeriodo` y no `antesDeDescontar`: la carrera de verdad
    // ocurre ANTES de marcar el período nuevo. Enganchada después, la otra
    // pasada ya no puede colarse — las dos escrituras van en una transacción.
    ganchos.antesDeAvanzarPeriodo = () => {
      // La otra pasada reinició a 10 y el cliente ya se tomó dos cafés.
      m.periodo = '2026-09';
      m.saldo = 8;
      m.cupoDelPeriodo = 10;
    };
    const r = await svc.reiniciarCupos();
    expect(r.reiniciadas).toBe(0);
    expect(m.saldo).toBe(8); // no vuelve a 10
  });
});

describe('el mes del cron es el de Bogotá', () => {
  it('a las 20:00 del 30 de septiembre todavía es septiembre', async () => {
    // 01:00 UTC del 1 de octubre son las 20:00 del 30 en Bogotá. Si el cron
    // contara en UTC, reiniciaría un día antes y le borraría a todo el mundo
    // el saldo que aún tenía derecho a gastar esa noche.
    enFecha('2026-10-01T01:00:00Z');
    const m = conMembresia('m1', 3, '2026-09');
    const r = await svc.reiniciarCupos();
    expect(r.periodo).toBe('2026-09');
    expect(r.reiniciadas).toBe(0);
    expect(m.saldo).toBe(3);
  });

  it('a las 00:30 del 1 de octubre ya reinicia', async () => {
    enFecha('2026-10-01T05:30:00Z');
    const m = conMembresia('m1', 3, '2026-09');
    const r = await svc.reiniciarCupos();
    expect(r.periodo).toBe('2026-10');
    expect(m.saldo).toBe(10);
  });

  it('el cambio de año no se salta el reinicio', async () => {
    enFecha('2027-01-01T05:30:00Z');
    const m = conMembresia('m1', 1, '2026-12');
    const r = await svc.reiniciarCupos();
    expect(r.periodo).toBe('2027-01');
    expect(m.saldo).toBe(10);
  });
});

describe('el cron es de toda la plataforma', () => {
  it('reinicia membresías de negocios distintos en la misma pasada', async () => {
    bd.planes.push({
      ...bd.planes[0],
      id: 'p2',
      tenantId: 't2',
      slug: 'otro',
      beneficiosPorMes: 4,
    });
    const a = conMembresia('m1', 0, '2026-08');
    const b = conMembresia('m2', 0, '2026-08', 'ACTIVA', 'p2');
    const r = await svc.reiniciarCupos();
    expect(r.reiniciadas).toBe(2);
    expect(a.saldo).toBe(10);
    expect(b.saldo).toBe(4); // cada uno con el cupo de SU plan
  });

  it('sin nada pendiente no toca la base y lo dice', async () => {
    conMembresia('m1', 5, '2026-09');
    expect(await svc.reiniciarCupos()).toEqual({
      periodo: '2026-09',
      reiniciadas: 0,
    });
  });
});
