// Diagnóstico: ubica el/los negocio(s) "Burra Burguer" en TODA la base
// (todas las marcas + soft-deleted) para entender por qué no aparece en el
// panel de Negocios de Clubify (que solo muestra whiteLabelId=Clubify|null y
// deletedAt=null). Solo lectura.
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/diagnose-burra-burguer.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const terms = ['burra', 'burguer', 'burger'];
  const or = [];
  for (const t of terms) {
    or.push({ brandName: { contains: t, mode: 'insensitive' } });
    or.push({ slug: { contains: t, mode: 'insensitive' } });
  }

  const matches = await prisma.tenant.findMany({
    where: { OR: or },
    select: {
      id: true,
      brandName: true,
      slug: true,
      status: true,
      deletedAt: true,
      whiteLabelId: true,
      createdAt: true,
      whiteLabel: { select: { name: true, slug: true } },
      users: {
        select: { email: true, role: true },
        take: 3,
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const clubify = await prisma.whiteLabel.findFirst({
    where: { slug: 'clubify' },
    select: { id: true, name: true },
  });
  console.log(`Marca Clubify id = ${clubify?.id ?? '(no encontrada)'}\n`);

  if (matches.length === 0) {
    console.log('❌ NO se encontró ningún tenant que matchee burra/burguer/burger.');
    console.log('   → El negocio NO existe en esta base de datos (¿otro entorno/staging?).');
    await prisma.$disconnect();
    return;
  }

  console.log(`✅ ${matches.length} coincidencia(s):\n`);
  for (const m of matches) {
    const brand = m.whiteLabelId
      ? `${m.whiteLabel?.name ?? '?'} (${m.whiteLabel?.slug ?? '?'} / ${m.whiteLabelId})`
      : 'NULL (legacy/sin marca)';
    const visibleInClubify =
      (m.whiteLabelId === clubify?.id || m.whiteLabelId === null) && !m.deletedAt;
    console.log(`• ${m.brandName}  [/m/${m.slug}]`);
    console.log(`    id:        ${m.id}`);
    console.log(`    status:    ${m.status}`);
    console.log(`    deletedAt: ${m.deletedAt ? m.deletedAt.toISOString() + ' (SOFT-DELETED)' : 'null'}`);
    console.log(`    marca:     ${brand}`);
    console.log(`    creado:    ${m.createdAt.toISOString()}`);
    console.log(`    usuarios:  ${m.users.map((u) => `${u.email}(${u.role})`).join(', ') || '—'}`);
    console.log(`    ¿visible en panel Clubify?: ${visibleInClubify ? 'SÍ (debería verse)' : 'NO'}`);
    if (!visibleInClubify) {
      if (m.deletedAt) console.log(`      → CAUSA: está soft-deleted.`);
      else if (m.whiteLabelId && m.whiteLabelId !== clubify?.id)
        console.log(`      → CAUSA: pertenece a OTRA marca (${m.whiteLabel?.name}). El panel de Clubify no la muestra.`);
    }
    console.log('');
  }

  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
