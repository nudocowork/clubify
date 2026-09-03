/**
 * Migración ADITIVA: Convenios (beneficios para empleados de empresas aliadas).
 *
 * Crea 5 enums, 6 tablas nuevas y 3 columnas en tablas existentes. No toca ni
 * un dato de lo que ya hay.
 *
 * ── Por qué está escrito a mano y no generado ──────────────────────────────
 *
 * `prisma migrate diff` contra producción genera 423 líneas que, además de lo
 * de Convenios, BORRAN cosas que existen en la base y no se pueden expresar en
 * el schema: constraints de FK, índices parciales, y entre ellos
 * `Pass_legacyQrTokens_idx` — el que hace que un QR ya instalado en la
 * billetera de un cliente nunca deje de escanear. También cuela cambios
 * ajenos, como poner un DEFAULT nuevo a `secondaryColor`, dentro de la misma
 * sentencia ALTER.
 *
 * Así que de ahí solo se copió el DDL de lo nuevo, verbatim, y se le pusieron
 * guardas. Ver la regla 1 de CLAUDE.md.
 *
 * Idempotente: se puede correr las veces que haga falta.
 *
 * Uso:  railway run node scripts/apply-convenios-migration.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

/** CREATE TYPE no admite IF NOT EXISTS: se comprueba en pg_type. */
const ENUMS = [
  [`ConvenioStatus`, `'ACTIVE', 'PAUSED', 'FINISHED'`],
  [`ConvenioVerificacion`, `'ABIERTO', 'CODIGO', 'LISTA'`],
  [`ConvenioBeneficio`, `'PERCENT_OFF', 'AMOUNT_OFF', 'FREEBIE', 'TWO_FOR_ONE', 'OTHER'`],
  [`ConvenioPeriodo`, `'SIEMPRE', 'DIA', 'SEMANA', 'MES', 'ANIO'`],
  [`ConvenioTarjetaStatus`, `'ACTIVE', 'BLOCKED'`],
];

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS "Convenio" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "verificacion" "ConvenioVerificacion" NOT NULL DEFAULT 'CODIGO',
    "codigo" TEXT,
    "status" "ConvenioStatus" NOT NULL DEFAULT 'ACTIVE',
    "endsAt" TIMESTAMP(3),
    "reportToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Convenio_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ConvenioSede" (
    "id" TEXT NOT NULL,
    "convenioId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    CONSTRAINT "ConvenioSede_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ConvenioCupon" (
    "id" TEXT NOT NULL,
    "convenioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tipo" "ConvenioBeneficio" NOT NULL DEFAULT 'PERCENT_OFF',
    "valor" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxPorPersona" INTEGER,
    "periodo" "ConvenioPeriodo" NOT NULL DEFAULT 'SIEMPRE',
    "maxTotal" INTEGER,
    "compraMinima" INTEGER,
    "topeDescuento" INTEGER,
    "endsAt" TIMESTAMP(3),
    "canjesCount" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConvenioCupon_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ConvenioTarjeta" (
    "id" TEXT NOT NULL,
    "convenioId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "passId" TEXT,
    "documento" TEXT,
    "status" "ConvenioTarjetaStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockedAt" TIMESTAMP(3),
    "blockedBy" TEXT,
    "origen" TEXT,
    "dataPolicyAcceptedAt" TIMESTAMP(3),
    "dataPolicyUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConvenioTarjeta_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ConvenioCanje" (
    "id" TEXT NOT NULL,
    "convenioId" TEXT NOT NULL,
    "cuponId" TEXT NOT NULL,
    "tarjetaId" TEXT NOT NULL,
    "locationId" TEXT,
    "operatorUserId" TEXT,
    "compraMonto" INTEGER,
    "descuentoMonto" INTEGER,
    "revertedAt" TIMESTAMP(3),
    "revertedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConvenioCanje_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "ConvenioListaBlanca" (
    "id" TEXT NOT NULL,
    "convenioId" TEXT NOT NULL,
    "documento" TEXT,
    "email" TEXT,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConvenioListaBlanca_pkey" PRIMARY KEY ("id")
  )`,
];

const COLUMNAS = [
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "conveniosEnabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "maxConvenios" INTEGER NOT NULL DEFAULT 3`,
  `ALTER TABLE "Card" ADD COLUMN IF NOT EXISTS "convenioId" TEXT`,
];

const INDICES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "Convenio_reportToken_key" ON "Convenio"("reportToken")`,
  `CREATE INDEX IF NOT EXISTS "Convenio_tenantId_status_idx" ON "Convenio"("tenantId", "status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Convenio_tenantId_slug_key" ON "Convenio"("tenantId", "slug")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioSede_locationId_idx" ON "ConvenioSede"("locationId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ConvenioSede_convenioId_locationId_key" ON "ConvenioSede"("convenioId", "locationId")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioCupon_convenioId_isActive_idx" ON "ConvenioCupon"("convenioId", "isActive")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ConvenioTarjeta_passId_key" ON "ConvenioTarjeta"("passId")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioTarjeta_convenioId_status_idx" ON "ConvenioTarjeta"("convenioId", "status")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ConvenioTarjeta_convenioId_customerId_key" ON "ConvenioTarjeta"("convenioId", "customerId")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioCanje_convenioId_createdAt_idx" ON "ConvenioCanje"("convenioId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioCanje_cuponId_tarjetaId_createdAt_idx" ON "ConvenioCanje"("cuponId", "tarjetaId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioCanje_locationId_createdAt_idx" ON "ConvenioCanje"("locationId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioListaBlanca_convenioId_documento_idx" ON "ConvenioListaBlanca"("convenioId", "documento")`,
  `CREATE INDEX IF NOT EXISTS "ConvenioListaBlanca_convenioId_email_idx" ON "ConvenioListaBlanca"("convenioId", "email")`,
  `CREATE INDEX IF NOT EXISTS "Card_convenioId_idx" ON "Card"("convenioId")`,
];

/** [tabla, nombre, definición]. ADD CONSTRAINT no admite IF NOT EXISTS. */
const FKS = [
  ['Convenio', 'Convenio_tenantId_fkey', `FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioSede', 'ConvenioSede_convenioId_fkey', `FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioSede', 'ConvenioSede_locationId_fkey', `FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioCupon', 'ConvenioCupon_convenioId_fkey', `FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioTarjeta', 'ConvenioTarjeta_convenioId_fkey', `FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioTarjeta', 'ConvenioTarjeta_customerId_fkey', `FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioCanje', 'ConvenioCanje_convenioId_fkey', `FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioCanje', 'ConvenioCanje_cuponId_fkey', `FOREIGN KEY ("cuponId") REFERENCES "ConvenioCupon"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioCanje', 'ConvenioCanje_tarjetaId_fkey', `FOREIGN KEY ("tarjetaId") REFERENCES "ConvenioTarjeta"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['ConvenioCanje', 'ConvenioCanje_locationId_fkey', `FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  ['ConvenioListaBlanca', 'ConvenioListaBlanca_convenioId_fkey', `FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
  ['Card', 'Card_convenioId_fkey', `FOREIGN KEY ("convenioId") REFERENCES "Convenio"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
];

(async () => {
  let creados = 0;

  for (const [nombre, valores] of ENUMS) {
    const existe = await p.$queryRawUnsafe(
      `SELECT 1 FROM pg_type WHERE typname = $1`,
      nombre,
    );
    if (existe.length) continue;
    await p.$executeRawUnsafe(`CREATE TYPE "${nombre}" AS ENUM (${valores})`);
    console.log(`  enum ${nombre}`);
    creados++;
  }

  for (const sql of TABLAS) {
    await p.$executeRawUnsafe(sql);
  }
  console.log(`  ${TABLAS.length} tablas aseguradas`);

  for (const sql of COLUMNAS) {
    await p.$executeRawUnsafe(sql);
  }
  console.log(`  ${COLUMNAS.length} columnas aseguradas`);

  for (const sql of INDICES) {
    await p.$executeRawUnsafe(sql);
  }
  console.log(`  ${INDICES.length} índices asegurados`);

  for (const [tabla, nombre, def] of FKS) {
    const existe = await p.$queryRawUnsafe(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      nombre,
    );
    if (existe.length) continue;
    await p.$executeRawUnsafe(
      `ALTER TABLE "${tabla}" ADD CONSTRAINT "${nombre}" ${def}`,
    );
    console.log(`  FK ${nombre}`);
    creados++;
  }

  const tablas = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name LIKE 'Convenio%' ORDER BY table_name
  `);
  console.log(
    `\nListo. Tablas de convenios en la base: ${tablas.map((t) => t.table_name).join(', ')}`,
  );
  console.log(
    'Ningún negocio tiene convenios habilitados todavía ' +
      '(conveniosEnabled arranca en false para todos).',
  );

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
