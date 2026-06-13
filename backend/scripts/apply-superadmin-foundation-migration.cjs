// Aplica la migration 20260613_superadmin_foundation a prod.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-superadmin-foundation-migration.cjs
const { PrismaClient } = require('@prisma/client');

const MIGRATION_NAME = '20260613_superadmin_foundation';

async function tryExec(prisma, sql, label) {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`✓ ${label}`);
  } catch (e) {
    const msg = String(e.message || e);
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      console.log(`✓ ${label} (ya existía)`);
    } else {
      throw e;
    }
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // 1) Agregar PLATFORM_OWNER al enum Role
  const roleCheck = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pg_enum WHERE enumlabel='PLATFORM_OWNER' AND enumtypid = (SELECT oid FROM pg_type WHERE typname='Role')`,
  );
  if (roleCheck.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TYPE "Role" ADD VALUE 'PLATFORM_OWNER' BEFORE 'SUPER_ADMIN'`);
    console.log('✓ Role.PLATFORM_OWNER agregado');
  } else {
    console.log('✓ Role.PLATFORM_OWNER ya existe');
  }

  // 2) Enums nuevos
  for (const [name, vals] of [
    ['WhiteLabelStatus', ['ACTIVE', 'SUSPENDED']],
    ['ModuleKey', ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS']],
    ['CreditTransactionType', ['PURCHASE', 'CONSUME', 'COMMIT', 'REFUND', 'ADJUSTMENT']],
  ]) {
    const exists = await prisma.$queryRawUnsafe(`SELECT typname FROM pg_type WHERE typname=$1`, name);
    if (exists.length === 0) {
      const list = vals.map((v) => `'${v}'`).join(', ');
      await prisma.$executeRawUnsafe(`CREATE TYPE "${name}" AS ENUM (${list})`);
      console.log(`✓ Enum ${name} creado`);
    } else {
      console.log(`✓ Enum ${name} ya existe`);
    }
  }

  // 3) Tablas
  await tryExec(prisma, `CREATE TABLE "WhiteLabel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "appDomain" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#16a34a',
    "initial" TEXT,
    "adminEmail" TEXT,
    "status" "WhiteLabelStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditsAvailable" INTEGER NOT NULL DEFAULT 0,
    "creditsCommitted" INTEGER NOT NULL DEFAULT 0,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhiteLabel_pkey" PRIMARY KEY ("id")
  )`, 'Tabla WhiteLabel');
  await tryExec(prisma, `CREATE UNIQUE INDEX "WhiteLabel_slug_key" ON "WhiteLabel"("slug")`, 'Index WhiteLabel_slug_key');
  await tryExec(prisma, `CREATE INDEX "WhiteLabel_status_idx" ON "WhiteLabel"("status")`, 'Index WhiteLabel_status');

  await tryExec(prisma, `CREATE TABLE "WhiteLabelModule" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "module" "ModuleKey" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhiteLabelModule_pkey" PRIMARY KEY ("id")
  )`, 'Tabla WhiteLabelModule');
  await tryExec(prisma, `CREATE UNIQUE INDEX "WhiteLabelModule_whiteLabelId_module_key" ON "WhiteLabelModule"("whiteLabelId", "module")`, 'Index WhiteLabelModule unique');
  await tryExec(prisma, `CREATE INDEX "WhiteLabelModule_module_idx" ON "WhiteLabelModule"("module")`, 'Index WhiteLabelModule_module');
  await tryExec(prisma, `ALTER TABLE "WhiteLabelModule" ADD CONSTRAINT "WhiteLabelModule_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, 'FK WhiteLabelModule');

  await tryExec(prisma, `CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "whiteLabelId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
  )`, 'Tabla CreditTransaction');
  await tryExec(prisma, `CREATE INDEX "CreditTransaction_whiteLabelId_createdAt_idx" ON "CreditTransaction"("whiteLabelId", "createdAt")`, 'Index CreditTransaction');
  await tryExec(prisma, `ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE`, 'FK CreditTransaction');

  await tryExec(prisma, `CREATE TABLE "HotmartCreditLink" (
    "id" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "price" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HotmartCreditLink_pkey" PRIMARY KEY ("id")
  )`, 'Tabla HotmartCreditLink');
  await tryExec(prisma, `CREATE INDEX "HotmartCreditLink_isActive_position_idx" ON "HotmartCreditLink"("isActive", "position")`, 'Index HotmartCreditLink');

  await tryExec(prisma, `CREATE TABLE "PlatformIntegration" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformIntegration_pkey" PRIMARY KEY ("id")
  )`, 'Tabla PlatformIntegration');
  await tryExec(prisma, `CREATE UNIQUE INDEX "PlatformIntegration_key_key" ON "PlatformIntegration"("key")`, 'Index PlatformIntegration_key');

  // 4) Tenant.whiteLabelId
  const col = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Tenant' AND column_name='whiteLabelId'`,
  );
  if (col.length === 0) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD COLUMN "whiteLabelId" TEXT`);
    await prisma.$executeRawUnsafe(`CREATE INDEX "Tenant_whiteLabelId_idx" ON "Tenant"("whiteLabelId")`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_whiteLabelId_fkey" FOREIGN KEY ("whiteLabelId") REFERENCES "WhiteLabel"("id") ON DELETE SET NULL ON UPDATE CASCADE`);
    console.log('✓ Tenant.whiteLabelId creado');
  } else {
    console.log('✓ Tenant.whiteLabelId ya existe');
  }

  // 5) Seed: Clubify WhiteLabel + asignar todos los tenants existentes
  const clubifyExists = await prisma.$queryRawUnsafe(`SELECT id FROM "WhiteLabel" WHERE slug='clubify'`);
  if (clubifyExists.length === 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "WhiteLabel" ("id", "name", "slug", "domain", "appDomain", "primaryColor", "initial", "adminEmail", "status", "creditsAvailable", "creditsCommitted", "creditsUsed", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'Clubify', 'clubify', 'soyclubify.com', 'app.soyclubify.com', '#22c55e', 'C', 'jhonarias888@gmail.com', 'ACTIVE', 0, 0, 0, NOW(), NOW())
    `);
    console.log('✓ WhiteLabel "Clubify" creada');
  } else {
    console.log('✓ WhiteLabel "Clubify" ya existía');
  }

  // Asignar tenants existentes sin whiteLabel
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "Tenant" SET "whiteLabelId" = (SELECT "id" FROM "WhiteLabel" WHERE "slug" = 'clubify')
    WHERE "whiteLabelId" IS NULL
  `);
  console.log(`✓ Tenants asignados a Clubify: ${updated}`);

  // Módulos por defecto para Clubify
  for (const m of ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS']) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "WhiteLabelModule" ("id", "whiteLabelId", "module", "enabled", "updatedAt")
      SELECT gen_random_uuid()::text, "id", $1::"ModuleKey", true, NOW()
      FROM "WhiteLabel" WHERE "slug" = 'clubify'
      ON CONFLICT ("whiteLabelId", "module") DO NOTHING
    `, m);
  }
  console.log('✓ Módulos por defecto para Clubify');

  // 6) Marcar migration
  const exists = await prisma.$queryRawUnsafe(
    `SELECT id FROM _prisma_migrations WHERE migration_name = $1`, MIGRATION_NAME,
  );
  if (exists.length === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (gen_random_uuid()::text, 'manual-apply-' || extract(epoch from now())::text, NOW(), $1, NULL, NULL, NOW(), 1)`,
      MIGRATION_NAME,
    );
    console.log(`✓ Migration ${MIGRATION_NAME} marcada`);
  } else {
    console.log(`✓ Migration ${MIGRATION_NAME} ya marcada`);
  }

  await prisma.$disconnect();
  console.log('\n✅ Listo.');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
