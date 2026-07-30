// Backfill: tenants con whiteLabelId NULL → ID explícito de Clubify (PDF 1254).
// Así el conteo por marca es consistente (los null se contaban distinto según
// la vista → Samuel 56 vs Javier 54). También reporta el duplicado de
// Veterinaria Moran para decidir si se borra el sobrante.
// Dry-run por defecto; APPLY=1 aplica el backfill (NO borra nada).
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.env.APPLY === '1';

  const clubify = await prisma.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
  if (!clubify) { console.log('Clubify WL no encontrado'); process.exit(1); }

  const nulls = await prisma.tenant.findMany({
    where: { whiteLabelId: null, deletedAt: null },
    select: { id: true, brandName: true, slug: true, status: true, email: true, createdAt: true,
      _count: { select: { customers: true, orders: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Tenants con whiteLabelId NULL: ${nulls.length}`);
  for (const t of nulls) {
    console.log(`  - ${t.brandName} | ${t.status} | slug=${t.slug} | ${t.email || '—'} | clientes=${t._count.customers} pedidos=${t._count.orders} | ${t.createdAt.toISOString().slice(0,10)} | ${t.id}`);
  }

  // Duplicados por nombre (ej. Veterinaria Moran)
  const byName = {};
  for (const t of nulls) { const k = t.brandName.trim().toLowerCase(); (byName[k] ??= []).push(t); }
  const dups = Object.entries(byName).filter(([, v]) => v.length > 1);
  if (dups.length) {
    console.log('\n⚠️ DUPLICADOS (mismo nombre):');
    dups.forEach(([n, v]) => {
      console.log(`  "${n}": ${v.length}×`);
      v.forEach((t) => console.log(`     ${t.status} | clientes=${t._count.customers} pedidos=${t._count.orders} | slug=${t.slug} | ${t.id}`));
    });
    console.log('  → El TRIAL vacío (0 clientes/pedidos) es candidato a borrar (requiere confirmación).');
  }

  if (APPLY) {
    const r = await prisma.tenant.updateMany({ where: { whiteLabelId: null, deletedAt: null }, data: { whiteLabelId: clubify.id } });
    console.log(`\n✅ Backfill aplicado: ${r.count} tenants NULL → Clubify (${clubify.id}). (NO se borró ningún duplicado.)`);
  } else {
    console.log('\nDRY-RUN. APPLY=1 para backfillear (no borra duplicados).');
  }
  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
