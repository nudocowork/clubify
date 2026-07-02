// Migración 20260828_business_group_price (2026-07-02):
//   - BusinessGroup.priceUsd Decimal? — precio real del grupo por periodo
//     (ej: 3 negocios × $50 = $150 MENSUAL). Base de la comisión y del facturado.
//   - Data fix: "Aldehir - Grupo Mistika" → MENSUAL + priceUsd=150 (estaba en
//     TRIMESTRAL como workaround para que el canónico diera 150).
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-business-group-price-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260828_business_group_price';

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "BusinessGroup" ADD COLUMN IF NOT EXISTS "priceUsd" DECIMAL(10,2)`,
  );
  console.log('✅ DDL aplicado (columna priceUsd, idempotente).');

  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada.');
  }

  // Data fix: Grupo Mistika = MENSUAL $150 (3 negocios × $50)
  const g = await prisma.businessGroup.findFirst({
    where: { name: { contains: 'mistika', mode: 'insensitive' }, deletedAt: null },
    select: { id: true, name: true, planPeriodicity: true, priceUsd: true },
  });
  if (g) {
    console.log(`\n"${g.name}": ${g.planPeriodicity}/$${g.priceUsd ?? 'null'} → MENSUAL/$150`);
    await prisma.businessGroup.update({
      where: { id: g.id },
      data: { planPeriodicity: 'MENSUAL', priceUsd: 150 },
    });
    // Ajusta la comisión viva del grupo a baseAmountUsd=150 (ya debería ser $15).
    const comms = await prisma.commission.findMany({
      where: { businessGroupId: g.id, status: { in: ['PENDING', 'APPROVED', 'PAID'] } },
      select: { id: true, amount: true, appliedPercent: true, recipientCode: { select: { commissionPercent: true } } },
    });
    for (const c of comms) {
      const pct = Number(c.appliedPercent ?? c.recipientCode?.commissionPercent ?? 10);
      const amt = Math.round(150 * pct) / 100;
      await prisma.commission.update({ where: { id: c.id }, data: { amount: amt, baseAmountUsd: 150, appliedPercent: pct } });
      console.log(`   · comisión → $${amt} (${pct}% de $150)`);
    }
    console.log('   ✅ grupo + comisión(es) OK');
  } else {
    console.log('\n⚠️ Grupo Mistika no encontrado.');
  }

  await prisma.$disconnect();
  console.log('\nListo. Ahora sí deployá el backend.');
})().catch((e) => { console.error(e); process.exit(1); });
