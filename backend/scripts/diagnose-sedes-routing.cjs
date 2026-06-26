// Diagnóstico de SEDES POR ESTADO: lista tenants con sus Locations y verifica
// cuáles están listas para rutear pedidos (state + ordersWhatsappPhone).
// Read-only. Usage:
//   railway run --service Postgres-Nq8w node scripts/diagnose-sedes-routing.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL — corré con `railway run --service Postgres-Nq8w`');
    process.exit(1);
  }
  console.log('Connecting to:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  // Solo tenants que tienen al menos 1 Location.
  const locs = await prisma.location.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true, state: true, address: true,
      ordersWhatsappPhone: true, adminPhone: true, tenantId: true,
      tenant: {
        select: {
          brandName: true, slug: true,
          whatsappOrdersPhone: true, whatsappPhone: true, phone: true,
        },
      },
    },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });

  // Agrupar por tenant.
  const byTenant = new Map();
  for (const l of locs) {
    const arr = byTenant.get(l.tenantId) ?? [];
    arr.push(l);
    byTenant.set(l.tenantId, arr);
  }

  console.log(`\n=== ${byTenant.size} tenants con sedes activas ===`);

  let multiCount = 0, routableCount = 0;
  for (const [, arr] of byTenant) {
    const t = arr[0].tenant;
    const multi = arr.length >= 2;
    if (multi) multiCount++;
    const tag = multi ? '🛵 MULTI-SEDE' : '  (1 sede)';
    console.log(`\n${tag}  ${t.brandName}  (slug=${t.slug})  — ${arr.length} sede(s)`);
    console.log(`   fallback negocio: ordersPhone=${t.whatsappOrdersPhone ?? '—'}  whatsapp=${t.whatsappPhone ?? '—'}  phone=${t.phone ?? '—'}`);
    for (const l of arr) {
      // Número efectivo que se usaría para esta sede (misma cascada que generateWaMeOwner)
      const effective = l.ordersWhatsappPhone || l.adminPhone || t.whatsappOrdersPhone || t.whatsappPhone || t.phone || null;
      const hasState = !!(l.state && l.state.trim());
      const ready = multi && hasState && !!effective;
      if (ready) routableCount++;
      const flag = !multi ? '·' : hasState ? (effective ? '✅ rutea' : '⚠️ sin número') : '⚠️ SIN estado';
      console.log(`     ${flag}  "${l.name}"  estado=${l.state ?? '—'}  →  ${effective ?? '(ningún número!)'}`);
    }
  }

  console.log(`\n--- Resumen ---`);
  console.log(`Tenants con 2+ sedes (candidatos a ruteo): ${multiCount}`);
  console.log(`Sedes listas para rutear (multi + estado + número): ${routableCount}`);
  console.log(`\nNota: una sede solo rutea si su tenant tiene 2+ sedes Y la sede tiene 'estado' cargado.`);
  console.log(`El estado debe coincidir (lowercase/trim) con el 'departamento' que elige el cliente en checkout.`);

  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
