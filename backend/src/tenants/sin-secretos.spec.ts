import { describe, it, expect } from 'vitest';
import { TenantsService } from './tenants.service';

/**
 * Lo que el panel recibe de un negocio no lleva sus secretos.
 *
 * EL FALLO (arqueo 2026-09-17): `Tenant.growBusinessApiKey` —la llave con la
 * que el negocio manda SMS por Grow Business— salía en claro en `GET/PATCH
 * /tenants/me` (hasta el rol «Solo pedidos» la veía), en `GET /tenants` y en
 * `GET /tenants/:id`. Y al crear un negocio, la respuesta traía el usuario
 * dueño entero: `passwordHash` y `totpSecret` incluidos.
 *
 * El panel usa la clave SOLO para saber si hay conexión (`reviews/page.tsx`
 * mira que no esté vacía), así que se devuelve enmascarada y no vacía.
 */

const CLAVE = 'pit-5e6f7a8b-LLAVE-SECRETA-4321';

const negocio = (extra: Record<string, unknown> = {}) => ({
  id: 't1',
  slug: 'cafe',
  brandName: 'Café',
  growBusinessLocationId: 'loc-1',
  growBusinessApiKey: CLAVE,
  whiteLabel: null,
  storefront: null,
  plan: { id: 'plan', maxLocations: 1 },
  _count: { cards: 0, customers: 0, products: 0, locations: 0, passes: 0, users: 1 },
  businessType: 'FULL',
  infolinkTier: null,
  planPeriodicity: null,
  trialEndsAt: null,
  ...extra,
});

function montar(prismaExtra: Record<string, any> = {}) {
  const prisma: any = {
    tenant: {
      findUnique: async () => negocio(),
      findFirst: async () => negocio(),
      findMany: async () => [negocio()],
      update: async () => negocio(),
    },
    whiteLabel: { findFirst: async () => ({ id: 'wl-clubify' }), findUnique: async () => null },
    order: { groupBy: async () => [] },
    referralUse: { count: async () => 0 },
    ...prismaExtra,
  };
  const deps: any[] = [
    prisma,
    { hashPassword: async () => 'hash' }, // auth
    {}, // jwt
    { log: () => undefined }, // audit
    { recalcTenantSplit: async () => undefined }, // referrals
    {}, // queue
    {}, // growBusiness
    {}, // recalc
    { emitBusinessActivated: async () => undefined, crearClienteEnOnboarding: async () => undefined },
    {}, // incomeRecord
  ];
  return new (TenantsService as any)(...deps) as TenantsService;
}

const noFiltra = (r: unknown) => expect(JSON.stringify(r)).not.toContain('LLAVE-SECRETA');

describe('TenantsService: la llave de Grow Business nunca sale en claro', () => {
  it('GET /tenants/me', async () => {
    const r: any = await montar().getMine('t1');
    noFiltra(r);
    // El panel de reseñas decide «conectado» por que no esté vacía.
    expect(r.growBusinessApiKey).toBeTruthy();
  });

  it('PATCH /tenants/me', async () => {
    const r = await montar().updateMine('t1', { reviewAlertsEnabled: true });
    noFiltra(r);
  });

  it('GET /tenants', async () => {
    noFiltra(await montar().list({ id: 'u', role: 'SUPER_ADMIN', tenantId: null } as any));
  });

  it('GET /tenants/:id', async () => {
    noFiltra(await montar().getById('t1'));
  });

  it('PATCH /tenants/:id', async () => {
    noFiltra(await montar().update('t1', { phone: '3001112233' }));
  });

  it('extender la prueba y cambiar el estado tampoco la devuelven', async () => {
    const svc: any = montar();
    svc.clampTrialEnd = async (_wl: unknown, fin: Date) => fin;
    noFiltra(await svc.extendTrial('t1', 7, 'actor'));
    svc.chargeBrandCreditForActivation = async () => ({ rollback: async () => undefined, commit: async () => undefined });
    noFiltra(await svc.setStatus('t1', 'SUSPENDED', 'actor'));
  });
});

describe('TenantsService.create: la respuesta no trae la contraseña del dueño', () => {
  it('ni passwordHash ni totpSecret', async () => {
    const dueno = {
      id: 'u1',
      email: 'duena@cafe.co',
      fullName: 'Dueña',
      role: 'TENANT_OWNER',
      passwordHash: '$argon2id$HASH-DE-LA-DUENA',
      totpSecret: 'TOTP-DE-LA-DUENA',
      tenantId: 't1',
      isActive: true,
    };
    const svc = montar({
      user: { findUnique: async () => null },
      tenant: {
        findUnique: async () => null, // slug libre
        // Como Prisma: `include: { users: true }` trae la fila entera y un
        // `select` solo lo pedido.
        create: async ({ include }: any) => {
          const users = include?.users === true
            ? [dueno]
            : [Object.fromEntries(Object.keys(include?.users?.select ?? {}).filter((k) => include.users.select[k]).map((k) => [k, (dueno as any)[k]]))];
          return { ...negocio({ status: 'TRIAL' }), users };
        },
      },
    });
    const r = await svc.create({
      brandName: 'Café Nuevo',
      email: 'duena@cafe.co',
      ownerFullName: 'Dueña',
      planId: 'plan',
    });
    const texto = JSON.stringify(r);
    expect(texto).not.toContain('HASH-DE-LA-DUENA');
    expect(texto).not.toContain('TOTP-DE-LA-DUENA');
    noFiltra(r);
    expect(r.tenant.id).toBe('t1');
  });
});
