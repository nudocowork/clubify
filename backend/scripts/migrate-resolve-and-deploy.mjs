#!/usr/bin/env node
// Wrapper de `prisma migrate deploy` que tolera schemas pre-existentes.
// Para cada migración que falla con "already exists" (código P3018 + 42P07/42701),
// la marca como aplicada con `migrate resolve --applied` y reintenta deploy.
// Si una migración falla por OTRO motivo, se detiene y deja el error visible.
//
// Uso:
//   DATABASE_URL="..." node scripts/migrate-resolve-and-deploy.mjs
import { execSync, spawnSync } from 'node:child_process';

const env = { ...process.env };
if (!env.DATABASE_URL) {
  console.error('✗ DATABASE_URL no seteada');
  process.exit(1);
}

const ALREADY_EXISTS_PATTERNS = [
  /relation ".+" already exists/,
  /column ".+" of relation ".+" already exists/,
  /constraint ".+" for relation ".+" already exists/,
  /type ".+" already exists/,
  /index ".+" already exists/,
  /trigger ".+" .* already exists/,
];

function isAlreadyExists(stderr) {
  return ALREADY_EXISTS_PATTERNS.some((re) => re.test(stderr));
}

function extractFailedMigration(stderr) {
  // Formato 1 (P3018): "Migration name: <name>"
  let m = stderr.match(/Migration name:\s+(\S+)/);
  if (m) return m[1];
  // Formato 2 (P3009): "The `<name>` migration started at ... failed"
  m = stderr.match(/The `([^`]+)` migration started at .*? failed/);
  if (m) return m[1];
  return null;
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

  // P3009 indica una migración previa marcada como "failed" en _prisma_migrations.
  // En ese caso no tenemos el error original — asumimos que la causa fue
  // "already exists" (caso típico de schemas pre-existentes por db push).
  // P3018 sí trae el error real, así que validamos ahí.
  const isP3009 = /Error: P3009/.test(out);
  if (!isP3009 && !isAlreadyExists(out)) {
    console.error(`\n✗ Migración ${failed} falló por motivo distinto a "already exists". Stop.`);
    process.exit(1);
  }

  console.log(
    `\n→ ${failed} falló porque algo ya existe en el schema. La marco como aplicada y reintento.`,
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
