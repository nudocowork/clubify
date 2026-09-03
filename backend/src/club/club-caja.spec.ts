import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import {
  bdVacia,
  crearBilletera,
  crearAutomatizaciones,
  crearPrismaFalso,
  respirar,
  type BaseDeDatos,
  type Ganchos,
} from './club-prisma-falso';

/**
 * La caja de la Tarjeta de Club: descontar y anular.
 *
 * Todo lo de aquí llama al SERVICIO REAL contra un Prisma falso que respeta la
 * semántica de `updateMany` (where + data en el mismo paso, y `count` de
 * vuelta). Si alguien convierte el descuento en un leer-decidir-escribir, estos
 * tests se ponen rojos — que es exactamente el bug que más veces se ha repetido
 * en este repo y el que se lleva dinero del negocio.
 *
 * El saldo vive en `Pass.stampsCount`, no en la membresía.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};
const CAJERO: AuthUser = {
  id: 'u-cajero',
  email: 'caja@negocio.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  tenantId: 't1',
};
const OTRO_NEGOCIO: AuthUser = {
  id: 'u-ajeno',
  email: 'dueno@otro.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't2',
};

let bd: BaseDeDatos;
let ganchos: Ganchos;
let svc: ClubService;
let empujados: Array<{ passId: string; motivo: string }>;

/** Un negocio con un plan de 10 cafés al mes y un cliente dado de alta. */
function montar(saldo = 10, periodo = '2026-09') {
  bd = bdVacia();
  bd.planes.push({
    id: 'p1',
    tenantId: 't1',
    name: 'Café Diario',
    slug: 'cafe-diario',
    description: '',
    beneficiosPorMes: 10,
    unidad: 'café',
    precioCents: 60000,
    currency: 'COP',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' });
  bd.tarjetas.push({
    id: 'card1',
    tenantId: 't1',
    clubPlanId: 'p1',
    name: 'Café Diario',
    type: 'STAMPS',
    stampsRequired: 10,
    rewardText: '10 café al mes',
    isActive: true,
  });
  bd.pases.push({
    id: 'pass1',
    tenantId: 't1',
    cardId: 'card1',
    customerId: 'cli1',
    serialNumber: 'CLB-AAA',
    qrToken: 'qr1',
    authToken: 'auth1',
    stampsCount: saldo,
    status: 'ACTIVE',
    lastActivityAt: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
  });
  bd.membresias.push({
    id: 'm1',
    planId: 'p1',
    customerId: 'cli1',
    passId: 'pass1',
    status: 'ACTIVA',
    periodo,
    cupoDelPeriodo: 10,
    createdAt: new Date('2026-09-01'),
    pausedAt: null,
    updatedAt: new Date('2026-09-01'),
  });
  const falso = crearPrismaFalso(bd);
  const billetera = crearBilletera();
  ganchos = falso.ganchos;
  empujados = billetera.empujados;
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    crearAutomatizaciones().automations as unknown as AutomationsService,
  );
}

const membresia = () => bd.membresias[0];
/** El saldo vivo: está en el pase, no en la membresía. */
const saldo = () => bd.pases[0].stampsCount;

beforeEach(() => montar());

describe('descontar del cupo: el cliente nunca se lleva más de lo que tiene', () => {
  it('dos cajeros a la vez sobre el último café: solo uno se lo lleva', async () => {
    montar(1);

    // Se fuerza el orden que rompe el código ingenuo: los dos LEEN antes de que
    // ninguno escriba, y el gancho retiene además a A dentro del descuento
    // mientras B completa el suyo entero. Con un `if (saldo > 0) saldo--` los
    // dos pasarían el `if` y el cliente se llevaría dos cafés con uno de cupo.
    let soltarA!: () => void;
    const aEnEspera = new Promise<void>((r) => (soltarA = r));
    ganchos.antesDeDescontar = () => aEnEspera;

    const cajaA = svc.consumir(CAJERO, 'm1', 1);
    const cajaB = svc.consumir(CAJERO, 'm1', 1);
    await respirar();
    soltarA();

    const r = await Promise.allSettled([cajaA, cajaB]);
    const ok = r.filter((x) => x.status === 'fulfilled');
    const fallo = r.filter((x) => x.status === 'rejected');

    expect(ok).toHaveLength(1);
    expect(fallo).toHaveLength(1);
    expect((fallo[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConflictException,
    );
    expect(saldo()).toBe(0); // jamás -1
    expect(bd.consumos).toHaveLength(1); // un solo café servido
  });

  it('cinco cajeros a la vez con saldo 3: pasan tres, sobran dos', async () => {
    montar(3);
    const intentos = Array.from({ length: 5 }, () =>
      svc.consumir(CAJERO, 'm1', 1),
    );
    const r = await Promise.allSettled(intentos);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
    expect(saldo()).toBe(0);
    expect(bd.consumos).toHaveLength(3);
  });

  it('con saldo 0 no descuenta y lo dice con el cupo del mes', async () => {
    montar(0);
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      ConflictException,
    );
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      /Sin cupo: le quedan 0 de 10/,
    );
    expect(saldo()).toBe(0);
    expect(bd.consumos).toHaveLength(0);
  });

  it('pedir 3 cuando quedan 2 no descuenta NADA (ni deja el saldo en -1)', async () => {
    // El caso del pedido de dos cafés y un jugo: o entra entero o no entra.
    montar(2);
    await expect(svc.consumir(CAJERO, 'm1', 3)).rejects.toThrow(
      ConflictException,
    );
    expect(saldo()).toBe(2);
    expect(bd.consumos).toHaveLength(0);
  });

  it('consumir exactamente lo que queda sí pasa', async () => {
    montar(3);
    const r = await svc.consumir(CAJERO, 'm1', 3);
    expect(r.saldo).toBe(0);
    expect(saldo()).toBe(0);
  });

  it('una membresía pausada no consume, y lo dice claro', async () => {
    membresia().status = 'PAUSADA';
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      'Esta membresía está pausada.',
    );
    expect(saldo()).toBe(10);
  });

  it('una membresía cancelada tampoco', async () => {
    membresia().status = 'CANCELADA';
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      'Esta membresía está cancelada.',
    );
  });

  it('una membresía sin pase todavía no puede consumir', async () => {
    membresia().passId = null;
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      'Esta membresía todavía no tiene tarjeta.',
    );
  });

  it('cantidades absurdas se rechazan antes de tocar la base', async () => {
    for (const mala of [0, -1, 1.5, NaN, Infinity]) {
      await expect(svc.consumir(CAJERO, 'm1', mala)).rejects.toThrow(
        BadRequestException,
      );
    }
    expect(saldo()).toBe(10);
    expect(bd.consumos).toHaveLength(0);
  });

  it('el cajero de otro negocio no puede gastar el cupo de este', async () => {
    await expect(svc.consumir(OTRO_NEGOCIO, 'm1', 1)).rejects.toThrow(
      ForbiddenException,
    );
    expect(saldo()).toBe(10);
  });

  it('una membresía que no existe da 404', async () => {
    await expect(svc.consumir(CAJERO, 'no-existe', 1)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('el consumo deja rastro de cuánto, quién, dónde y con qué saldo quedó', async () => {
    const r = await svc.consumir(CAJERO, 'm1', 2, 'sede-norte');
    expect(r).toMatchObject({
      ok: true,
      saldo: 8,
      cupoDelPeriodo: 10,
      unidad: 'café',
    });
    expect(bd.consumos[0]).toMatchObject({
      membresiaId: 'm1',
      cantidad: 2,
      saldoResultante: 8, // redundante a propósito: delata un descuadre
      periodo: '2026-09',
      actorId: 'u-cajero',
      locationId: 'sede-norte',
      revertedAt: null,
    });
  });

  it('consumir refresca el pase del cliente en la billetera', async () => {
    // Sin esto el cliente se toma el café y su tarjeta sigue diciendo 10.
    await svc.consumir(CAJERO, 'm1', 1);
    await respirar();
    expect(empujados).toContainEqual({ passId: 'pass1', motivo: 'club.consumo' });
  });

  it('si falla el registro del consumo, el saldo NO se queda descontado', async () => {
    // Descuento y registro van en la misma transacción. Si se separaran, un
    // fallo aquí dejaría al cliente sin el café y sin poder reclamarlo: no
    // habría fila que anular.
    ganchos.antesDeCrearConsumo = () => {
      throw new Error('se cayó la base al escribir el consumo');
    };
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(/se cayó/);
    expect(saldo()).toBe(10);
    expect(bd.consumos).toHaveLength(0);
  });
});

describe('anular un consumo mal registrado', () => {
  it('el doble clic del cajero no devuelve el cupo dos veces', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(9);

    const primera = await svc.anularConsumo(CAJERO, c.consumoId);
    expect(primera).toMatchObject({ devuelto: 1, saldo: 10 });

    await expect(svc.anularConsumo(CAJERO, c.consumoId)).rejects.toThrow(
      'Este consumo ya estaba anulado.',
    );
    expect(saldo()).toBe(10); // no 11
  });

  it('dos anulaciones simultáneas del mismo consumo: solo una devuelve', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 1);
    const r = await Promise.allSettled([
      svc.anularConsumo(CAJERO, c.consumoId),
      svc.anularConsumo(CAJERO, c.consumoId),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(saldo()).toBe(10);
  });

  it('anular un consumo del mes pasado no regala cupo del mes nuevo', async () => {
    // Sin esta condición, anular en octubre un café de septiembre le sumaría
    // uno al cupo de octubre: cupo que nadie pagó.
    bd.consumos.push({
      id: 'c-viejo',
      membresiaId: 'm1',
      cantidad: 1,
      saldoResultante: 9,
      periodo: '2026-08',
      actorId: 'u-cajero',
      locationId: null,
      revertedAt: null,
      revertedBy: null,
      createdAt: new Date('2026-08-15'),
    });
    const r = await svc.anularConsumo(CAJERO, 'c-viejo');
    expect(r).toMatchObject({ ok: true, devuelto: 0 });
    expect(saldo()).toBe(10);
    // Y NO queda marcado. Antes sí, «porque el histórico no se reescribe» —
    // pero `revertedAt` significa «se deshizo y se le devolvió el cupo», y
    // ponerlo sin devolver nada hace que el campo mienta: el consumo salía
    // como anulado en cualquier informe, no se podía reintentar jamás («ya
    // estaba anulado») y al cajero se le decía DESPUÉS que no se podía
    // deshacer. Si no se devuelve nada, el consumo sigue en pie.
    expect(bd.consumos[0].revertedAt).toBeNull();
    // Y no se molesta a la billetera si no ha cambiado nada.
    await respirar();
    expect(empujados).toHaveLength(0);
  });

  it('anular dos consumos distintos seguidos devuelve los dos', async () => {
    const a = await svc.consumir(CAJERO, 'm1', 2);
    const b = await svc.consumir(CAJERO, 'm1', 3);
    expect(saldo()).toBe(5);

    await svc.anularConsumo(CAJERO, a.consumoId);
    await svc.anularConsumo(CAJERO, b.consumoId);
    expect(saldo()).toBe(10);
    expect(bd.consumos.every((c) => c.revertedAt !== null)).toBe(true);
  });

  it('anular devuelve el cupo y refresca el pase', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 1);
    await svc.anularConsumo(CAJERO, c.consumoId);
    await respirar();
    expect(empujados).toContainEqual({
      passId: 'pass1',
      motivo: 'club.anulacion',
    });
  });

  it('anular no deja el saldo por encima del cupo del mes', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 4);
    await svc.anularConsumo(CAJERO, c.consumoId);
    expect(saldo()).toBeLessThanOrEqual(membresia().cupoDelPeriodo);
  });

  it('el cajero de otro negocio no puede anular consumos ajenos', async () => {
    const c = await svc.consumir(CAJERO, 'm1', 1);
    await expect(svc.anularConsumo(OTRO_NEGOCIO, c.consumoId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(saldo()).toBe(9);
  });

  it('un consumo que no existe da 404', async () => {
    await expect(svc.anularConsumo(CAJERO, 'no-existe')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('se puede anular aunque la membresía esté pausada mientras tanto', async () => {
    // El cupo es del cliente: si el cajero se equivocó, se le devuelve aunque
    // el negocio le haya pausado la suscripción entre medias.
    const c = await svc.consumir(CAJERO, 'm1', 1);
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');
    const r = await svc.anularConsumo(CAJERO, c.consumoId);
    expect(r).toMatchObject({ devuelto: 1, saldo: 10 });
  });
});

describe('lo que ve el cajero al escanear', () => {
  it('con saldo y activa, puede consumir', async () => {
    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v).toMatchObject({
      membresiaId: 'm1',
      titular: 'Ana Ruiz',
      plan: 'Café Diario',
      unidad: 'café',
      saldo: 10,
      cupoDelPeriodo: 10,
      puedeConsumir: true,
    });
  });

  it('el saldo que ve el cajero es el del pase, no el de la membresía', async () => {
    // Tras el cambio de modelo, el único contador vivo es `Pass.stampsCount`.
    await svc.consumir(CAJERO, 'm1', 6);
    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v.saldo).toBe(4);
  });

  it('sin saldo, la caja ya avisa antes de intentarlo', async () => {
    montar(0);
    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v.puedeConsumir).toBe(false);
  });

  it('pausada, tampoco', async () => {
    membresia().status = 'PAUSADA';
    const v = await svc.resolverParaCaja(CAJERO, 'pass1');
    expect(v.puedeConsumir).toBe(false);
  });

  it('un pase de otro negocio no se resuelve', async () => {
    await expect(svc.resolverParaCaja(OTRO_NEGOCIO, 'pass1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('un pase sin socio dice eso, y dice qué hacer', async () => {
    // Antes decía «esta tarjeta no es de un club» — y sí lo es: aquí solo se
    // llega desviado por `card.clubPlanId`. Lo que falta es el socio, y al
    // cajero el mensaje viejo le sonaba a que el escáner estaba roto.
    //
    // Se llega solo: `ClubMembresia.pass` es `onDelete: SetNull`, así que
    // rehacerle el pase a alguien deja su membresía sin `passId`.
    await expect(
      svc.resolverParaCaja(CAJERO, 'pase-desconocido'),
    ).rejects.toThrow(/socio/i);
    await expect(
      svc.resolverParaCaja(CAJERO, 'pase-desconocido'),
    ).rejects.toThrow(/dar(lo)? de alta/i);
  });
});

describe('pausar y reactivar', () => {
  it('pausar no toca el saldo: vuelve con lo que tenía', async () => {
    await svc.consumir(CAJERO, 'm1', 4);
    await svc.cambiarEstado(DUENO, 'm1', 'PAUSADA');
    expect(saldo()).toBe(6);
    await svc.cambiarEstado(DUENO, 'm1', 'ACTIVA');
    expect(saldo()).toBe(6);
    expect(membresia().pausedAt).toBeNull();
  });

  it('una cancelada no se reactiva', async () => {
    await svc.cambiarEstado(DUENO, 'm1', 'CANCELADA');
    await expect(svc.cambiarEstado(DUENO, 'm1', 'ACTIVA')).rejects.toThrow(
      'Una membresía cancelada no se reactiva.',
    );
  });

  it('el dueño de otro negocio no puede pausar membresías ajenas', async () => {
    await expect(
      svc.cambiarEstado(OTRO_NEGOCIO, 'm1', 'PAUSADA'),
    ).rejects.toThrow(NotFoundException);
    expect(membresia().status).toBe('ACTIVA');
  });
});

/**
 * ─────────────────────────────────────────────────────────────────────────
 * FALLOS ENCONTRADOS — estos tests están EN ROJO a propósito.
 *
 * Describen lo que debería pasar, no lo que pasa hoy. No los borres para
 * poner el CI en verde: arregla el servicio, o bórralos con una decisión
 * escrita en la bitácora.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('FALLO — el descuento perdió el candado del estado', () => {
  it('si la pausan entre la lectura y el descuento, no debería llevarse nada', async () => {
    // El UPDATE condicional sólo mira `stampsCount: { gte: cantidad }`. El
    // estado de la membresía se comprueba ANTES, fuera de la transacción, así
    // que una pausa que entre en medio no frena el descuento: el cliente que
    // no pagó se lleva el café igual.
    //
    // Antes del cambio de modelo el `where` incluía `status: 'ACTIVA'` sobre la
    // propia membresía y esto no podía pasar. Al mover el saldo al pase se
    // perdió el candado, porque `Pass` no sabe nada del estado de la membresía.
    ganchos.antesDeDescontar = () => {
      membresia().status = 'PAUSADA';
    };
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(
      ConflictException,
    );
    expect(saldo()).toBe(10);
    expect(bd.consumos).toHaveLength(0);
  });
});

describe('el cron reinicia justo mientras se deshace un consumo', () => {
  it('no se devuelve cupo del mes nuevo, y no queda nada marcado', async () => {
    // La comprobación del período no basta con hacerla al entrar: esa lectura
    // no bloquea nada, así que el reinicio mensual puede estar a medias y sin
    // comitear. Por eso se vuelve a mirar DESPUÉS de tomar el candado del
    // pase, cuando ese reinicio ya terminó por fuerza — y si el mes cambió, se
    // lanza y la transacción entera se deshace.
    //
    // Sin eso el cliente acababa con 11 de 10: un beneficio del mes viejo
    // sumado encima del cupo recién repuesto.
    const c = await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(9);

    ganchos.antesDeMarcarAnulacion = () => {
      // Llega el cron: nuevo período y el pase repuesto al cupo entero.
      membresia().periodo = '2026-10';
      bd.pases[0].stampsCount = 10;
    };
    await expect(svc.anularConsumo(CAJERO, c.consumoId)).rejects.toThrow(
      ConflictException,
    );
    expect(saldo()).toBe(10);
    expect(bd.consumos[0].revertedAt).toBeNull();
  });
});

describe('FALLO — el cambio de mes deja una ventana de hasta una hora', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 1 de octubre, 00:30 en Bogotá. El cron es horario (`EVERY_HOUR`), así
    // que todavía no ha reiniciado nada.
    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));
  });
  afterEach(() => {
  vi.useRealTimers();
});

  it('el sobrante de septiembre no se puede gastar el 1 de octubre', async () => {
    // La membresía sigue marcada en '2026-09' con 7 cafés sin gastar porque el
    // cron es horario y aún no ha pasado. Si se pudiera gastar ese sobrante, el
    // cliente se llevaría 17 en un mes con un plan de 10 — justo lo que el
    // producto dice que NO pasa.
    //
    // Se resolvió reiniciando AHÍ MISMO en vez de rechazando el consumo:
    // decirle «no» a alguien que pagó, por un cron que aún no ha corrido, es un
    // problema nuestro cobrado al cliente. El sobrante se pierde igual —que es
    // la regla— pero el café sale del cupo de octubre.
    montar(7, '2026-09');
    const r = await svc.consumir(CAJERO, 'm1', 1);
    expect(r.cupoDelPeriodo).toBe(10); // ya es el cupo de octubre
    expect(saldo()).toBe(9); // 10 de octubre menos este, no 6 de septiembre
    expect(membresia().periodo).toBe('2026-10');
  });

  it('un consumo del 1 de octubre se apunta a octubre, no a septiembre', async () => {
    // `consumo.periodo` sale de la membresía, no de la fecha real. Con la
    // membresía sin reiniciar, un café de octubre queda contado en septiembre
    // y los informes por mes salen mal.
    montar(7, '2026-09');
    await svc.consumir(CAJERO, 'm1', 1).catch(() => null);
    expect(bd.consumos[0]?.periodo).toBe('2026-10');
  });
});
