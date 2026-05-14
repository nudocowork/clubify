#!/usr/bin/env node
// Aplica las migrations necesarias para que el backend funcione en prod
// con el nuevo Prisma client (Fase 1 + Fase 4 del rework menú secciones).
//
// Estado descubierto en prod:
//  - Category.tagline + coverConfig: YA aplicados (run anterior).
//  - MenuLayout enum: NO existe.
//  - Storefront.menuLayout column: NO existe.
//
// Las últimas 2 son fallas históricas — la prod corre con fallback
// CLASSIC porque t.storefront?.menuLayout es undefined siempre. Sin
// arreglar esto, mi Fase 4 redeploy crashea (Prisma client espera
// la columna).
//
// Uso:
//   railway run --service Postgres -- bash -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/apply-menu-sections-migrations.mjs'

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runSafe(sql, label) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (err) {
    const msg = err?.message ?? String(err);
    if (
      /already exists/i.test(msg) ||
      /duplicate column/i.test(msg) ||
      /column .+ of relation .+ already exists/i.test(msg) ||
      /duplicate_object/i.test(msg)
    ) {
      console.log(`= ${label} (ya estaba aplicada)`);
    } else {
      console.error(`✗ ${label} — error:`, msg);
      throw err;
    }
  }
}

async function main() {
  console.log('Aplicando migraciones menu sections...\n');

  // Fase 1: Category nuevas columnas (probablemente ya aplicadas)
  await runSafe(
    `ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "tagline" TEXT`,
    'Category.tagline',
  );
  await runSafe(
    `ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "coverConfig" JSONB`,
    'Category.coverConfig',
  );

  // Fase 4: Crear enum MenuLayout si no existe (con todos los valores)
  await runSafe(
    `DO $$ BEGIN
       CREATE TYPE "MenuLayout" AS ENUM (
         'CLASSIC', 'GRID', 'CAROUSELS', 'CLEAN', 'COMPACT', 'CLUVI', 'SECTIONS'
       );
     EXCEPTION
       WHEN duplicate_object THEN NULL;
     END $$;`,
    'MenuLayout enum creado',
  );

  // Si el enum ya existía sin SECTIONS, agregamos solo SECTIONS
  await runSafe(
    `ALTER TYPE "MenuLayout" ADD VALUE IF NOT EXISTS 'SECTIONS'`,
    'MenuLayout.SECTIONS (idempotente)',
  );

  // Fase 4: Agregar columna Storefront.menuLayout con default CLASSIC
  await runSafe(
    `ALTER TABLE "Storefront"
     ADD COLUMN IF NOT EXISTS "menuLayout" "MenuLayout" NOT NULL DEFAULT 'CLASSIC'`,
    'Storefront.menuLayout column',
  );

  console.log('\n✓ Schema actualizado. Backend ya puede redeployar sin crash.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
