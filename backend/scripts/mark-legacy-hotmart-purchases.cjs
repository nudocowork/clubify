// Marca las rows UNASSIGNED de HotmartCreditPurchase preexistentes (legacy)
// como status='LEGACY' para que no aparezcan en el banner "Compras sin asignar"
// del panel.
//
// Criterio: cualquier row creada ANTES del momento de ejecutar este script
// y que aún tenga status='UNASSIGNED' es legacy. Las nuevas que lleguen
// por webhook después de este punto sí van a aparecer en el banner.
//
// Idempotente. Usage:
//   railway run --service Postgres-Nq8w node \
//     /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/mark-legacy-hotmart-purchases.cjs

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cutoff = new Date();
  console.log(`Marcando como LEGACY rows UNASSIGNED creadas antes de ${cutoff.toISOString()}`);

  const result = await prisma.$executeRawUnsafe(
    `UPDATE "HotmartCreditPurchase"
     SET "status" = 'LEGACY'
     WHERE "status" = 'UNASSIGNED' AND "createdAt" < $1`,
    cutoff,
  );

  console.log(`✓ ${result} rows marcadas como LEGACY`);

  const remaining = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int as count FROM "HotmartCreditPurchase" WHERE status = 'UNASSIGNED'`,
  );
  console.log(`Quedan ${remaining[0].count} compras UNASSIGNED genuinas (que aparecerán en el banner)`);

  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
