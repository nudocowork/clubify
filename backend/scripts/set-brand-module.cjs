// Enciende/apaga un WhiteLabelModule de una marca en prod (equivalente al
// toggle de /superadmin → Módulos, que requiere JWT PLATFORM_OWNER).
//
//   BRAND=sellea MODULE=REFERRALS ENABLED=0 \
//     railway run --service Postgres-Nq8w node scripts/set-brand-module.cjs
//
// BRAND: substring del slug o nombre de la marca (case-insensitive).
// MODULE: nombre exacto del módulo (REFERRALS, ORDERS, REVIEWS, ...).
// ENABLED: 1 = encender, 0 = apagar.
const { PrismaClient } = require('@prisma/client');

(async () => {
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

  const brand = (process.env.BRAND || '').trim();
  const moduleName = (process.env.MODULE || '').trim();
  const enabled = process.env.ENABLED === '1';
  if (!brand) { console.error('Falta BRAND'); process.exit(1); }
  if (!moduleName) { console.error('Falta MODULE'); process.exit(1); }

  const p = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const wl = await p.whiteLabel.findFirst({
    where: { OR: [
      { slug: { contains: brand, mode: 'insensitive' } },
      { name: { contains: brand, mode: 'insensitive' } },
    ] },
    select: { id: true, name: true, slug: true },
  });
  if (!wl) { console.error(`No se encontró marca que matchee "${brand}"`); process.exit(1); }

  const existing = await p.whiteLabelModule.findFirst({
    where: { whiteLabelId: wl.id, module: moduleName },
    select: { id: true, enabled: true },
  });

  if (existing) {
    await p.whiteLabelModule.update({ where: { id: existing.id }, data: { enabled } });
    console.log(`✅ ${wl.name} (${wl.slug}) · módulo ${moduleName}: ${existing.enabled} → ${enabled}`);
  } else {
    await p.whiteLabelModule.create({ data: { whiteLabelId: wl.id, module: moduleName, enabled } });
    console.log(`✅ ${wl.name} (${wl.slug}) · módulo ${moduleName} creado en enabled=${enabled}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
