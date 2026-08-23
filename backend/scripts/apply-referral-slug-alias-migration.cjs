/**
 * Migración ADITIVA: tabla `ReferralSlugAlias` — las rutas `/ref/<slug>` que
 * un afiliado tuvo antes siguen resolviendo.
 *
 * El slug es la ruta REAL del afiliado, no un redirector. Al cambiarla, la
 * anterior moría con 404 y se caía todo enlace ya compartido. Con esta tabla,
 * cambiar de ruta deja de romper nada.
 *
 * Aditiva e idempotente: `CREATE TABLE IF NOT EXISTS` + índices con
 * `IF NOT EXISTS`. No toca ninguna fila existente.
 * NUNCA usar `prisma db push` contra producción.
 *
 * Uso:  railway run node scripts/apply-referral-slug-alias-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const [{ n }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM information_schema.tables
     WHERE table_name = 'ReferralSlugAlias'`);
  if (n) {
    console.log('La tabla "ReferralSlugAlias" ya existe. Solo verifico índices…');
  } else {
    console.log('Creando "ReferralSlugAlias"…');
  }

  await p.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ReferralSlugAlias" (
      "id"             TEXT NOT NULL,
      "slug"           TEXT NOT NULL,
      "referralCodeId" TEXT NOT NULL,
      "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ReferralSlugAlias_pkey" PRIMARY KEY ("id")
    )`);

  await p.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "ReferralSlugAlias_slug_key"
      ON "ReferralSlugAlias"("slug")`);

  await p.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ReferralSlugAlias_referralCodeId_idx"
      ON "ReferralSlugAlias"("referralCodeId")`);

  // La FK va aparte: `ADD CONSTRAINT` no admite IF NOT EXISTS, así que se
  // comprueba antes. onDelete: Cascade — si el código se borra, sus alias no
  // deben quedar apuntando al vacío y bloqueando esa ruta para siempre.
  const [{ f }] = await p.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS f FROM information_schema.table_constraints
     WHERE constraint_name = 'ReferralSlugAlias_referralCodeId_fkey'`);
  if (!f) {
    await p.$executeRawUnsafe(`
      ALTER TABLE "ReferralSlugAlias"
        ADD CONSTRAINT "ReferralSlugAlias_referralCodeId_fkey"
        FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id")
        ON DELETE CASCADE ON UPDATE CASCADE`);
    console.log('  FK creada.');
  } else {
    console.log('  FK ya existía.');
  }

  const cols = await p.$queryRawUnsafe(`
    SELECT column_name, data_type FROM information_schema.columns
     WHERE table_name = 'ReferralSlugAlias' ORDER BY ordinal_position`);
  console.log('\nColumnas:');
  for (const c of cols) console.log(`  ${c.column_name.padEnd(16)} ${c.data_type}`);

  const [{ a }] = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS a FROM "ReferralSlugAlias"`,
  );
  console.log(`\nAlias registrados: ${a}`);
  console.log('Listo. Nada más de la base fue tocado.');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  await p.$disconnect();
  process.exit(1);
});
