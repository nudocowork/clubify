import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { AutomationsService } from '../automations/automations.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ClubService } from './club.service';
import { clubDelPase, pluralUnidad } from './club-pase.util';
import {
  bdVacia,
  crearPrismaFalso,
  crearBilletera,
  crearAutomatizaciones,
  type BaseDeDatos,
} from './club-prisma-falso';

/**
 * El interruptor del módulo y los textos que acaban en la billetera.
 *
 * Contra el servicio real. Las dos cosas son nuevas y las dos se ven: el
 * interruptor decide si un negocio puede empezar, y el plural es literalmente
 * lo que el cliente lee en su móvil.
 */

const DUENO: AuthUser = {
  id: 'u-dueno',
  email: 'dueno@negocio.com',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};

let bd: BaseDeDatos;
let svc: ClubService;
let prisma: PrismaService;
let emitidos: Array<{ evento: string; datos: any }>;

function montar() {
  bd = bdVacia();
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Ana Ruiz' });
  const falso = crearPrismaFalso(bd);
  prisma = falso.prisma as unknown as PrismaService;
  const billetera = crearBilletera();
  const autos = crearAutomatizaciones();
  emitidos = autos.emitidos;
  svc = new ClubService(
    prisma,
    billetera.wallet as unknown as WalletService,
    billetera.jobs as unknown as QueueService,
    autos.automations as unknown as AutomationsService,
  );
}

function plan(unidad = 'café', beneficiosPorMes = 10) {
  bd.planes.push({
    id: 'p1',
    tenantId: 't1',
    name: 'Café Diario',
    slug: 'cafe-diario',
    description: '',
    beneficiosPorMes,
    unidad,
    precioCents: 60000,
    currency: 'COP',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-05T17:00:00Z'));
  montar();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('el interruptor del módulo', () => {
  it('apagado, no se puede crear un plan', async () => {
    bd.clubEnabled = false;
    await expect(
      svc.crearPlan(DUENO, { name: 'Café Diario', beneficiosPorMes: 10 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('apagado, no se puede dar de alta a nadie', async () => {
    plan();
    bd.clubEnabled = false;
    await expect(svc.darDeAlta(DUENO, 'p1', 'cli1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('apagado, quien YA es socio sigue consumiendo lo que pagó', async () => {
    // Ésta es la decisión que separa al club de convenios: allá el beneficio es
    // gratis y apagar el módulo bloquea el canje. Aquí el cliente puso dinero,
    // así que apagar el módulo impide empezar cosas nuevas pero no se queda con
    // lo suyo. Si esto se rompe, un negocio que pause el módulo a mitad de mes
    // deja tirados a todos sus socios.
    plan();
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    bd.clubEnabled = false;

    const r = await svc.consumir(DUENO, m.id, 1);
    expect(r.saldo).toBe(9);
  });

  it('el panel puede preguntar si está encendido', async () => {
    expect(await svc.estadoDelModulo(DUENO)).toEqual({ habilitado: true });
    bd.clubEnabled = false;
    expect(await svc.estadoDelModulo(DUENO)).toEqual({ habilitado: false });
  });
});

describe('la bienvenida al socio', () => {
  it('el alta dispara PASS_CREATED, como cualquier otra tarjeta', async () => {
    // Era el hueco más grande de todos: el club no llamaba a las
    // automatizaciones en ningún sitio, así que el socio que acaba de PAGAR
    // era el único cliente del negocio que no recibía nada al recibir su
    // tarjeta. La regla de bienvenida que el negocio configura pensando
    // «cuando alguien recibe mi tarjeta» no se disparaba jamás para él.
    plan();
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    const bienvenida = emitidos.filter((e) => e.evento === 'PASS_CREATED');
    expect(bienvenida).toHaveLength(1);
    expect(bienvenida[0].datos).toMatchObject({
      tenantId: 't1',
      customerId: 'cli1',
      passId: m.passId,
    });
  });

  it('a quien ya estaba dentro NO se le da la bienvenida otra vez', async () => {
    // Si no, le llegaría cada vez que lo readmiten.
    plan();
    await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.darDeAlta(DUENO, 'p1', 'cli1');

    expect(emitidos.filter((e) => e.evento === 'PASS_CREATED')).toHaveLength(1);
  });
});

describe('consumir cuenta como visita', () => {
  it('marca el día en el cliente, para la automatización de inactividad', async () => {
    // `lastVisitDay` solo lo escribía el escaneo de sellos. Un socio del club
    // quedaba en uno de dos estados, los dos malos: sin cartón previo no
    // recibía el «te extrañamos» jamás; con un cartón viejo lo recibía
    // estando yendo a diario.
    plan();
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(bd.clientes[0].lastVisitDay).toBeUndefined();

    await svc.consumir(DUENO, m.id, 1);

    // Texto «YYYY-MM-DD», el mismo formato con el que compara la
    // automatización — una fecha ahí no encajaría nunca.
    expect(bd.clientes[0].lastVisitDay).toBe('2026-09-05');
  });
});

describe('la tarjeta del plan no nace con los colores de la plataforma', () => {
  it('copia los del negocio, explícitos', async () => {
    // `Card.primaryColor` trae por defecto el verde de Clubify. Esta fila se
    // crea UNA vez y se queda, así que el primer socio de una marca blanca
    // fijaría el color de la plataforma para todos los demás.
    plan();
    await svc.darDeAlta(DUENO, 'p1', 'cli1');

    const card = bd.tarjetas.find((c) => c.clubPlanId === 'p1');
    expect(card).toBeDefined();
    expect((card as any).primaryColor).toBe('#111111');
    expect((card as any).secondaryColor).toBe('#222222');
    expect((card as any).businessName).toBe('Negocio de prueba');
  });
});

describe('editar el plan lleva los cambios a la tarjeta', () => {
  it('el cupo nuevo es el denominador del pase', async () => {
    // Sin esto, subir el cupo de 10 a 15 dejaba `stampsRequired` en 10 y la
    // billetera enseñaba «15 / 10» en cuanto llegaba el reinicio del mes.
    plan();
    await svc.darDeAlta(DUENO, 'p1', 'cli1');

    await svc.actualizarPlan(DUENO, 'p1', {
      beneficiosPorMes: 15,
      name: 'Café Diario Plus',
    });

    const card = bd.tarjetas.find((c) => c.clubPlanId === 'p1') as any;
    expect(card.stampsRequired).toBe(15);
    expect(card.name).toBe('Café Diario Plus');
    expect(card.rewardText).toBe('15 café al mes');
  });
});

describe('lo que el pase le enseña al cliente', () => {
  it('trae la unidad, el cupo del período y si está detenida', async () => {
    plan();
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');

    const enPase = await clubDelPase(prisma, 'p1', m.passId!);
    expect(enPase).toEqual({
      unidad: 'café',
      cupo: 10,
      detenida: false,
      dadaDeBaja: false,
    });

    await svc.cambiarEstado(DUENO, m.id, 'PAUSADA');
    const pausada = await clubDelPase(prisma, 'p1', m.passId!);
    expect(pausada?.detenida).toBe(true);
    // En pausa NO es de baja: el pase de un pausado dice «EN PAUSA» y el de
    // uno dado de baja «FINALIZADA». Colapsarlos dejaba al que se fue con una
    // tarjeta que le sugería que iba a volver.
    expect(pausada?.dadaDeBaja).toBe(false);

    await svc.cambiarEstado(DUENO, m.id, 'CANCELADA');
    expect((await clubDelPase(prisma, 'p1', m.passId!))?.dadaDeBaja).toBe(true);
  });

  it('el cupo sale del PERÍODO, no del plan', async () => {
    // Si el negocio sube el plan a mitad de mes, este socio sigue teniendo el
    // cupo con el que entró hasta el día 1. Pintar el del plan le prometería
    // beneficios que la caja no le va a dar.
    plan();
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    await svc.actualizarPlan(DUENO, 'p1', { beneficiosPorMes: 30 });

    expect((await clubDelPase(prisma, 'p1', m.passId!))?.cupo).toBe(10);
  });

  it('un pase que no es de este plan no devuelve nada', async () => {
    plan();
    const m = await svc.darDeAlta(DUENO, 'p1', 'cli1');
    expect(await clubDelPase(prisma, 'otro-plan', m.passId!)).toBeNull();
  });
});

describe('el plural de la unidad', () => {
  // Es lo que se lee en la caja y en la billetera. La tilde se comía: «café»
  // salía «cafes», y el propio comentario de la función decía «cafés».
  it.each([
    ['café', 'cafés'],
    ['menú', 'menús'],
    ['clase', 'clases'],
    ['lavada', 'lavadas'],
    ['flan', 'flanes'],
    ['lápiz', 'lápices'],
    ['masaje', 'masajes'],
  ])('%s → %s', (singular, esperado) => {
    expect(pluralUnidad(singular, 3)).toBe(esperado);
  });

  it('en uno se queda en singular', () => {
    expect(pluralUnidad('café', 1)).toBe('café');
  });

  it('en cero va en plural: «0 cafés»', () => {
    expect(pluralUnidad('café', 0)).toBe('cafés');
  });

  it('sin unidad no inventa nada', () => {
    expect(pluralUnidad('   ', 3)).toBe('');
  });
});
