import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OnboardingSyncService } from './onboarding-sync.service';

/**
 * EL TEST QUE HABRÍA CAZADO EL BUG.
 *
 * `creditos-de-marca.spec.ts` prueba la regla de cobro por dentro, y pasaba
 * en verde mientras Smart Solutions se activaba gratis: el fallo no estaba en
 * la regla, sino en que **el Onboarding no la llamaba**. Un test de la regla
 * no puede ver eso.
 *
 * Esto prueba la PUERTA: `activate()` cobra, y si no hay créditos no publica.
 * Si alguien quita la llamada de `activate()`, esto se pone rojo.
 */

function servicioDePrueba(opciones: {
  negocio: Record<string, unknown> | null;
  creditosDisponibles: number;
  marcaSlug?: string;
  ilimitada?: boolean;
}) {
  const marca = {
    id: 'wl1',
    slug: opciones.marcaSlug ?? 'sellea',
    creditsUnlimited: opciones.ilimitada ?? false,
    creditsAvailable: opciones.creditosDisponibles,
    creditsUsed: 0,
  };
  const movimientos: any[] = [];
  let publicado = false;
  let estadoFinal: string | null = null;

  const prisma: any = {
    tenant: {
      findUnique: async () => opciones.negocio,
      update: async ({ data }: any) => {
        estadoFinal = data.status;
        return { id: 't1', brandName: 'Smart Solutions', phone: null, slug: 'smart-solutions' };
      },
    },
    whiteLabel: {
      findUnique: async () => ({
        id: marca.id,
        slug: marca.slug,
        creditsUnlimited: marca.creditsUnlimited,
      }),
      updateMany: async ({ where, data }: any) => {
        if (marca.creditsAvailable < (where.creditsAvailable?.gte ?? 0)) return { count: 0 };
        marca.creditsAvailable -= data.creditsAvailable.decrement;
        marca.creditsUsed += data.creditsUsed.increment;
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        marca.creditsAvailable += data.creditsAvailable.increment;
        return marca;
      },
    },
    creditTransaction: {
      create: async ({ data }: any) => {
        movimientos.push(data);
        return data;
      },
    },
    storefront: {
      upsert: async () => {
        publicado = true;
        return {};
      },
    },
  };
  const webhook: any = { emitBusinessActivated: async () => undefined };
  const srv = new OnboardingSyncService(prisma, webhook);
  return {
    srv,
    marca,
    movimientos,
    verPublicado: () => publicado,
    verEstado: () => estadoFinal,
  };
}

const SMART_SOLUTIONS = {
  id: 't1',
  whiteLabelId: 'wl1',
  status: 'SIGNED_UP',
  brandName: 'Smart Solutions',
  businessType: 'FULL',
  infolinkTier: null,
  // Tal cual está en producción: sin periodicidad. No es excusa para no cobrar.
  planPeriodicity: null,
};

describe('OnboardingSyncService.activate', () => {
  it('cobra el crédito de la marca al publicar el negocio', async () => {
    const c = servicioDePrueba({ negocio: SMART_SOLUTIONS, creditosDisponibles: 4 });
    const r = await c.srv.activate('t1');

    expect(r.status).toBe('ACTIVE');
    expect(c.verEstado()).toBe('ACTIVE');
    expect(c.verPublicado()).toBe(true);
    // Lo que NO pasaba el 2026-09-10.
    expect(c.marca.creditsAvailable).toBe(3);
    expect(c.marca.creditsUsed).toBe(1);
    expect(c.movimientos).toHaveLength(1);
    expect(c.movimientos[0].note).toContain('onboarding');
  });

  it('sin créditos NO publica: lanza y el negocio se queda como estaba', async () => {
    const c = servicioDePrueba({ negocio: SMART_SOLUTIONS, creditosDisponibles: 0 });
    await expect(c.srv.activate('t1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(c.verEstado()).toBeNull();
    expect(c.verPublicado()).toBe(false);
    expect(c.marca.creditsAvailable).toBe(0);
  });

  it('reactivar un negocio que ya estaba activo no vuelve a cobrar', async () => {
    const c = servicioDePrueba({
      negocio: { ...SMART_SOLUTIONS, status: 'ACTIVE' },
      creditosDisponibles: 4,
    });
    await c.srv.activate('t1');
    expect(c.marca.creditsAvailable).toBe(4);
    expect(c.movimientos).toHaveLength(0);
  });

  it('una marca con créditos ilimitados publica sin gastar', async () => {
    const c = servicioDePrueba({
      negocio: SMART_SOLUTIONS,
      creditosDisponibles: 4,
      ilimitada: true,
    });
    await c.srv.activate('t1');
    expect(c.verPublicado()).toBe(true);
    expect(c.marca.creditsAvailable).toBe(4);
  });
});
