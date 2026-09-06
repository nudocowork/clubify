/**
 * Añade `Tenant.graceNoticeSentAt` — la marca de los avisos de la gracia.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra.
 *
 * Nace en NULL para todos: nadie ha recibido todavía los avisos de los días
 * 3, 4 y 5, así que el primero que llegue a esos días los recibirá.
 *
 *   railway run node scripts/apply-gracia-avisos-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "graceNoticeSentAt" TIMESTAMP(3)`,
  );
  console.log('  ok · Tenant.graceNoticeSentAt');

  const col = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='Tenant' AND column_name='graceNoticeSentAt'`,
  );
  if (col[0].n !== 1) throw new Error('falta Tenant.graceNoticeSentAt');

  // Quién está hoy dentro de la gracia: son los que van a empezar a recibir
  // los avisos nuevos esta misma madrugada.
  const enMora = await p.tenant.count({
    where: { status: 'ACTIVE', failedPaymentCount: { gt: 0 } },
  });
  console.log(`\nlisto · negocios con un cobro fallido marcado: ${enMora}`);
})()
  .catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
