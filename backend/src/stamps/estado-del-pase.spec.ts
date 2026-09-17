import { describe, it, expect } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { GamificationService } from '../badges/gamification.service';
import type { AutomationsService } from '../automations/automations.service';
import type { PassesService } from '../passes/passes.service';
import type { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { StampsService } from './stamps.service';
import {
  bdVacia,
  crearDobles,
  crearPrismaFalso,
  pase,
  tarjeta,
  type BaseDeDatos,
} from './stamps-prisma-falso';

/**
 * El estado ACTIVE/COMPLETED de una tarjeta de sellos, contra el SERVICIO REAL.
 *
 * El defecto (arqueo 2026-09-17): canjear el premio bajaba el contador pero el
 * pase se quedaba COMPLETED para siempre, porque el estado se escribía como
 * `completed ? 'COMPLETED' : pass.status` — y `pass.status` YA era COMPLETED.
 * Todo lo que filtra `status: 'ACTIVE'` (envíos masivos, recurrentes,
 * cumpleaños, refresco de diseño y de marca, búsqueda por teléfono) dejaba
 * fuera justo a los mejores clientes: los que completaron y volvieron. En
 * producción: 56 pases de 11 negocios, 54 instalados, la mayoría sellando.
 */

const DUENO: AuthUser = {
  id: 'u1',
  email: 'dueno@negocio.test',
  role: 'TENANT_OWNER' as AuthUser['role'],
  tenantId: 't1',
};

function montar(bd: BaseDeDatos) {
  const falso = crearPrismaFalso(bd);
  const d = crearDobles();
  const svc = new StampsService(
    falso.prisma as unknown as PrismaService,
    d.wallet as unknown as WalletService,
    d.jobs as unknown as QueueService,
    d.gamification as unknown as GamificationService,
    d.automations as unknown as AutomationsService,
    d.passes as unknown as PassesService,
    d.brand as unknown as WhitelabelBrandService,
  );
  return { svc, d, registro: falso.registro };
}

function negocio(maxStampsPerDay: number | null = 5): BaseDeDatos {
  const bd = bdVacia();
  bd.tenants.push({ id: 't1', maxStampsPerDay });
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Cliente' });
  return bd;
}

const compra = { purchaseAmount: 20000 };

describe('canjear el premio devuelve la tarjeta a ACTIVE', () => {
  it('sellos: 10/10 COMPLETED → canje → 0/10 ACTIVE', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 10, status: 'COMPLETED' }));
    const { svc } = montar(bd);

    const r = await svc.record(DUENO, { passId: 'p1', action: 'REDEEM' });

    expect(bd.pases[0].stampsCount).toBe(0);
    expect(bd.pases[0].status).toBe('ACTIVE');
    // El escáner pinta con lo que devuelve la respuesta: tiene que decir lo mismo.
    expect((r.pass as { status: string }).status).toBe('ACTIVE');
  });

  it('visitas: 5/5 COMPLETED → canje → 0/5 ACTIVE', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'visitas', type: 'VISITS', visitsRequired: 5 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'visitas', visitsCount: 5, status: 'COMPLETED' }));
    const { svc } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'REDEEM' });

    expect(bd.pases[0].visitsCount).toBe(0);
    expect(bd.pases[0].status).toBe('ACTIVE');
  });

  it('con sellos de sobra sigue COMPLETED: 20/10 → canje → 10/10', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 20, status: 'COMPLETED' }));
    const { svc, d } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'REDEEM' });

    expect(bd.pases[0].stampsCount).toBe(10);
    expect(bd.pases[0].status).toBe('COMPLETED');
    expect(d.eventos.filter((e) => e.tipo === 'PASS_COMPLETED')).toHaveLength(0);
  });

  it('restar un sello por error también reabre: 10/10 → REFUND → 9/10 ACTIVE', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 10, status: 'COMPLETED' }));
    const { svc } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'REFUND', amount: 1 });

    expect(bd.pases[0].stampsCount).toBe(9);
    expect(bd.pases[0].status).toBe('ACTIVE');
  });

  it('los 56 ya atascados se curan con el siguiente sello: 3/10 COMPLETED → sello → 4/10 ACTIVE', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 3, status: 'COMPLETED' }));
    const { svc } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra });

    expect(bd.pases[0].stampsCount).toBe(4);
    expect(bd.pases[0].status).toBe('ACTIVE');
  });
});

describe('completar sigue funcionando igual', () => {
  it('9/10 → sello → 10/10 COMPLETED, y PASS_COMPLETED sale una vez', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 9 }));
    const { svc, d } = montar(bd);

    const r = await svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra });

    expect(bd.pases[0].status).toBe('COMPLETED');
    expect((r.pass as { status: string }).status).toBe('COMPLETED');
    expect(d.eventos.filter((e) => e.tipo === 'PASS_COMPLETED')).toHaveLength(1);
  });

  it('un sello más sobre un cartón ya COMPLETED no vuelve a avisar', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 10, status: 'COMPLETED' }));
    const { svc, d } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra });

    expect(bd.pases[0].status).toBe('COMPLETED');
    expect(d.eventos.filter((e) => e.tipo === 'PASS_COMPLETED')).toHaveLength(0);
  });

  it('una tarjeta SIN tope configurado no cambia de estado (no hay tope contra el que decidir)', async () => {
    const bd = negocio();
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: null }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 3, status: 'COMPLETED' }));
    const { svc } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra });

    expect(bd.pases[0].status).toBe('COMPLETED');
  });
});

describe('lo que NO se reabre', () => {
  it('cupón sin conversión: COMPLETED significa USADO y se queda así', async () => {
    const bd = negocio();
    bd.tarjetas.push(
      tarjeta({ id: 'cupon', type: 'COUPON', transformOnRedeem: false, stampsRequired: 10 }),
    );
    bd.pases.push(pase({ id: 'p1', cardId: 'cupon' }));
    const { svc } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'REDEEM' });
    expect(bd.pases[0].status).toBe('COMPLETED');

    // Y no se puede volver a canjear: el guard mira justo ese COMPLETED.
    await expect(svc.record(DUENO, { passId: 'p1', action: 'REDEEM' })).rejects.toThrow(
      /ya fue redimido/,
    );
  });

  it('tarjeta de CLUB: /stamps la rechaza y su estado no se toca', async () => {
    const bd = negocio();
    bd.tarjetas.push(
      tarjeta({ id: 'club', type: 'STAMPS', stampsRequired: 10, clubPlanId: 'plan1' }),
    );
    // Un socio con el cupo gastado a medias: el club va AL REVÉS (baja), así
    // que «por debajo del tope» es su estado normal y no dice nada del estado.
    bd.pases.push(pase({ id: 'p1', cardId: 'club', stampsCount: 3, status: 'COMPLETED' }));
    const { svc, registro } = montar(bd);

    for (const action of ['STAMP', 'REDEEM', 'REFUND'] as const) {
      await expect(
        svc.record(DUENO, { passId: 'p1', action, ...compra }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(bd.pases[0]).toMatchObject({ stampsCount: 3, status: 'COMPLETED' });
    expect(registro.filter((r) => r.startsWith('pass.'))).toEqual([]);
  });
});

describe('tope de sellos del día: se cuenta DESPUÉS del candado', () => {
  it('dos escaneos a la vez con tope 1: entra uno, el otro se rechaza', async () => {
    const bd = negocio(1);
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 2 }));
    const { svc } = montar(bd);

    const resultados = await Promise.allSettled([
      svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra }),
      svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra }),
    ]);

    const rechazados = resultados.filter((r) => r.status === 'rejected');
    expect(rechazados).toHaveLength(1);
    expect((rechazados[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    expect(bd.sellos.filter((s) => s.action === 'STAMP')).toHaveLength(1);
    expect(bd.pases[0].stampsCount).toBe(3);
  });

  it('la cuenta se hace dentro de la transacción', async () => {
    const bd = negocio(1);
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos' }));
    const { svc, registro } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra });

    const cuentas = registro.filter((r) => r.startsWith('stamp.count'));
    expect(cuentas.length).toBeGreaterThan(0);
    expect(cuentas.every((c) => c === 'stamp.count:dentro')).toBe(true);
  });

  it('el mensaje de siempre, y el rechazo no deja nada escrito', async () => {
    const bd = negocio(1);
    bd.tarjetas.push(tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }));
    bd.pases.push(pase({ id: 'p1', cardId: 'sellos', stampsCount: 2 }));
    const { svc } = montar(bd);

    await svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra });
    await expect(
      svc.record(DUENO, { passId: 'p1', action: 'STAMP', ...compra }),
    ).rejects.toThrow(/ya recibió un sello hoy/);

    expect(bd.sellos).toHaveLength(1);
    expect(bd.pases[0].stampsCount).toBe(3);
  });
});
