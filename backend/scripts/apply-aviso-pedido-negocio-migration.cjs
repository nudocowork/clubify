/**
 * Añade el aviso de pedido nuevo al teléfono del negocio.
 *
 * SQL crudo y aditivo, no `prisma db push`: producción tiene índices únicos
 * parciales que Prisma no sabe expresar y un push los borra.
 *
 * Idempotente y APAGADO por defecto: cada aviso gasta saldo de Grow Business,
 * así que se enciende negocio por negocio, a quien lo pida.
 *
 *   railway run node scripts/apply-aviso-pedido-negocio-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PASOS = [
  [
    'Tenant.ownerOrderAlertsEnabled',
    `ALTER TABLE "Tenant"
       ADD COLUMN IF NOT EXISTS "ownerOrderAlertsEnabled" BOOLEAN NOT NULL DEFAULT false`,
  ],
  [
    'Tenant.ownerOrderAlertsPhone',
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ownerOrderAlertsPhone" TEXT`,
  ],
  [
    'Tenant.ownerOrderAlertsAccountId',
    `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "ownerOrderAlertsAccountId" TEXT`,
  ],
  [
    'clave foránea a la subcuenta',
    // `ON DELETE SET NULL`: si alguien borra la subcuenta, el negocio se queda
    // sin ella pero NO se borra el negocio. Envuelto porque `ADD CONSTRAINT`
    // no admite `IF NOT EXISTS`.
    `DO $$ BEGIN
       ALTER TABLE "Tenant"
         ADD CONSTRAINT "Tenant_ownerOrderAlertsAccountId_fkey"
         FOREIGN KEY ("ownerOrderAlertsAccountId")
         REFERENCES "GrowBusinessAccount"("id") ON DELETE SET NULL;
     EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  ],
  [
    'índice',
    `CREATE INDEX IF NOT EXISTS "Tenant_ownerOrderAlertsAccountId_idx"
       ON "Tenant"("ownerOrderAlertsAccountId")`,
  ],
];

(async () => {
  for (const [nombre, sql] of PASOS) {
    await p.$executeRawUnsafe(sql);
    console.log(`  ok · ${nombre}`);
  }

  const cols = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name='Tenant' AND column_name IN
        ('ownerOrderAlertsEnabled','ownerOrderAlertsPhone','ownerOrderAlertsAccountId')`,
  );
  if (cols[0].n !== 3) throw new Error(`esperaba 3 columnas, hay ${cols[0].n}`);

  const encendidos = await p.tenant.count({
    where: { ownerOrderAlertsEnabled: true },
  });
  console.log(`\nlisto · negocios con el aviso encendido: ${encendidos}`);
  await p.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
