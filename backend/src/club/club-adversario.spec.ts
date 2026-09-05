import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  type BaseDeDatos,
} from './club-prisma-falso';

/**
 * Lo que encontró la revisión adversarial: caminos por los que el negocio
 * regalaba cupo o el cliente perdía el que había pagado.
 *
 * Cada uno de estos se pasó los 146 tests que ya había. Van aparte para que se
 * lea de un vistazo qué protege cada cosa.
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

let bd: BaseDeDatos;
let svc: ClubService;

function montar(tramos: Array<{ desdeDia: number; hastaDia: number; beneficios: number }> = []) {
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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
  tramos.forEach((t, i) => bd.tramos.push({ id: `tr${i}`, planId: 'p1', ...t }));
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' });
  bd.clientes.push({ id: 'cli2', tenantId: 't1', fullName: 'Beto Páez' });
  const falso = crearPrismaFalso(bd);
  const billetera = crearBilletera();
  svc = new ClubService(
    falso.prisma as unknown as PrismaService,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    crearAutomatizaciones().automations as unknown as AutomationsService,
  );
}

const saldoDe = (passId: string) =>
  bd.pases.find((p) => p.id === passId)!.stampsCount;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-05T17:00:00Z')); // 5 de sept, Bogotá
  montar();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('cancelar y volver a dar de alta no es una recarga', () => {
  it('vuelve el mismo mes: conserva lo que le quedaba', async () => {
    // El agujero: gastarse los 10, cancelar, readmitir → otros 10. Repetible
    // dentro del mismo mes, con una sola cuota pagada.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 10);
    expect(saldoDe(m.passId!)).toBe(0);

    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');
    const vuelta = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(saldoDe(m.passId!)).toBe(0);
    expect(vuelta.saldo).toBe(0);
  });

  it('vuelve el mismo mes con saldo a medias: no se le recorta', async () => {
    // El otro lado del mismo agujero: al cancelado por error el día 20 se le
    // aplicaba el tramo de alta y perdía lo que ya había pagado.
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 3 },
    ]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 2);
    expect(saldoDe(m.passId!)).toBe(8);

    vi.setSystemTime(new Date('2026-09-20T17:00:00Z')); // día 20: tramo de 3
    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');
    const vuelta = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(saldoDe(m.passId!)).toBe(8);
    expect(vuelta.saldo).toBe(8);
  });

  it('vuelve el mes siguiente: entra como nuevo, con el tramo de hoy', async () => {
    montar([
      { desdeDia: 1, hastaDia: 15, beneficios: 10 },
      { desdeDia: 16, hastaDia: 31, beneficios: 3 },
    ]);
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 10);
    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');

    vi.setSystemTime(new Date('2026-10-20T17:00:00Z')); // otro mes, día 20
    const vuelta = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(vuelta.saldo).toBe(3);
    expect(saldoDe(m.passId!)).toBe(3);
  });
});

describe('el día 1, antes de que pase el cron', () => {
  it('la caja ya le deja consumir al que terminó el mes en cero', async () => {
    // El cron es HORARIO: entre las 00:00 del día 1 y su primera pasada hay
    // hasta una hora. `consumir` sabía reiniciar; la pantalla que decide si se
    // pinta el botón, no — y al socio se le decía «sin cupo» a la cara.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 10);
    expect(saldoDe(m.passId!)).toBe(0);

    vi.setSystemTime(new Date('2026-10-01T05:30:00Z')); // 1 de oct, 00:30 Bogotá

    const v = await svc.resolverParaCaja(CAJERO, m.passId!);
    expect(v.puedeConsumir).toBe(true);
    expect(v.saldo).toBe(10);
    expect(v.periodo).toBe('2026-10');
  });

  it('leerlo no escribe nada: el reinicio lo hace el consumo', async () => {
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 10);
    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));

    await svc.resolverParaCaja(CAJERO, m.passId!);
    // El pase sigue a cero hasta que alguien consuma o pase el cron: la
    // pantalla del cajero es de LECTURA.
    expect(saldoDe(m.passId!)).toBe(0);

    const r = await svc.consumir(CAJERO, m.id, 1);
    expect(r.saldo).toBe(9);
  });

  it('una pausada sigue sin poder consumir aunque cambie el mes', async () => {
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.cambiarEstado(DUENO, m.id, 'PAUSADA');
    vi.setSystemTime(new Date('2026-10-01T05:30:00Z'));

    const v = await svc.resolverParaCaja(CAJERO, m.passId!);
    expect(v.puedeConsumir).toBe(false);
    expect(v.status).toBe('PAUSADA');
  });
});

describe('cerrar el club', () => {
  it('da de baja a todos y deja el histórico intacto', async () => {
    const a = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const b = await svc.darDeAlta(DUENO, 'p1', 'cli2');
    await svc.consumir(CAJERO, a.id, 2);
    await svc.cambiarEstado(DUENO, b.id, 'PAUSADA');

    const r = await svc.darDeBajaATodos(DUENO, 'p1');

    expect(r.dadasDeBaja).toBe(2);
    expect(bd.membresias.every((m) => m.status === 'CANCELADA')).toBe(true);
    // El consumo no se toca: es el histórico.
    expect(bd.consumos).toHaveLength(1);
  });

  it('sobre un plan sin socios no hace nada y lo dice', async () => {
    expect(await svc.darDeBajaATodos(DUENO, 'p1')).toEqual({ dadasDeBaja: 0 });
  });

  it('el de otro negocio no puede cerrarle el club a este', async () => {
    await svc.darDeAlta(DUENO, 'p1', 'cli1');
    const ajeno = { ...DUENO, tenantId: 't2' };
    await expect(svc.darDeBajaATodos(ajeno, 'p1')).rejects.toThrow();
    expect(bd.membresias[0].status).toBe('ACTIVA');
  });
});

describe('alta con un solo dato', () => {
  it('un teléfono que no existe crea al cliente y lo mete', async () => {
    // El caso corriente: alguien acaba de pagar en el mostrador y no está en
    // el sistema. Antes había que ir a Clientes, crearlo y volver a buscarlo.
    const r: any = await svc.altaRapida(DUENO, 'p1', '3001234567');

    expect(r.ambiguos).toBeUndefined();
    expect(r.saldo).toBe(10);
    expect(r.passId).toBeTruthy();
    const creado = bd.clientes.find((c) => c.id === r.cliente.id)!;
    // `fullName` es obligatorio en la base: sin nombre se usa el número, que
    // al menos identifica a quien es. Inventar «Cliente nuevo» dejaría veinte
    // filas idénticas.
    expect(creado.fullName).toBe('3001234567');
  });

  it('reutiliza al cliente que ya tienes, no lo duplica', async () => {
    bd.clientes.push({
      id: 'cli9',
      tenantId: 't1',
      fullName: 'Carla Díaz',
      // Así se guardan los que entran por el registro de una tarjeta: con
      // indicativo y sin separadores.
      phone: '+573001112233',
    } as any);
    const cuantos = bd.clientes.length;

    // Se escribe como lo diría cualquiera, sin indicativo.
    const r: any = await svc.altaRapida(DUENO, 'p1', '300 111 2233');

    expect(r.cliente.id).toBe('cli9');
    expect(bd.clientes).toHaveLength(cuantos);
  });

  it('con letras busca por nombre', async () => {
    const r: any = await svc.altaRapida(DUENO, 'p1', 'Ana Ruiz');
    expect(r.cliente.id).toBe('cli1');
  });

  it('si encajan varios, pregunta en vez de elegir', async () => {
    // Dar de alta al que no era es peor que un clic de más: el socio
    // equivocado se lleva el cupo que pagó otro.
    bd.clientes.push({
      id: 'cli9',
      tenantId: 't1',
      fullName: 'Ana Ruiz Gómez',
    } as any);

    const r: any = await svc.altaRapida(DUENO, 'p1', 'Ana Ruiz');

    expect(r.ambiguos).toHaveLength(2);
    expect(r.passId).toBeUndefined();
    expect(bd.membresias).toHaveLength(0);
  });

  it('un dato de una letra no crea nada', async () => {
    await expect(svc.altaRapida(DUENO, 'p1', 'a')).rejects.toThrow();
    expect(bd.membresias).toHaveLength(0);
  });
});

describe('el historial de consumos', () => {
  it('suma las unidades entregadas, no las líneas', async () => {
    // Un consumo puede llevarse más de uno: contar líneas diría 2 donde el
    // negocio entregó 5, y el número existe justo para cuadrar lo que entrega.
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 3);
    await svc.consumir(CAJERO, m.id, 2);

    const r = await svc.consumosDelPlan(DUENO, 'p1');

    expect(r.total).toBe(2);
    expect(r.entregadas).toBe(5);
    expect(r.unidad).toBe('café');
    expect(r.consumos[0].cliente.nombre).toBe('Ana Ruiz');
  });

  it('solo trae los del período que se pide', async () => {
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.consumir(CAJERO, m.id, 1);

    expect((await svc.consumosDelPlan(DUENO, 'p1')).entregadas).toBe(1);
    expect(
      (await svc.consumosDelPlan(DUENO, 'p1', { periodo: '2026-08' })).entregadas,
    ).toBe(0);
  });

  it('el de otro negocio no lo ve', async () => {
    const ajeno = { ...DUENO, tenantId: 't2' };
    await expect(svc.consumosDelPlan(ajeno, 'p1')).rejects.toThrow();
  });
});
