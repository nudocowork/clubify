#!/usr/bin/env node
/**
 * Aplica todas las migrations pendientes que el schema Prisma necesita
 * pero la prod DB no tiene. Históricamente la prod se creó con
 * `db push` y muchas columnas/enums quedaron desincronizadas.
 *
 * Cada ALTER se ejecuta con IF NOT EXISTS o try/catch de "already
 * exists" — el script es 100% idempotente.
 *
 * Uso:
 *   railway run --service Postgres -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/apply-pending-migrations.mjs'
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STATEMENTS = [
  // Fase 1: Category cover banner
  { label: 'Category.tagline', sql: `ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "tagline" TEXT` },
  { label: 'Category.coverConfig', sql: `ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "coverConfig" JSONB` },
  // Fase 4: MenuLayout enum + SECTIONS
  {
    label: 'MenuLayout enum',
    sql: `DO $$ BEGIN
      CREATE TYPE "MenuLayout" AS ENUM ('CLASSIC', 'GRID', 'CAROUSELS', 'CLEAN', 'COMPACT', 'CLUVI', 'SECTIONS');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  },
  { label: 'MenuLayout.SECTIONS', sql: `ALTER TYPE "MenuLayout" ADD VALUE IF NOT EXISTS 'SECTIONS'` },
  { label: 'Storefront.menuLayout', sql: `ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "menuLayout" "MenuLayout" NOT NULL DEFAULT 'CLASSIC'` },
  // Pendientes históricos detectados al correr otros scripts
  { label: 'Tenant.growBusinessSwitchNumber', sql: `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "growBusinessSwitchNumber" INTEGER` },
];

async function runSafe(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (/already exists|duplicate column|duplicate_object/i.test(msg)) {
      console.log(`= ${label} (ya estaba)`);
    } else {
      console.error(`✗ ${label}: ${msg}`);
      throw err;
    }
  }
}

async function main() {
  console.log('Aplicando migrations pendientes...\n');
  for (const { label, sql } of STATEMENTS) {
    await runSafe(label, sql);
  }
  console.log('\n✓ Schema actualizado');
}

main()
  .catch(() => process.exit(1))
  .finally(async () => { await prisma.$disconnect(); });
