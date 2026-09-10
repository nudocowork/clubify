import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  cobrarCreditoDeActivacion,
  type NegocioParaCobro,
} from './creditos-de-marca';

/**
 * Prisma de mentira, con la memoria justa para ver qué se descontó y qué se
 * anotó. `updateMany` respeta la guarda `creditsAvailable >= coste` porque ESE
 * es el mecanismo que evita descontar de más cuando dos activaciones llegan a
 * la vez — un doble sin él no probaría nada.
 */
function prismaFalso(marca: {
  id: string;
  slug: string;
  creditsUnlimited: boolean;
  creditsAvailable: number;
}) {
  const estado = { ...marca, creditsUsed: 0 };
  const movimientos: any[] = [];
  const p: any = {
    whiteLabel: {
      findUnique: async () => ({
        id: estado.id,
        slug: estado.slug,
        creditsUnlimited: estado.creditsUnlimited,
      }),
      updateMany: async ({ where, data }: any) => {
        const minimo = where.creditsAvailable?.gte ?? 0;
        if (estado.creditsAvailable < minimo) return { count: 0 };
        estado.creditsAvailable -= data.creditsAvailable.decrement;
        estado.creditsUsed += data.creditsUsed.increment;
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        estado.creditsAvailable += data.creditsAvailable.increment;
        estado.creditsUsed -= data.creditsUsed.decrement;
        return estado;
      },
    },
    creditTransaction: {
      create: async ({ data }: any) => {
        movimientos.push(data);
        return data;
      },
    },
  };
  return { p, estado, movimientos };
}

const NEGOCIO: NegocioParaCobro = {
  id: 't1',
  whiteLabelId: 'wl1',
  status: 'SIGNED_UP',
  brandName: 'Negocio de prueba',
  businessType: 'FULL',
  infolinkTier: null,
  planPeriodicity: 'MENSUAL',
};

describe('cobrarCreditoDeActivacion', () => {
  it('cobra 1 crédito a un negocio completo mensual y lo deja anotado', async () => {
    const { p, estado, movimientos } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(p, NEGOCIO, 'onboarding');
    expect(cobro.cobrado).toBe(1);
    expect(estado.creditsAvailable).toBe(4);
    expect(estado.creditsUsed).toBe(1);

    // El movimiento NO existe hasta el commit: si la activación se cae entre
    // medias, no queda un apunte de algo que nunca pasó.
    expect(movimientos).toHaveLength(0);
    await cobro.commit();
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0].amount).toBe(-1);
    expect(movimientos[0].tenantId).toBe('t1');
    expect(movimientos[0].note).toContain('onboarding');
  });

  it('EL CASO SMART SOLUTIONS: negocio completo con periodicidad nula sí cobra', async () => {
    // El 2026-09-10 Smart Solutions entró por el Onboarding con
    // `planPeriodicity = null` y salió ACTIVO sin descontar nada. La
    // periodicidad nula no puede ser una excusa para no cobrar.
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(
      p,
      { ...NEGOCIO, planPeriodicity: null },
      'onboarding',
    );
    expect(cobro.cobrado).toBe(1);
    expect(estado.creditsAvailable).toBe(4);
  });

  it('no recobra si el negocio YA estaba activo', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(
      p,
      { ...NEGOCIO, status: 'ACTIVE' },
      'onboarding',
    );
    expect(cobro.cobrado).toBe(0);
    expect(estado.creditsAvailable).toBe(5);
  });

  it('no cobra a Clubify — va por Hotmart, no por créditos', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'clubify',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(p, NEGOCIO, 'panel');
    expect(cobro.cobrado).toBe(0);
    expect(estado.creditsAvailable).toBe(5);
  });

  it('no cobra a una marca con créditos ilimitados', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'otra',
      creditsUnlimited: true,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(p, NEGOCIO, 'panel');
    expect(cobro.cobrado).toBe(0);
    expect(estado.creditsAvailable).toBe(5);
  });

  it('no cobra a un negocio sin marca', async () => {
    const { p } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(
      p,
      { ...NEGOCIO, whiteLabelId: null },
      'panel',
    );
    expect(cobro.cobrado).toBe(0);
  });

  it('no cobra a un InfoLink FREE: es de captación', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(
      p,
      { ...NEGOCIO, businessType: 'INFOLINK', infolinkTier: 'FREE' },
      'onboarding',
    );
    expect(cobro.cobrado).toBe(0);
    expect(estado.creditsAvailable).toBe(5);
  });

  it('un InfoLink PRO mensual cuesta 0.1 de crédito', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 5,
    });
    const cobro = await cobrarCreditoDeActivacion(
      p,
      { ...NEGOCIO, businessType: 'INFOLINK', infolinkTier: 'PRO' },
      'onboarding',
    );
    expect(cobro.cobrado).toBe(0.1);
    expect(estado.creditsAvailable).toBe(4.9);
  });

  it('sin créditos suficientes NO activa: lanza y no toca el saldo', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 0,
    });
    await expect(
      cobrarCreditoDeActivacion(p, NEGOCIO, 'onboarding'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(estado.creditsAvailable).toBe(0);
    expect(estado.creditsUsed).toBe(0);
  });

  it('el rollback devuelve el crédito tal como estaba', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 3,
    });
    const cobro = await cobrarCreditoDeActivacion(p, NEGOCIO, 'onboarding');
    expect(estado.creditsAvailable).toBe(2);
    await cobro.rollback();
    expect(estado.creditsAvailable).toBe(3);
    expect(estado.creditsUsed).toBe(0);
  });

  it('un anual completo cuesta 12, y con 11 disponibles no pasa', async () => {
    const { p, estado } = prismaFalso({
      id: 'wl1',
      slug: 'sellea',
      creditsUnlimited: false,
      creditsAvailable: 11,
    });
    await expect(
      cobrarCreditoDeActivacion(p, { ...NEGOCIO, planPeriodicity: 'ANUAL' }, 'panel'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(estado.creditsAvailable).toBe(11);
  });
});
