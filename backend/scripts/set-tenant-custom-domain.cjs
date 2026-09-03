// Setea (o limpia) el dominio personalizado propio de un negocio en su
// Storefront. A partir de ahí, TODOS los links que el negocio comparte
// (infolink, QR, reservas) + el título de pestaña usan ese dominio, y el
// dominio SIRVE la vitrina (root → menú, /i/... → infolink). PDF 2026-07-25.
//
// ⚠️ Correr SOLO cuando el dominio YA esté agregado al proyecto de Vercel
//    (Settings → Domains) + DNS + SSL; si no, los links quedarían muertos.
//
//   SLUG=birria-leon DOMAIN=birrialeon.com \
//     railway run --service Postgres-Nq8w node scripts/set-tenant-custom-domain.cjs
//
//   # Para limpiarlo: DOMAIN='' (vacío)
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const slug = (process.env.SLUG || '').trim();
  if (!slug) { console.error('Falta SLUG=<slug del negocio>'); process.exit(1); }
  const domain = (process.env.DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase() || null;

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tenant = await prisma.tenant.findFirst({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!tenant) { console.error(`No existe tenant con slug="${slug}"`); process.exit(1); }

  // El customDomain es @unique global → verificar que no lo tenga otro negocio.
  if (domain) {
    const clash = await prisma.storefront.findFirst({
      where: { customDomain: domain, tenantId: { not: tenant.id } },
      select: { tenantId: true },
    });
    if (clash) {
      console.error(`El dominio ${domain} ya está en otro negocio (${clash.tenantId}).`);
      process.exit(1);
    }
  }

  const sf = await prisma.storefront.upsert({
    where: { tenantId: tenant.id },
    update: { customDomain: domain },
    create: { tenantId: tenant.id, customDomain: domain },
    select: { customDomain: true },
  });
  console.log(
    domain
      ? `✅ ${tenant.name} (${slug}) → customDomain = ${sf.customDomain}`
      : `✅ ${tenant.name} (${slug}) → customDomain limpiado (null)`,
  );
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
