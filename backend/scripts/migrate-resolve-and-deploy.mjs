#!/usr/bin/env node
// Wrapper de `prisma migrate deploy` que tolera schemas pre-existentes.
//
// Estrategia (corregida tras incidente del 2026-05-17 con
// `ordersDeliveryEnabled`):
//
// 1. Corre `prisma migrate deploy` normal.
// 2. Si falla por "already exists" (P3018):
//    a. Lee `prisma/migrations/<name>/migration.sql`.
//    b. Ejecuta cada statement individualmente vía $executeRawUnsafe.
//    c. Skip per-statement de errores "already exists".
//    d. Abort si cualquier statement falla por OTRO motivo.
//    e. Solo si TODOS los statements corrieron (o eran already exists),
//       marca la migration como aplicada en _prisma_migrations.
// 3. Si falla por P3009 (migration previa marcada failed sin error
//    visible): STOP. Antes asumíamos "already exists" y la marcábamos
//    aplicada — eso causó el bug del 2026-05-17 donde columnas nuevas
//    quedaron sin aplicar pero la migration estaba marcada applied.
//    Ahora pedimos intervención manual.
//
// Uso:
//   DATABASE_URL="..." node scripts/migrate-resolve-and-deploy.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const env = { ...process.env };
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL no seteada');
  process.exit(1);
}

const ALREADY_EXISTS_PATTERNS = [
  /relation ".+" already exists/i,
  /column ".+" of relation ".+" already exists/i,
  /constraint ".+" for relation ".+" already exists/i,
  /type ".+" already exists/i,
  /index ".+" already exists/i,
  /trigger ".+" .* already exists/i,
  /duplicate key value violates unique constraint/i,
];

function isAlreadyExists(stderr) {
  return ALREADY_EXISTS_PATTERNS.some((re) => re.test(stderr));
}

function extractFailedMigration(stderr) {
  // Formato P3018: "Migration name: <name>"
  let m = stderr.match(/Migration name:\s+(\S+)/);
  if (m) return m[1];
  // Formato P3009: "The `<name>` migration started at ... failed"
  m = stderr.match(/The `([^`]+)` migration started at .*? failed/);
  if (m) return m[1];
  return null;
}

/**
 * Divide un archivo SQL en statements individuales. Heurística simple:
 * split por `;` al final de línea (o EOF), luego strip de líneas
 * comentario (`-- ...`) dentro de cada chunk.
 *
 * NO soporta `;` dentro de strings ni DO $$ ... $$ blocks. Nuestras
 * migrations son CREATE/ALTER estándar, así que esto alcanza. Si en el
 * futuro alguien agrega un bloque DO, hay que escribir un parser real o
 * saltar este script.
 *
 * IMPORTANTE: las migrations de Prisma típicamente arrancan con un
 * comentario header (ej. "-- CreateTable") seguido del CREATE TABLE en
 * el MISMO chunk. NO podemos filtrar chunks completos por "empieza con
 * --" porque eso descartaba statements legítimos.
 */
function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);
}

function shortPreview(stmt) {
  return stmt.slice(0, 100).replace(/\s+/g, ' ');
}

/**
 * Aplica manualmente todos los statements de una migration, statement
 * por statement. Devuelve `true` si todos corrieron OK o fueron "already
 * exists"; `false` si alguno falló por otro motivo.
 *
 * Esto cubre el caso donde la migration tiene N statements y el primero
 * falla "already exists" — Prisma normalmente hace rollback de toda la
 * transacción y los statements N+1 quedan sin aplicar. Acá los corremos
 * fuera de transacción, individualmente.
 */
async function runMigrationManually(failed) {
  const sqlPath = join('prisma', 'migrations', failed, 'migration.sql');
  if (!existsSync(sqlPath)) {
    console.error(`✗ No encuentro ${sqlPath}`);
    return false;
  }
  const sql = readFileSync(sqlPath, 'utf8');
  const statements = splitStatements(sql);
  if (statements.length === 0) {
    console.log(`  (migration ${failed} no tiene statements ejecutables, OK)`);
    return true;
  }

  const prisma = new PrismaClient();
  try {
    for (const stmt of statements) {
      try {
        await prisma.$executeRawUnsafe(stmt);
        console.log(`  ✓ ${shortPreview(stmt)}`);
      } catch (e) {
        const msg = e?.message ?? String(e);
        if (isAlreadyExists(msg)) {
          console.log(`  = (already exists) ${shortPreview(stmt)}`);
        } else {
          console.error(`  ✗ ${shortPreview(stmt)}`);
          console.error(`    ${msg}`);
          return false;
        }
      }
    }
    return true;
  } finally {
    await prisma.$disconnect();
  }
}

let attempts = 0;
const MAX_ATTEMPTS = 50;

while (attempts++ < MAX_ATTEMPTS) {
  console.log(`\n[Intento ${attempts}] npx prisma migrate deploy...`);
  const r = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  process.stdout.write(out);

  if (r.status === 0) {
    console.log('\n✓ Todas las migraciones aplicadas correctamente.');
    process.exit(0);
  }

  const failed = extractFailedMigration(out);
  if (!failed) {
    console.error('\n✗ Falló sin nombre de migración identificable. Stop.');
    process.exit(1);
  }

  const isP3009 = /Error: P3009/.test(out);

  // P3009: migration ya estaba marcada failed en _prisma_migrations.
  // No tenemos el error real, así que NO podemos asumir nada. Antes
  // asumíamos "already exists" y eso causó el bug 2026-05-17. Ahora
  // requiere intervención manual del operador.
  if (isP3009) {
    console.error(
      `\n✗ Migración ${failed} está marcada como FAILED en _prisma_migrations (P3009).`,
    );
    console.error(
      '   No conocemos la causa original. NO se va a auto-resolver.',
    );
    console.error('   Pasos para resolver manualmente:');
    console.error(
      `     1. Inspeccionar prisma/migrations/${failed}/migration.sql`,
    );
    console.error('     2. Conectarse a la DB y verificar qué se aplicó');
    console.error(
      `     3. Si está completa: npx prisma migrate resolve --applied ${failed}`,
    );
    console.error(
      `     4. Si falta SQL: aplicar manualmente y luego marcar applied`,
    );
    process.exit(1);
  }

  if (!isAlreadyExists(out)) {
    console.error(
      `\n✗ Migración ${failed} falló por motivo distinto a "already exists". Stop.`,
    );
    process.exit(1);
  }

  console.log(
    `\n→ ${failed} chocó con "already exists". Aplicando statements manualmente para detectar si faltan piezas...`,
  );
  const allRan = await runMigrationManually(failed);
  if (!allRan) {
    console.error(
      `\n✗ Aplicación manual de ${failed} falló. NO se marca como aplicada. Stop.`,
    );
    process.exit(1);
  }

  console.log(
    `\n→ Todos los statements de ${failed} están aplicados. Marco como applied.`,
  );
  const resolve = spawnSync(
    'npx',
    ['prisma', 'migrate', 'resolve', '--applied', failed],
    { env, encoding: 'utf8', stdio: 'inherit' },
  );
  if (resolve.status !== 0) {
    console.error(`✗ migrate resolve --applied ${failed} falló. Stop.`);
    process.exit(1);
  }
}

console.error(`\n✗ Excedido el máximo de ${MAX_ATTEMPTS} intentos. Stop.`);
process.exit(1);
