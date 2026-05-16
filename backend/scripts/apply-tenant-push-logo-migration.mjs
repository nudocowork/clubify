#!/usr/bin/env node
/**
 * Migration 20260531_tenant_push_logo — agrega Tenant.pushLogoUrl
 * (logo dedicado al icon.png del .pkpass = banner de push iPhone).
 *
 * Idempotente: ADD COLUMN IF NOT EXISTS + check en _prisma_migrations.
 *
 * Uso:
 *   railway run --service Postgres-Nq8w -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/apply-tenant-push-logo-migration.mjs'
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();
const MIGRATION_NAME = '20260531_tenant_push_logo';

async function main() {
  console.log(`Aplicando migration ${MIGRATION_NAME}...\n`);

  // 1) ALTER TABLE — agregar columna (idempotente)
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "pushLogoUrl" TEXT`,
  );
  console.log('✓ Columna Tenant.pushLogoUrl creada (o ya existía)');

  // 2) Verificación
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'Tenant' AND column_name = 'pushLogoUrl'`,
  );
  if (!Array.isArray(cols) || cols.length === 0) {
    throw new Error('pushLogoUrl no existe tras el ALTER — abortando');
  }
  console.log('✓ Verificación: columna presente en information_schema');

  // 3) Marcar en _prisma_migrations para que el container no haga P3018 al bootear
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" varchar(36) PRIMARY KEY NOT NULL,
      "checksum" varchar(64) NOT NULL,
      "finished_at" timestamptz,
      "migration_name" varchar(255) NOT NULL,
      "logs" text,
      "rolled_back_at" timestamptz,
      "started_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "applied_steps_count" integer NOT NULL DEFAULT 0
    )
  `);

  const existing = await prisma.$queryRawUnsafe(
    `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`= ${MIGRATION_NAME} ya marcada en _prisma_migrations`);
  } else {
    const id = crypto.randomUUID();
    const checksum = crypto.randomBytes(32).toString('hex'); // dummy
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, 1)`,
      id,
      checksum,
      MIGRATION_NAME,
    );
    console.log(`✓ ${MIGRATION_NAME} marcada como aplicada en _prisma_migrations`);
  }

  console.log('\n✓ Migration lista. El campo Tenant.pushLogoUrl está disponible.');
}

main()
  .catch((e) => {
    console.error('✗ Error:', e?.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
