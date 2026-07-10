// Aplica 20260819_delivery_vehicles a prod (idempotente): tabla DeliveryVehicle
// (flota de motos) + Delivery.vehicleId + FKs. Correr ANTES de deployar el
// backend nuevo (el cliente Prisma selecciona vehicleId/vehicle).
// Usage: railway run --service Postgres-Nq8w node backend/scripts/apply-delivery-vehicles-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '20260819_delivery_vehicles';

  const tbl = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name='DeliveryVehicle' LIMIT 1`,
  );
  if (tbl.length) {
    console.log('• DeliveryVehicle ya existe — salto el DDL.');
  } else {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'),
      'utf8',
    );
    const statements = sql
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .split(';').map((s) => s.trim()).filter(Boolean);
    for (const st of statements) await prisma.$executeRawUnsafe(st);
    console.log(`✅ DDL aplicado (${statements.length} sentencias).`);
  }

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
