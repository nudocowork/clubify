// Migración 20260826_pass_legacy_qrtokens (P3 scanner PDF 2026-07-01):
//   - Pass.legacyQrTokens TEXT[] NOT NULL DEFAULT '{}' — tokens QR anteriores
//     (o de pases fusionados). El scanner resuelve también por acá para que un
//     código ya instalado en la billetera del cliente NUNCA deje de escanear.
//   - Índice GIN para la búsqueda `has`.
// Idempotente. Correr ANTES de deployar el backend nuevo.
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/apply-pass-legacy-qrtokens-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260826_pass_legacy_qrtokens';

  const statements = [
    `ALTER TABLE "Pass" ADD COLUMN IF NOT EXISTS "legacyQrTokens" TEXT[] NOT NULL DEFAULT '{}'`,
    `CREATE INDEX IF NOT EXISTS "Pass_legacyQrTokens_idx" ON "Pass" USING GIN ("legacyQrTokens")`,
  ];
  for (const st of statements) await prisma.$executeRawUnsafe(st);
  console.log(`✅ DDL aplicado (${statements.length} sentencias, idempotente).`);

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
  await prisma.$disconnect();
  console.log('\nListo. Ahora sí deployá el backend.');
})().catch((e) => { console.error(e); process.exit(1); });
