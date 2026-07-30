// Migración 20260716120000_add_whitelabel_whatsapp_qr:
//   - WhiteLabel.whatsappQrUrl String? — enlace de conexión de WhatsApp de la
//     marca (proveedor tipo wazzap.mx). Lo pega el super admin en /superadmin;
//     el panel /admin genera un QR con él (Automatizaciones → QR WhatsApp).
// Idempotente. Correr ANTES de deployar el backend nuevo.
//   railway run --service Postgres-Nq8w node scripts/apply-whatsapp-qr-migration.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260716120000_add_whitelabel_whatsapp_qr';

  await prisma.$executeRawUnsafe(
    `ALTER TABLE "WhiteLabel" ADD COLUMN IF NOT EXISTS "whatsappQrUrl" TEXT`,
  );
  console.log('✅ DDL aplicado (columna WhiteLabel.whatsappQrUrl, idempotente).');

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
  const n = await prisma.whiteLabel.count();
  console.log(`\n${n} marcas (whatsappQrUrl=null por default). Listo para deployar.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
