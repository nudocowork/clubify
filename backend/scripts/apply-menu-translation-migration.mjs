#!/usr/bin/env node
/**
 * Fase 2 i18n menú — crea la tabla MenuTranslation en prod.
 * Idempotente: usa IF NOT EXISTS en CREATE TABLE/INDEX y catchea
 * 'already exists' en la FK.
 *
 * Uso:
 *   railway run --service Postgres-Nq8w -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/apply-menu-translation-migration.mjs'
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STATEMENTS = [
  {
    label: 'CREATE TABLE MenuTranslation',
    sql: `CREATE TABLE IF NOT EXISTS "MenuTranslation" (
      "id" TEXT NOT NULL,
      "tenantId" TEXT NOT NULL,
      "entityType" TEXT NOT NULL,
      "entityId" TEXT NOT NULL,
      "field" TEXT NOT NULL,
      "locale" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "sourceText" TEXT NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'auto',
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "MenuTranslation_pkey" PRIMARY KEY ("id")
    )`,
  },
  {
    label: 'UNIQUE INDEX (tenantId, entityType, entityId, field, locale)',
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS "MenuTranslation_tenantId_entityType_entityId_field_locale_key"
      ON "MenuTranslation"("tenantId", "entityType", "entityId", "field", "locale")`,
  },
  {
    label: 'INDEX (tenantId, locale)',
    sql: `CREATE INDEX IF NOT EXISTS "MenuTranslation_tenantId_locale_idx"
      ON "MenuTranslation"("tenantId", "locale")`,
  },
  {
    label: 'FK MenuTranslation.tenantId → Tenant.id',
    sql: `ALTER TABLE "MenuTranslation"
      ADD CONSTRAINT "MenuTranslation_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
];

async function runSafe(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (/already exists|duplicate|duplicate_object/i.test(msg)) {
      console.log(`= ${label} (ya estaba)`);
    } else {
      console.error(`✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

async function main() {
  console.log('Aplicando migration MenuTranslation (Fase 2 i18n menú)...\n');
  for (const { label, sql } of STATEMENTS) {
    await runSafe(label, sql);
  }
  // Verificación
  const count = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "MenuTranslation"`,
  );
  console.log(`\n✓ Tabla MenuTranslation lista. Rows actuales: ${count[0].n}`);
}

main()
  .catch(() => process.exit(1))
  .finally(async () => {
    await prisma.$disconnect();
  });
