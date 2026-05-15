#!/usr/bin/env node
/**
 * Marca como aplicadas las migrations que fueron ejecutadas manualmente
 * vía apply-pending-migrations.mjs. Sin esto, el container crashea al
 * arrancar porque Dockerfile corre `prisma migrate deploy` y las
 * migrations fallan con "already exists".
 *
 * Inserta directo en _prisma_migrations (la tabla de tracking de Prisma).
 *
 * Uso:
 *   railway run --service Postgres-Nq8w -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/mark-migrations-resolved.mjs'
 */

import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

const MIGRATIONS = [
  '20260520_category_cover_banner',
  '20260521_menu_layout_sections',
];

async function main() {
  // Asegurar que la tabla _prisma_migrations existe
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

  for (const name of MIGRATIONS) {
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM "_prisma_migrations" WHERE migration_name = $1`,
      name,
    );
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`= ${name} (ya marcada como aplicada)`);
      continue;
    }
    const id = crypto.randomUUID();
    const checksum = crypto.randomBytes(32).toString('hex'); // dummy
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, 1)`,
      id,
      checksum,
      name,
    );
    console.log(`✓ ${name} marcada como aplicada`);
  }
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
