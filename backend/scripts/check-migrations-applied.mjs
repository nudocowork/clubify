#!/usr/bin/env node
// Diagnóstico: lista las migraciones aplicadas en la DB vs las que existen en
// disco, para detectar si el deploy reciente asume migraciones que no corrieron.
import { PrismaClient } from '@prisma/client';
import { readdirSync } from 'node:fs';
import { join } from 'node:url';
const prisma = new PrismaClient();
try {
  const dbRows = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    ORDER BY started_at DESC
    LIMIT 30
  `;
  const dbApplied = new Set(
    dbRows
      .filter((r) => r.finished_at && !r.rolled_back_at)
      .map((r) => r.migration_name),
  );
  const diskMigrations = readdirSync(
    new URL('../prisma/migrations', import.meta.url),
  ).filter((n) => /^\d{8}/.test(n)).sort();
  console.log(`En disco: ${diskMigrations.length} migraciones`);
  console.log(`Aplicadas en DB: ${dbApplied.size} migraciones`);
  console.log();
  const missing = diskMigrations.filter((n) => !dbApplied.has(n));
  if (missing.length === 0) {
    console.log('✓ Todas las migraciones de disco están aplicadas en DB');
  } else {
    console.log(`✗ ${missing.length} migración(es) PENDIENTES de aplicar:`);
    for (const m of missing) console.log(`  - ${m}`);
  }
  console.log();
  console.log('Últimas 10 migraciones en DB:');
  for (const r of dbRows.slice(0, 10)) {
    const status = r.rolled_back_at
      ? '⚠️  ROLLED BACK'
      : r.finished_at
        ? '✓ ok'
        : '⏳ in progress';
    console.log(`  ${status}  ${r.migration_name}`);
  }
} catch (e) {
  console.error('✗', e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
