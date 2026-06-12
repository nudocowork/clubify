// Diagnóstico: cuántas Commissions tendrían UNIQUE collision si
// agregamos UNIQUE(referralUseId, recipientCodeId, periodKey) donde
// periodKey = YYYY-MM derivado de createdAt.
//
// Usage: railway run --service Postgres-Nq8w node scripts/check-commission-duplicates.cjs

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('🔍 Buscando duplicados (mismo referralUseId + recipientCodeId + mes)...\n');

  // Agrupa por (referralUseId, recipientCodeId, mes) y cuenta. Solo considera
  // rows con recipientCodeId NOT NULL (las viejas legacy con null se
  // resuelven derivando del use.code y no las contamos como dups).
  const dups = await prisma.$queryRawUnsafe(`
    SELECT
      "referralUseId",
      "recipientCodeId",
      to_char("createdAt", 'YYYY-MM') AS "periodKey",
      COUNT(*)::int AS "count",
      STRING_AGG(id, ', ') AS "ids",
      STRING_AGG(status::text, ', ') AS "statuses"
    FROM "Commission"
    WHERE "recipientCodeId" IS NOT NULL
    GROUP BY "referralUseId", "recipientCodeId", to_char("createdAt", 'YYYY-MM')
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
    LIMIT 100
  `);

  console.log(`Grupos con duplicados: ${dups.length}`);

  if (dups.length === 0) {
    console.log('✅ Cero duplicados en (referralUseId, recipientCodeId, YYYY-MM).');
    console.log('   Safe para agregar UNIQUE constraint.\n');
  } else {
    let totalRows = 0;
    let totalExtra = 0;
    for (const d of dups) {
      totalRows += d.count;
      totalExtra += d.count - 1;
    }
    console.log(`Total rows en grupos duplicados: ${totalRows}`);
    console.log(`Total rows que tendrían que eliminarse para liberar el UNIQUE: ${totalExtra}\n`);
    console.log('Top 20:\n');
    for (const d of dups.slice(0, 20)) {
      console.log(`  ${d.periodKey} | useId=${d.referralUseId.slice(0, 8)} recip=${d.recipientCodeId.slice(0, 8)} count=${d.count} statuses=[${d.statuses}]`);
    }
  }

  // Bonus: filas con periodKey null (recipientCodeId null) — info, no bloquea.
  const nullRecips = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "count" FROM "Commission" WHERE "recipientCodeId" IS NULL
  `);
  console.log(`\nℹ️  Commissions con recipientCodeId NULL (legacy, no afectan UNIQUE): ${nullRecips[0].count}`);

  await prisma.$disconnect();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
