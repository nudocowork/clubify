/**
 * Migración ADITIVA: `Tenant.sedeMenuEnabled` (interruptor del menú por sede).
 *
 * Apagado por defecto y a propósito: 25 de los 26 negocios con varias sedes
 * usan la MISMA carta en todas y no tienen por qué ver esa complejidad. Se
 * enciende negocio por negocio desde el panel de admin, igual que las cartas
 * por sede, las alianzas y el club.
 *
 * Uso:  railway run node scripts/apply-sede-menu-flag.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const antes = await p.$queryRawUnsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Tenant' AND column_name = 'sedeMenuEnabled'
  `);
  if (antes.length) {
    console.log('La columna "sedeMenuEnabled" ya existe. Nada que hacer.');
  } else {
    console.log('Agregando Tenant."sedeMenuEnabled" (BOOLEAN NOT NULL DEFAULT false)…');
    await p.$executeRawUnsafe(
      `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "sedeMenuEnabled" BOOLEAN NOT NULL DEFAULT false`,
    );
  }

  const [{ n: total }] = await p.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "Tenant"`);
  const [{ n: encendidos }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Tenant" WHERE "sedeMenuEnabled" = true`,
  );
  console.log(`\nNegocios: ${total} · con menú por sede encendido: ${encendidos}`);
  console.log(encendidos === 0 ? '  ✓ Nadie lo ve todavía, como debe ser.' : '  ⚠ Revisar quién lo tiene.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e.message);
  await p.$disconnect();
  process.exit(1);
});
