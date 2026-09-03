// Migración 20260717_wallet_v3 — Wallet V3:
//   - Card.stampBgType (SOLID|GRADIENT|IMAGE), Card.stampBgImageUrl, Card.freeRewards
//     · Tarjetas EXISTENTES → 'GRADIENT' (opt-in: no cambian de aspecto).
//     · Tarjetas NUEVAS → 'SOLID' (color uniforme).
//   - Stamp.ip, Stamp.device (auditoría de ajustes manuales +1/-1).
//   - WhiteLabel.walletAdvanced (permisos por marca; null = heredado/activo).
//   - Enum StampAction += 'STAMP_REMOVE'.
// Idempotente. Correr ANTES de deployar el backend nuevo.
//   railway run --service Postgres-Nq8w node scripts/apply-wallet-v3-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260717_wallet_v3';

  // 1) Enum value (fuera de transacción: ADD VALUE no admite uso en la misma tx)
  await prisma.$executeRawUnsafe(`ALTER TYPE "StampAction" ADD VALUE IF NOT EXISTS 'STAMP_REMOVE'`);

  // 2) Card — fondo de sellos + premios free
  await prisma.$executeRawUnsafe(`ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampBgType" TEXT NOT NULL DEFAULT 'SOLID'`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "stampBgImageUrl" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "freeRewards" JSONB NOT NULL DEFAULT '[]'`);

  // 3) Opt-in: las tarjetas EXISTENTES conservan su degradado.
  //    Solo backfillea filas creadas antes de esta corrida (idempotente: en
  //    re-runs no toca las nuevas 'SOLID' que se hayan creado después).
  const backfill = await prisma.$executeRawUnsafe(
    `UPDATE "Card" SET "stampBgType" = 'GRADIENT'
     WHERE "stampBgType" = 'SOLID' AND "createdAt" < $1`,
    new Date(),
  );
  console.log(`✅ Card: columnas ok. Backfill GRADIENT en ${backfill} tarjeta(s) existente(s).`);

  // 4) Stamp — auditoría
  await prisma.$executeRawUnsafe(`ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "ip" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Stamp" ADD COLUMN IF NOT EXISTS "device" TEXT`);

  // 5) WhiteLabel — Wallet Avanzado
  await prisma.$executeRawUnsafe(`ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "walletAdvanced" JSONB`);
  console.log('✅ Stamp.ip/device + WhiteLabel.walletAdvanced ok.');

  // 6) Registrar en _prisma_migrations
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
  console.log('\nListo. Ahora podés deployar el backend nuevo.');
})().catch((e) => { console.error(e); process.exit(1); });
