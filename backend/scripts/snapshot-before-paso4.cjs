// Backup PRE-PASO4: snapshot COMPLETO (todas las columnas) de Commission +
// PayoutBatch a JSON local, + un rollback determinista de las 5 filas del
// corte. Es la red de seguridad restaurable para el único cambio de PASO 4
// (el libro es derivado; PASO 4 solo muta 5 Commission + 1 PayoutBatch).
// Usage: railway run --service Postgres-Nq8w node scripts/snapshot-before-paso4.cjs <outDir>
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

(async () => {
  const outDir = process.argv[2] || '.';
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const commissions = await prisma.commission.findMany();
  let batches = [];
  try { batches = await prisma.payoutBatch.findMany(); } catch { /* pre-migración */ }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `snapshot-commission-payoutbatch-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ commissions, batches }, null, 2));

  const r2 = (n) => Math.round(n * 100) / 100;
  const sumAmt = r2(commissions.reduce((s, c) => s + Number(c.amount), 0));
  const sumPaid = r2(commissions.reduce((s, c) => s + Number(c.amountPaid), 0));
  console.log(`✅ Snapshot escrito: ${file}`);
  console.log(`   Commission: ${commissions.length} filas · Σamount=$${sumAmt} · ΣamountPaid=$${sumPaid}`);
  console.log(`   PayoutBatch: ${batches.length} filas`);
  console.log(`   (Restaurable: cada fila tiene TODAS sus columnas para un update de vuelta.)`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
