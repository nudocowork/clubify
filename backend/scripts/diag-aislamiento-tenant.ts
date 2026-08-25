/**
 * ¿El middleware de aislamiento entre negocios está roto, o el test lo llama
 * mal? Compara las dos formas de invocarlo:
 *
 *   A) () => prisma.x.findUnique(...)         ← PrismaPromise PEREZOSA: se
 *      devuelve sin esperar, `run` sale del contexto ALS, y la consulta corre
 *      después, ya fuera. El middleware no ve scope.
 *
 *   B) async () => await prisma.x.findUnique(...)  ← se espera DENTRO del
 *      contexto, que es como ocurre en un request real (el interceptor
 *      envuelve todo el handler).
 *
 * Uso: npx ts-node scripts/diag-aislamiento-tenant.ts
 */
import { PrismaClient } from '@prisma/client';
import { tenantMiddleware } from '../src/common/prisma/prisma-tenant-middleware';
import { TenantContext } from '../src/common/tenant/tenant-context';

const prisma = new PrismaClient();
prisma.$use(tenantMiddleware());

async function main() {
  // No hace falta un segundo negocio real: basta con poner el contexto en OTRO
  // negocio (un id cualquiera) y leer un cliente del que sí existe. Si el
  // middleware enforcea, no debería devolverlo.
  const ajeno = await prisma.customer.findFirst({
    select: { id: true, tenantId: true },
  });
  if (!ajeno) return console.log('No hay clientes en la base. Corre el seed.');
  const b = ajeno.tenantId as string;
  const a = '00000000-0000-4000-8000-000000000001'; // negocio distinto

  const ctx = {
    tenantId: a,
    userId: null,
    role: 'TENANT_OWNER' as const,
    bypass: false,
  };

  console.log(`Negocio A: ${a.slice(0, 8)}…  ·  cliente ajeno (de B): ${ajeno.id.slice(0, 8)}…\n`);

  // A) como lo llama el test hoy
  const perezosa = await TenantContext.run(ctx, () =>
    prisma.customer.findUnique({ where: { id: ajeno.id } }),
  );
  console.log(
    `A) sin await dentro del contexto → ${perezosa ? '❌ DEVOLVIÓ el cliente ajeno' : '✔ null'}`,
  );

  // B) como ocurre en un request real
  const esperada = await TenantContext.run(ctx, async () =>
    prisma.customer.findUnique({ where: { id: ajeno.id } }),
  );
  console.log(
    `B) con await dentro del contexto → ${esperada ? '❌ DEVOLVIÓ el cliente ajeno' : '✔ null (el middleware bloqueó)'}`,
  );

  // Y el findMany, igual.
  const listaPerezosa = await TenantContext.run(ctx, () =>
    prisma.customer.findMany({ select: { tenantId: true } }),
  );
  const listaEsperada = await TenantContext.run(ctx, async () =>
    prisma.customer.findMany({ select: { tenantId: true } }),
  );
  const ajenosEn = (l: { tenantId: string }[]) =>
    l.filter((c) => c.tenantId !== a).length;
  console.log(
    `\nfindMany sin await → ${ajenosEn(listaPerezosa)} registros de otros negocios`,
  );
  console.log(
    `findMany con await → ${ajenosEn(listaEsperada)} registros de otros negocios`,
  );
}

main()
  .catch((e) => console.error('ERROR:', e?.message ?? e))
  .finally(() => prisma.$disconnect());
