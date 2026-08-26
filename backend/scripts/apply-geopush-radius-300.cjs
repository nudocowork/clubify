// Radio de geopush a 300 m (pedido 2026-08-26).
//   1. cambia el DEFAULT de AllyLocation.radiusMeters a 300
//   2. lleva a 300 las sedes que quedaron con el default viejo (150)
//
// Solo toca las que están en 150 —el default anterior—. Una sede con un radio
// puesto a mano (200, 500) se respeta: fue una decisión de alguien.
//
//   Ver:      node scripts/apply-geopush-radius-300.cjs
//   Aplicar:  APPLY=1 node scripts/apply-geopush-radius-300.cjs
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const estado = async () => {
  const def = await p.$queryRawUnsafe(
    `SELECT column_default FROM information_schema.columns
      WHERE table_name='AllyLocation' AND column_name='radiusMeters'`,
  );
  const en150 = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AllyLocation" WHERE "radiusMeters" = 150`);
  const en300 = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AllyLocation" WHERE "radiusMeters" = 300`);
  const otros = await p.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AllyLocation" WHERE "radiusMeters" NOT IN (150,300)`);
  return { default: def[0]?.column_default ?? '(sin tabla)', en150: en150[0].n, en300: en300[0].n, otrosRadios: otros[0].n };
};

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL || '';
  console.log('base destino:', (url.match(/@([^/:]+)/) || [])[1] || '?');
  console.log('ANTES  →', JSON.stringify(await estado()));

  if (process.env.APPLY !== '1') {
    console.log('\nDRY-RUN. Nada se escribió. Para aplicar: APPLY=1 node scripts/apply-geopush-radius-300.cjs');
    await p.$disconnect();
    return;
  }

  await p.$executeRawUnsafe(`ALTER TABLE "AllyLocation" ALTER COLUMN "radiusMeters" SET DEFAULT 300`);
  const n = await p.$executeRawUnsafe(`UPDATE "AllyLocation" SET "radiusMeters" = 300 WHERE "radiusMeters" = 150`);
  console.log(`sedes movidas de 150 a 300: ${n}`);

  const d = await estado();
  console.log('DESPUÉS →', JSON.stringify(d));
  const ok = String(d.default) === '300' && d.en150 === 0;
  console.log(ok ? '\n✓ Migración aplicada.' : '\n✗ Revisar.');
  await p.$disconnect();
  if (!ok) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
