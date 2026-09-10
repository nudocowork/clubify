/**
 * `Tenant.canceledAt` — cancelar deja de cortar el servicio en el acto.
 *
 * Decision de Javier (2026-09-10): quien cancela sigue hasta el fin del
 * periodo que ya pago. Antes el manejador suspendia al recibir el aviso, o
 * sea que avisar el 10 cuando pagaste hasta el 25 te costaba dos semanas.
 *
 * Con esta columna: el aviso marca la fecha, el negocio sigue ACTIVE, no
 * recibe recordatorios de un cobro que no va a ocurrir, y el cron diario lo
 * suspende cuando `currentPeriodEnd` pasa.
 *
 * Aditiva e idempotente. Un reembolso o contracargo siguen suspendiendo en el
 * acto: ahi el dinero volvio.
 *
 *   railway run node scripts/apply-cancelacion-fin-periodo-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  await p.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP(3)`,
  );
  console.log('  ok · Tenant.canceledAt');

  const col = await p.$queryRawUnsafe(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name='Tenant' AND column_name='canceledAt'`,
  );
  if (!col.length) throw new Error('la columna no quedo creada');
  if (col[0].is_nullable !== 'YES') throw new Error('canceledAt tiene que admitir NULL');

  // Indice para el cron diario: busca ACTIVE + canceledAt + vencimiento.
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "Tenant_canceledAt_periodEnd_idx"
       ON "Tenant"("currentPeriodEnd") WHERE "canceledAt" IS NOT NULL`,
  );
  console.log('  ok · indice del cron');

  const n = await p.tenant.count({ where: { canceledAt: { not: null } } });
  console.log(`\nlisto · negocios marcados como cancelados: ${n}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
