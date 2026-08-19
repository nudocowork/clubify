import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { TenantContext } from '../src/common/tenant/tenant-context';

/**
 * Test cross-tenant negativo: verifica que un user de tenant A NO puede
 * leer datos de tenant B aunque adivine el id.
 *
 * Cubre dos capas:
 *   1. HTTP — el controller responde 404/403 cuando se pide un record ajeno.
 *   2. Prisma middleware — incluso si un service olvidara el guardTenant
 *      manual, el middleware bloquea findUnique y filtra findMany.
 */

let app: INestApplication;
let prisma: PrismaService;

type SignupResult = {
  tokens: { accessToken: string };
  tenantId: string;
  userId: string;
};

const stamp = Date.now();
const TENANT_A_EMAIL = `iso-a-${stamp}@clubify.local`;
const TENANT_B_EMAIL = `iso-b-${stamp}@clubify.local`;

async function signup(email: string, brandName: string): Promise<SignupResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/signup')
    .send({
      email,
      password: 'TestPass123!',
      fullName: 'Test Owner',
      brandName,
    });
  expect(res.status).toBe(201);
  return {
    tokens: { accessToken: res.body.accessToken },
    tenantId: res.body.tenant.id,
    userId: res.body.user.id,
  };
}

async function createCustomer(token: string, fullName: string) {
  const res = await request(app.getHttpServer())
    .post('/api/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({ fullName });
  expect(res.status).toBe(201);
  return res.body as { id: string; tenantId: string; fullName: string };
}

let A: SignupResult;
let B: SignupResult;
let customerInA: { id: string; tenantId: string };
let customerInB: { id: string; tenantId: string };

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  prisma = app.get(PrismaService);

  // Limpieza idempotente: si el test corrió antes con el mismo timestamp,
  // borrar tenants huérfanos. (Defensive — normalmente el stamp es único.)
  await prisma.user
    .deleteMany({ where: { email: { in: [TENANT_A_EMAIL, TENANT_B_EMAIL] } } })
    .catch(() => null);

  A = await signup(TENANT_A_EMAIL, `Iso A ${stamp}`);
  B = await signup(TENANT_B_EMAIL, `Iso B ${stamp}`);

  customerInA = await createCustomer(A.tokens.accessToken, 'Cliente de A');
  customerInB = await createCustomer(B.tokens.accessToken, 'Cliente de B');

  expect(A.tenantId).not.toBe(B.tenantId);
  expect(customerInA.tenantId).toBe(A.tenantId);
  expect(customerInB.tenantId).toBe(B.tenantId);
});

afterAll(async () => {
  // Cleanup: borrar los dos tenants creados.
  if (A?.tenantId) {
    await prisma.tenant
      .delete({ where: { id: A.tenantId } })
      .catch(() => null);
  }
  if (B?.tenantId) {
    await prisma.tenant
      .delete({ where: { id: B.tenantId } })
      .catch(() => null);
  }
  await app?.close();
});

describe('multi-tenant isolation', () => {
  describe('HTTP layer', () => {
    it('GET /api/customers con token A NO incluye customers de B', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/customers')
        .set('Authorization', `Bearer ${A.tokens.accessToken}`);
      expect(res.status).toBe(200);
      const ids = (res.body as any[]).map((c) => c.id);
      expect(ids).toContain(customerInA.id);
      expect(ids).not.toContain(customerInB.id);
    });

    it('GET /api/customers/:id con token A pidiendo customer de B → 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/customers/${customerInB.id}`)
        .set('Authorization', `Bearer ${A.tokens.accessToken}`);
      // El middleware Prisma convierte el findUnique cross-tenant en null,
      // el service entonces lanza NotFoundException.
      expect([403, 404]).toContain(res.status);
    });

    it('PATCH /api/customers/:id con token A modificando customer de B → bloqueado', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/customers/${customerInB.id}`)
        .set('Authorization', `Bearer ${A.tokens.accessToken}`)
        .send({ fullName: 'Hackeado' });
      expect([403, 404]).toContain(res.status);

      // Verificar que el record en B sigue intacto leyendo con token B.
      const check = await request(app.getHttpServer())
        .get(`/api/customers/${customerInB.id}`)
        .set('Authorization', `Bearer ${B.tokens.accessToken}`);
      expect(check.status).toBe(200);
      expect(check.body.fullName).toBe('Cliente de B');
    });
  });

  /**
   * OJO con la forma de estas llamadas: hay que ESPERAR dentro del contexto.
   *
   * `PrismaPromise` es perezosa — no ejecuta hasta que la esperan. Si se hace
   * `TenantContext.run(ctx, () => prisma.x.findUnique(...))`, `run` devuelve la
   * promesa sin esperarla, sale del scope de AsyncLocalStorage, y la consulta
   * corre después, ya sin contexto: el middleware no ve scope y no filtra nada.
   *
   * Estos tests estuvieron rojos mucho tiempo por eso, y parecía un agujero de
   * aislamiento entre negocios. No lo era: en un request real el interceptor
   * envuelve todo el handler, así que los await ocurren dentro del contexto.
   */
  describe('Prisma middleware layer', () => {
    it('findUnique cross-tenant retorna null bajo TenantContext de A', async () => {
      // Simulamos un service que se "olvidó" del guardTenant y hace un
      // findUnique sólo por id. El middleware debe bloquear.
      const result = await TenantContext.run(
        {
          tenantId: A.tenantId,
          userId: A.userId,
          role: 'TENANT_OWNER',
          bypass: false,
        },
        async () => await prisma.customer.findUnique({ where: { id: customerInB.id } }),
      );
      expect(result).toBeNull();
    });

    it('findMany sin where.tenantId queda scoped automáticamente al tenant activo', async () => {
      const list = await TenantContext.run(
        {
          tenantId: A.tenantId,
          userId: A.userId,
          role: 'TENANT_OWNER',
          bypass: false,
        },
        async () => await prisma.customer.findMany({}),
      );
      const ids = list.map((c) => c.id);
      expect(ids).toContain(customerInA.id);
      expect(ids).not.toContain(customerInB.id);
    });

    it('SUPER_ADMIN context bypassa el enforcement', async () => {
      const result = await TenantContext.run(
        {
          tenantId: null,
          userId: 'super-admin-test',
          role: 'SUPER_ADMIN',
          bypass: false,
        },
        async () => await prisma.customer.findUnique({ where: { id: customerInB.id } }),
      );
      expect(result?.id).toBe(customerInB.id);
    });

    it('create con data.tenantId distinto al activo es bloqueado', async () => {
      await expect(
        TenantContext.run(
          {
            tenantId: A.tenantId,
            userId: A.userId,
            role: 'TENANT_OWNER',
            bypass: false,
          },
          async () =>
            prisma.customer.create({
              data: {
                fullName: 'Intruso',
                tenantId: B.tenantId,
              },
            }),
        ),
      ).rejects.toThrow(/Cross-tenant/);
    });
  });
});
