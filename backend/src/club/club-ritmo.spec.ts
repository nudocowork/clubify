import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import {
  bdVacia,
  crearPrismaFalso,
  crearBilletera,
  crearAutomatizaciones,
  type BaseDeDatos,
} from './club-prisma-falso';

/**
 * El ritmo al que se gasta el cupo, contra el SERVICIO REAL.
 *
 * El caso que lo motivó, con rastro en producción (DEMO CLUBIFY, 2026-09-08):
 * tres cafés en dos minutos y medio, saldo 9 → 8 → 7 → 6. Nada lo paró porque
 * nada miraba el reloj: el cupo es mensual y solo frena al llegar a cero.
 *
 * Aquí no se prueba la función pura —eso está en `club-frecuencia.spec.ts`—
 * sino que el servicio la use, que la use DENTRO de la transacción y que un
 * rechazo no deje nada a medias.
 */

const CAJERO: AuthUser = {
  id: 'u-cajero',
  email: 'caja@cafeteria.com',
  role: 'TENANT_STAFF' as AuthUser['role'],
  tenantId: 't1',
};

let bd: BaseDeDatos;
let svc: ClubService;

function abrirElNegocio(
  limites: { maxPorDia?: number | null; minutosEntreConsumos?: number | null } = {},
) {
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
    periodicidad: 'MENSUAL',
    isActive: true,
    maxPorDia: limites.maxPorDia ?? null,
    minutosEntreConsumos: limites.minutosEntreConsumos ?? null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  bd.clientes.push({
    id: 'cli1',
    tenantId: 't1',
    fullName: 'Ana Ruiz',
    phone: '3001112233',
  });
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
    serialNumber: 'CLB-ANA',
    qrToken: 'qr-ana',
    authToken: 'auth-ana',
    stampsCount: 10,
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
    periodo: '2026-09',
    cupoDelPeriodo: 10,
    createdAt: new Date('2026-09-01'),
    pausedAt: null,
    updatedAt: new Date('2026-09-01'),
  });

  const falso = crearPrismaFalso(bd);
  const billetera = crearBilletera();
  const autos = crearAutomatizaciones();
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    autos.automations as unknown as AutomationsService,
  );
}

const saldo = () => bd.pases[0].stampsCount;
const servidos = () =>
  bd.consumos.filter((c) => !c.revertedAt).reduce((t, c) => t + c.cantidad, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Sábado 5 de septiembre, mediodía en Bogotá (17:00 UTC).
  vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sin límites, el plan sigue funcionando exactamente igual', () => {
  it('los tres seguidos de DEMO CLUBIFY pasan, como hasta ahora', async () => {
    abrirElNegocio();
    await svc.consumir(CAJERO, 'm1', 1);
    await svc.consumir(CAJERO, 'm1', 1);
    await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(7);
    expect(servidos()).toBe(3);
  });
});

describe('máximo al día', () => {
  it('el tercero del día se rechaza y NO descuenta', async () => {
    abrirElNegocio({ maxPorDia: 2 });
    await svc.consumir(CAJERO, 'm1', 1);
    await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(8);

    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(ConflictException);
    // Lo importante: el rechazo deshace la transacción entera. Ni saldo, ni
    // línea de consumo, ni membresía tocada.
    expect(saldo()).toBe(8);
    expect(servidos()).toBe(2);
  });

  it('el mensaje dice qué pasa, en la unidad del negocio', async () => {
    abrirElNegocio({ maxPorDia: 1 });
    await svc.consumir(CAJERO, 'm1', 1);
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(/1 café hoy/);
  });

  it('al día siguiente vuelve a poder', async () => {
    abrirElNegocio({ maxPorDia: 1 });
    await svc.consumir(CAJERO, 'm1', 1);
    vi.setSystemTime(new Date('2026-09-06T17:00:00Z'));
    await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(8);
  });

  it('el día es el de Bogotá: a las 23:50 y a las 00:10 son días distintos', async () => {
    abrirElNegocio({ maxPorDia: 1 });
    // 23:50 del 5 en Bogotá = 04:50 UTC del 6.
    vi.setSystemTime(new Date('2026-09-06T04:50:00Z'));
    await svc.consumir(CAJERO, 'm1', 1);
    // 00:10 del 6 en Bogotá = 05:10 UTC del 6. Día nuevo allá, misma fecha UTC.
    vi.setSystemTime(new Date('2026-09-06T05:10:00Z'));
    await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(8);
  });

  it('y a las 19:00 y a las 21:00 son el MISMO día, aunque UTC diga otra cosa', async () => {
    // 19:00 en Bogotá = 00:00 UTC del día siguiente. Contando en UTC, el
    // segundo café de la noche caería en otro día y el tope no mordería.
    abrirElNegocio({ maxPorDia: 1 });
    vi.setSystemTime(new Date('2026-09-06T00:00:00Z')); // 5-sep 19:00 Bogotá
    await svc.consumir(CAJERO, 'm1', 1);
    vi.setSystemTime(new Date('2026-09-06T02:00:00Z')); // 5-sep 21:00 Bogotá
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(ConflictException);
    expect(saldo()).toBe(9);
  });

  it('anular un consumo devuelve el cupo del día', async () => {
    // Si el cajero se equivoca de socio y lo deshace, el día no puede quedar
    // quemado: el cliente no se llevó nada.
    abrirElNegocio({ maxPorDia: 1 });
    const r = await svc.consumir(CAJERO, 'm1', 1);
    await svc.anularConsumo(CAJERO, r.consumoId);
    await svc.consumir(CAJERO, 'm1', 1);
    expect(servidos()).toBe(1);
  });

  it('pedir 2 de golpe con tope 2 pasa; con tope 1 se rechaza entero', async () => {
    abrirElNegocio({ maxPorDia: 2 });
    await svc.consumir(CAJERO, 'm1', 2);
    expect(saldo()).toBe(8);

    abrirElNegocio({ maxPorDia: 1 });
    await expect(svc.consumir(CAJERO, 'm1', 2)).rejects.toThrow(ConflictException);
    expect(saldo()).toBe(10);
  });
});

describe('espera entre usos', () => {
  it('el segundo dentro de la ventana se rechaza', async () => {
    abrirElNegocio({ minutosEntreConsumos: 30 });
    await svc.consumir(CAJERO, 'm1', 1);
    vi.setSystemTime(new Date('2026-09-05T17:01:00Z'));
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(/29 minutos/);
    expect(saldo()).toBe(9);
  });

  it('pasada la ventana, adelante', async () => {
    abrirElNegocio({ minutosEntreConsumos: 30 });
    await svc.consumir(CAJERO, 'm1', 1);
    vi.setSystemTime(new Date('2026-09-05T17:30:00Z'));
    await svc.consumir(CAJERO, 'm1', 1);
    expect(saldo()).toBe(8);
  });

  it('mata el doble toque del cajero, que antes cobraba dos veces', async () => {
    // El módulo decidió a propósito NO tener ventana de idempotencia, porque
    // dos cafés pedidos seguidos son indistinguibles del doble toque. Con una
    // espera configurada, el negocio elige cuál de los dos casos prefiere.
    abrirElNegocio({ minutosEntreConsumos: 5 });
    await svc.consumir(CAJERO, 'm1', 1);
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(ConflictException);
    expect(servidos()).toBe(1);
  });

  it('un consumo ANULADO no cuenta para la espera', async () => {
    abrirElNegocio({ minutosEntreConsumos: 60 });
    const r = await svc.consumir(CAJERO, 'm1', 1);
    await svc.anularConsumo(CAJERO, r.consumoId);
    await svc.consumir(CAJERO, 'm1', 1);
    expect(servidos()).toBe(1);
    expect(saldo()).toBe(9);
  });
});

describe('los dos a la vez', () => {
  it('con el día agotado manda el día, no la espera', async () => {
    abrirElNegocio({ maxPorDia: 1, minutosEntreConsumos: 30 });
    await svc.consumir(CAJERO, 'm1', 1);
    vi.setSystemTime(new Date('2026-09-05T18:00:00Z')); // la espera ya pasó
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(/mañana/);
  });
});

describe('el límite no le quita lo suyo a nadie', () => {
  it('una membresía pausada sigue dando el mismo error de siempre', async () => {
    // El orden importa: primero el estado, luego el ritmo. Un socio pausado
    // tiene que enterarse de que está pausado, no de que espere media hora.
    abrirElNegocio({ minutosEntreConsumos: 30 });
    bd.membresias[0].status = 'PAUSADA';
    await expect(svc.consumir(CAJERO, 'm1', 1)).rejects.toThrow(/pausada/i);
  });
});
