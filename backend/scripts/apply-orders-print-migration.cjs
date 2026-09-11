// Aplica la migration 20260911_tenant_orders_print a prod sin downtime.
//
// Añade `Tenant.ordersPrintEnabled` APAGADO para todo el mundo y lo enciende
// solo en los dos negocios que Javier dejó con impresión (2026-09-11). La
// opción de imprimir salía en todos los negocios y no funcionaba; se quita de
// todos y se prueba en esos dos.
//
// Usage: railway run --service Postgres-Nq8w node scripts/apply-orders-print-migration.cjs
//        (añade --dry para ver qué haría sin tocar nada)
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260911_tenant_orders_print';
// Los únicos que conservan la impresión. Van por slug porque es lo que el
// usuario reconoce; el script avisa si alguno no existe en vez de callarse.
const CON_IMPRESION = ['demo-clubify', 'nudocowork'];

const DRY = process.argv.includes('--dry');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Tenant'
        AND column_name = 'ordersPrintEnabled'`,
  );
  const existe = cols.length > 0;

  if (!existe) {
    if (DRY) {
      console.log('[dry] crearía Tenant.ordersPrintEnabled BOOLEAN NOT NULL DEFAULT FALSE');
    } else {
      console.log('→ Creando ordersPrintEnabled…');
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ordersPrintEnabled" BOOLEAN NOT NULL DEFAULT FALSE`,
      );
      console.log('✓ ordersPrintEnabled listo');
    }
  } else {
    console.log('✓ ordersPrintEnabled ya existe — skip');
  }

  // Encender los dos. Se hace SIEMPRE (aunque la columna ya existiera) para
  // que reejecutar el script deje el estado que se quiere, no a medias.
  const encontrados = await prisma.$queryRawUnsafe(
    `SELECT slug, "brandName" FROM "Tenant" WHERE slug = ANY($1::text[])`,
    CON_IMPRESION,
  );
  for (const slug of CON_IMPRESION) {
    const t = encontrados.find((f) => f.slug === slug);
    if (!t) {
      console.warn(`⚠ No existe ningún negocio con slug «${slug}» — NO se encendió nada`);
      continue;
    }
    if (DRY) {
      console.log(`[dry] encendería impresión en ${t.brandName} (${slug})`);
      continue;
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "Tenant" SET "ordersPrintEnabled" = TRUE WHERE slug = $1`,
      slug,
    );
    console.log(`✓ Impresión encendida en ${t.brandName} (${slug})`);
  }

  if (!DRY) {
    const resumen = await prisma.$queryRawUnsafe(
      `SELECT count(*) FILTER (WHERE "ordersPrintEnabled") AS con,
              count(*) AS total
         FROM "Tenant"`,
    );
    console.log(
      `\nNegocios con impresión: ${resumen[0].con} de ${resumen[0].total}`,
    );
  }

  const yaMarcada = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`,
    MIGRATION_NAME,
  );
  if (yaMarcada.length > 0) {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada — skip`);
  } else if (!DRY) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-' || extract(epoch from now())::text, NOW(), $1, NULL, NULL, NOW(), 1)`,
      MIGRATION_NAME,
    );
    console.log(`✓ Migration ${MIGRATION_NAME} marcada`);
  }

  await prisma.$disconnect();
  console.log(DRY ? '\n(dry run: no se tocó nada)' : '\n✅ Listo.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
