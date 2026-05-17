#!/usr/bin/env node
/**
 * Fix manual: agregar Storefront.ordersDeliveryEnabled.
 *
 * La migration 20260602_storefront_orders_per_mode quedó marcada como
 * "applied" en _prisma_migrations pero el SQL nunca se ejecutó (bug
 * del wrapper migrate-resolve-and-deploy.mjs que auto-marca migrations
 * como aplicadas cuando ve "already exists"). Resultado: el container
 * en prod tira `column does not exist` en cada request al storefront.
 *
 * Este script es idempotente (IF NOT EXISTS) y seguro.
 *
 * Uso:
 *   railway run --service Postgres-Nq8w -- bash -c \
 *     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/fix-storefront-orders-delivery-column.mjs'
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  console.log('→ Aplicando ALTER TABLE Storefront ADD COLUMN ordersDeliveryEnabled...');
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "Storefront" ADD COLUMN IF NOT EXISTS "ordersDeliveryEnabled" BOOLEAN NOT NULL DEFAULT true`,
  );
  console.log('✓ Column agregada (o ya existía).');

  // Verificación: confirmar que la column ahora existe
  const rows = await prisma.$queryRawUnsafe(
    `SELECT column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_name = 'Storefront' AND column_name = 'ordersDeliveryEnabled'`,
  );
  if (Array.isArray(rows) && rows.length > 0) {
    console.log('✓ Verificación OK:', rows[0]);
  } else {
    console.error('✗ Verificación falló — la column no aparece en information_schema');
    process.exit(1);
  }
} catch (e) {
  console.error('✗ Error:', e?.message ?? e);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
