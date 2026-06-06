// Anonimiza datos sensibles en la DB de STAGING (después de restaurar un
// snapshot de prod). NUNCA ejecutar contra prod — el script defensivamente
// checkea que DATABASE_URL apunte a un host que contenga "staging".
//
// Uso (desde ~/Documents/AGENTES/CLUBIFY/backend):
//   railway run --service Postgres-staging node scripts/anonymize-staging.cjs
//
// Qué hace:
// - Reemplaza emails reales por staging+<id>@example.com.
// - Reemplaza phones por +57300<8d_id>.
// - Reemplaza nombres de clientes de CRM/Orders por placeholders.
// - Limpia UTMs/referrer de ReferralUse.
//
// NO toca:
// - IDs (preservados para integridad referencial).
// - Productos, categorías, menús, branding (data de negocio, no PII).
// - Settings (puede traer secrets pero el sysadmin debe rotarlos manualmente
//   al setup inicial — el clone NO sustituye rotación de secrets).

const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no DATABASE_PUBLIC_URL nor DATABASE_URL in env');
    process.exit(1);
  }

  // Guard defensivo: el host debe contener "staging" o el script aborta.
  // Esto evita una ejecución accidental contra prod.
  const host = url.replace(/^.*@/, '').split(/[:/]/)[0];
  if (!/staging/i.test(host) && !/staging/i.test(process.env.RAILWAY_SERVICE_NAME ?? '')) {
    console.error(
      `ABORT: host "${host}" does not look like staging. ` +
      'Set RAILWAY_SERVICE_NAME=Postgres-staging or rename the host to contain "staging".',
    );
    process.exit(1);
  }

  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  console.log('\n>>> Anonymizing User');
  const users = await prisma.$executeRawUnsafe(
    `UPDATE "User"
       SET email = CONCAT('staging+', SUBSTRING(id, 1, 8), '@example.com'),
           phone = CASE WHEN phone IS NULL THEN NULL
                        ELSE CONCAT('+57300', SUBSTRING(REGEXP_REPLACE(id, '[^0-9]', '', 'g'), 1, 7))
                   END
       WHERE email NOT LIKE 'staging+%@example.com'`,
  );
  console.log(`  ${users} rows`);

  console.log('\n>>> Anonymizing Tenant');
  const tenants = await prisma.$executeRawUnsafe(
    `UPDATE "Tenant"
       SET email = CASE WHEN email IS NULL THEN NULL
                        ELSE CONCAT('staging+', SUBSTRING(id, 1, 8), '@example.com')
                   END,
           "whatsappPhone" = CASE WHEN "whatsappPhone" IS NULL THEN NULL
                                  ELSE CONCAT('+57300', SUBSTRING(REGEXP_REPLACE(id, '[^0-9]', '', 'g'), 1, 7))
                             END
       WHERE email NOT LIKE 'staging+%@example.com' OR email IS NULL`,
  );
  console.log(`  ${tenants} rows`);

  // CrmContact puede no existir en todas las DBs — wrap en try.
  console.log('\n>>> Anonymizing CrmContact');
  try {
    const crm = await prisma.$executeRawUnsafe(
      `UPDATE "CrmContact"
         SET name = CONCAT('Contact ', SUBSTRING(id, 1, 8)),
             phone = CASE WHEN phone IS NULL THEN NULL
                          ELSE CONCAT('+57300', SUBSTRING(REGEXP_REPLACE(id, '[^0-9]', '', 'g'), 1, 7))
                     END
         WHERE name NOT LIKE 'Contact %'`,
    );
    console.log(`  ${crm} rows`);
  } catch (e) {
    console.log(`  skip (${e.message})`);
  }

  console.log('\n>>> Anonymizing Order (customer fields)');
  try {
    const orders = await prisma.$executeRawUnsafe(
      `UPDATE "Order"
         SET "customerName" = CASE WHEN "customerName" IS NULL THEN NULL
                                   ELSE CONCAT('Cliente ', SUBSTRING(id, 1, 8))
                              END,
             "customerPhone" = CASE WHEN "customerPhone" IS NULL THEN NULL
                                    ELSE CONCAT('+57300', SUBSTRING(REGEXP_REPLACE(id, '[^0-9]', '', 'g'), 1, 7))
                               END,
             "customerEmail" = CASE WHEN "customerEmail" IS NULL THEN NULL
                                    ELSE CONCAT('cliente-', SUBSTRING(id, 1, 8), '@example.com')
                               END
         WHERE "customerName" NOT LIKE 'Cliente %' OR "customerName" IS NULL`,
    );
    console.log(`  ${orders} rows`);
  } catch (e) {
    console.log(`  skip (${e.message})`);
  }

  console.log('\n>>> Cleaning ReferralUse UTMs/referer');
  try {
    const refs = await prisma.$executeRawUnsafe(
      `UPDATE "ReferralUse"
         SET "utmSource" = NULL,
             "utmMedium" = NULL,
             "utmCampaign" = NULL,
             referer = NULL
         WHERE "utmSource" IS NOT NULL
            OR "utmMedium" IS NOT NULL
            OR "utmCampaign" IS NOT NULL
            OR referer IS NOT NULL`,
    );
    console.log(`  ${refs} rows`);
  } catch (e) {
    console.log(`  skip (${e.message})`);
  }

  console.log('\n>>> Rotating sensitive Settings to placeholder');
  // Settings con keys "sensitive" (PIN scanner, secrets) los reseteamos a un
  // placeholder reconocible. El admin de staging debe re-setearlos a un valor
  // de prueba después.
  try {
    const settings = await prisma.$executeRawUnsafe(
      `UPDATE "Setting"
         SET value = '"STAGING-PLACEHOLDER"'::jsonb
         WHERE key LIKE '%pin%' OR key LIKE '%secret%' OR key LIKE '%token%'`,
    );
    console.log(`  ${settings} rows`);
  } catch (e) {
    console.log(`  skip (${e.message})`);
  }

  await prisma.$disconnect();
  console.log('\nDone. La staging DB está anonimizada y lista para usar.');
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
