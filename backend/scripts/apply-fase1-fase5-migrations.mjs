#!/usr/bin/env node
// Aplica las 2 migrations de la sesión 2026-05-14 (referidos v2 + RAG IA).
// Idempotente — usa IF NOT EXISTS en todas las DDL.
//
// Uso (railway run inyecta DATABASE_PUBLIC_URL → DATABASE_URL):
//   railway run --service Postgres-Nq8w -- bash -c \
//     'DATABASE_URL="$DATABASE_PUBLIC_URL" node scripts/apply-fase1-fase5-migrations.mjs'
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migrations = [
  {
    name: '20260522_referrals_slug_and_visits',
    file: resolve(__dirname, '../prisma/migrations/20260522_referrals_slug_and_visits/migration.sql'),
  },
  {
    name: '20260523_knowledge_docs_and_audience',
    file: resolve(__dirname, '../prisma/migrations/20260523_knowledge_docs_and_audience/migration.sql'),
  },
];

const prisma = new PrismaClient();

async function alreadyApplied(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL LIMIT 1`,
    name,
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function markApplied(name) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
     VALUES (gen_random_uuid()::text, $1, NOW(), $2, NOW(), 1)
     ON CONFLICT DO NOTHING`,
    `manual_${name}`,
    name,
  );
}

async function run() {
  for (const m of migrations) {
    const applied = await alreadyApplied(m.name);
    if (applied) {
      console.log(`✓ ya aplicada: ${m.name}`);
      continue;
    }

    const sql = readFileSync(m.file, 'utf8');
    console.log(`→ aplicando: ${m.name} (${sql.length} chars)`);

    // Partimos por `;` pero respetando $$ bloques (DO $$ ... $$).
    // En lugar de un parser sofisticado, mandamos el archivo entero
    // como una sola sentencia executeRawUnsafe — Prisma soporta multi-stmt.
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      // Si falla por sintaxis multi-stmt, separamos por bloques DO y por ;
      console.warn(`  multi-stmt directo falló (${e.message?.slice(0, 100)}…), separando por sentencias`);
      const stmts = splitSql(sql);
      for (let i = 0; i < stmts.length; i++) {
        const s = stmts[i].trim();
        if (!s) continue;
        try {
          await prisma.$executeRawUnsafe(s);
          process.stdout.write(`.`);
        } catch (e2) {
          console.error(`\n✗ stmt ${i + 1}/${stmts.length} falló: ${e2.message}`);
          console.error(`SQL: ${s.slice(0, 200)}…`);
          throw e2;
        }
      }
      console.log('');
    }

    await markApplied(m.name);
    console.log(`✓ ${m.name} aplicada y marcada en _prisma_migrations`);
  }
}

/** Divide SQL respetando bloques DO $$ … $$ y comentarios -- */
function splitSql(sql) {
  const out = [];
  let buf = '';
  let inDollar = false;
  const lines = sql.split('\n');
  for (const raw of lines) {
    const line = raw;
    // Comentarios sueltos no nos importan dentro del statement
    if (/\$\$/.test(line)) {
      // toggle por cada ocurrencia de $$ en la línea
      const matches = (line.match(/\$\$/g) || []).length;
      for (let i = 0; i < matches; i++) inDollar = !inDollar;
    }
    buf += line + '\n';
    if (!inDollar && line.trim().endsWith(';')) {
      out.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

run()
  .catch((e) => {
    console.error('✗ Falló:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
