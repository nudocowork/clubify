// Verificación SOLO-LECTURA de la base de contactos de email marketing:
//  · cobertura de phoneKey (contactos con teléfono deberían tener bucket)
//  · índice único parcial presente
//  · CERO duplicados por identidad (mismo phoneNorm o email activos en una marca)
// No modifica nada. Usage: railway run --service Postgres-Nq8w node scripts/verify-mkt-contacts.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const total = await prisma.mktContact.count();
  console.log(`Contactos totales: ${total}`);

  // Cobertura de phoneKey: con teléfono pero sin bucket = anomalía.
  const noKey = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "MktContact"
     WHERE "phone" IS NOT NULL AND length(regexp_replace("phone",'\\D','','g')) >= 7 AND "phoneKey" IS NULL`);
  console.log(`• Con teléfono pero sin phoneKey: ${noKey[0].n} ${noKey[0].n === 0 ? '✓' : '⚠️'}`);

  // Índices únicos parciales presentes.
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename='MktContact'`);
  const names = idx.map((r) => r.indexname);
  console.log(`• Índice único phoneNorm: ${names.includes('MktContact_wl_phoneNorm_uq') ? '✓' : 'FALTA ✗'}`);
  console.log(`• Índice único email:     ${names.includes('MktContact_wl_email_uq') ? '✓' : 'FALTA ✗'}`);

  // Duplicados activos por phoneNorm dentro de una marca.
  const dupPhone = await prisma.$queryRawUnsafe(
    `SELECT "whiteLabelId","phoneNorm",count(*)::int AS n FROM "MktContact"
     WHERE "phoneNorm" IS NOT NULL AND NOT "deleted"
     GROUP BY "whiteLabelId","phoneNorm" HAVING count(*) > 1`);
  console.log(`• Duplicados por phoneNorm: ${dupPhone.length} ${dupPhone.length === 0 ? '✓' : '⚠️'}`);

  // Duplicados activos por email dentro de una marca.
  const dupEmail = await prisma.$queryRawUnsafe(
    `SELECT "whiteLabelId",lower("email") AS e,count(*)::int AS n FROM "MktContact"
     WHERE "email" IS NOT NULL AND NOT "deleted"
     GROUP BY "whiteLabelId",lower("email") HAVING count(*) > 1`);
  console.log(`• Duplicados por email: ${dupEmail.length} ${dupEmail.length === 0 ? '✓' : '⚠️'}`);

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
