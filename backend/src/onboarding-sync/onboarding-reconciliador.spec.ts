import { describe, it, expect } from 'vitest';
import { OnboardingReconciliadorService } from './onboarding-reconciliador.service';

/**
 * El reconciliador del onboarding.
 *
 * Existe porque `crearClienteEnOnboarding` se llama desde UN sitio —el botón
 * «crear negocio» del panel— y un negocio nace por cinco caminos. Laly.com
 * compró, se registró sola, y su onboarding no existió nunca.
 *
 * Lo que se prueba es lo que duele si falla: que NO dé de alta dos veces al
 * mismo, que reintente al que falló, y que no toque a las marcas blancas.
 */
function servicio(opts: {
  negocios: Array<{ id: string; slug: string }>;
  tokensVivos: string[];
}) {
  const altas: string[] = [];
  const conToken = new Set(opts.tokensVivos);
  let whereNegocios: any = null;
  const prisma: any = {
    tenant: {
      findMany: async ({ where }: any) => {
        whereNegocios = where;
        return opts.negocios;
      },
    },
    onboardingToken: {
      findMany: async ({ where }: any) =>
        where.tenantId.in
          .filter((id: string) => conToken.has(id))
          .map((tenantId: string) => ({ tenantId })),
    },
  };
  const webhook: any = {
    crearClienteEnOnboarding: async (id: string) => {
      altas.push(id);
      // El alta buena deja su huella; así se comporta la de verdad.
      if (!id.startsWith('falla-')) conToken.add(id);
    },
    tieneOnboarding: async (id: string) => conToken.has(id),
  };
  return {
    srv: new OnboardingReconciliadorService(prisma, webhook),
    altas,
    verWhere: () => whereNegocios,
  };
}

describe('OnboardingReconciliadorService', () => {
  it('EL CASO LALY.COM: da de alta al que no tiene onboarding', async () => {
    const c = servicio({
      negocios: [{ id: 'laly', slug: 'laly-com' }],
      tokensVivos: [],
    });
    const r = await c.srv.reconciliar();
    expect(c.altas).toEqual(['laly']);
    expect(r.dadosDeAlta).toBe(1);
  });

  it('NO vuelve a dar de alta al que ya tiene token vivo', async () => {
    const c = servicio({
      negocios: [{ id: 'ya', slug: 'ya-esta' }],
      tokensVivos: ['ya'],
    });
    const r = await c.srv.reconciliar();
    expect(c.altas).toEqual([]);
    expect(r.revisados).toBe(0);
  });

  it('reintenta al que falló: un token REVOCADO no cuenta como huella', async () => {
    // `tokensVivos` solo trae los no revocados, que es justo el criterio. Un
    // alta fallida revoca su token, asi que el negocio vuelve a entrar aqui.
    const c = servicio({
      negocios: [{ id: 'falla-1', slug: 'reintento' }],
      tokensVivos: [],
    });
    const r = await c.srv.reconciliar();
    expect(c.altas).toEqual(['falla-1']);
    // No entró: se contabiliza como NO dado de alta para que el log avise.
    expect(r.dadosDeAlta).toBe(0);
  });

  it('solo mira negocios de Clubify, nunca de una marca blanca', async () => {
    const c = servicio({ negocios: [], tokensVivos: [] });
    await c.srv.reconciliar();
    const w = c.verWhere();
    expect(w.OR).toEqual([
      { whiteLabelId: null },
      { whiteLabel: { slug: 'clubify' } },
    ]);
  });

  it('no toca negocios suspendidos ni el tenant de campañas', async () => {
    const c = servicio({ negocios: [], tokensVivos: [] });
    await c.srv.reconciliar();
    const w = c.verWhere();
    expect(w.status).toEqual({ in: ['ACTIVE', 'TRIAL'] });
    expect(w.isCampaignHost).toBe(false);
  });

  it('mira solo los ULTIMOS 30 dias, para no molestar a negocios viejos', async () => {
    const c = servicio({ negocios: [], tokensVivos: [] });
    await c.srv.reconciliar();
    const desde: Date = c.verWhere().createdAt.gte;
    const dias = Math.round((Date.now() - desde.getTime()) / 86400000);
    expect(dias).toBe(30);
  });

  it('se limita a 10 por pasada: cada alta es un POST a otra app', async () => {
    const negocios = Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`,
      slug: `n${i}`,
    }));
    const c = servicio({ negocios, tokensVivos: [] });
    const r = await c.srv.reconciliar();
    expect(c.altas).toHaveLength(10);
    expect(r.revisados).toBe(10);
  });
});
