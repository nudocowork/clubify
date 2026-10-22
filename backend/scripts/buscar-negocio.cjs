/**
 * Busca negocios por nombre, slug o correo y dice qué tienen (tarjetas,
 * clientes, pases, estado). Para ubicar rápido «el negocio X» cuando llega un
 * reporte sin más datos.
 *
 *   railway run --service backend --environment production node scripts/buscar-negocio.cjs altieri
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const q = process.argv.slice(2).join(' ').trim();
  if (!q) throw new Error('Uso: node scripts/buscar-negocio.cjs <texto>');
  const negocios = await prisma.tenant.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { brandName: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, name: true, brandName: true, slug: true, email: true, status: true,
      deletedAt: true, createdAt: true, country: true, locale: true,
      whiteLabel: { select: { name: true } },
      _count: { select: { customers: true, passes: true, cards: true, convenios: true, infoLinks: true } },
      conveniosEnabled: true,
      convenios: { select: { name: true, slug: true } },
      cards: { select: { id: true, name: true, type: true, isActive: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
    take: 10,
  });
  if (negocios.length === 0) { console.log('Sin resultados para', JSON.stringify(q)); return; }
  for (const n of negocios) {
    console.log(`\n${n.name} (${n.brandName ?? '—'})  slug=${n.slug}  estado=${n.status}${n.deletedAt ? ' RETIRADO' : ''}`);
    console.log(`  id=${n.id}  correo=${n.email}  marca=${n.whiteLabel?.name ?? 'Clubify'}  país=${n.country ?? '—'}  idioma=${n.locale ?? '—'}  creado=${n.createdAt.toISOString().slice(0, 10)}`);
    console.log(`  clientes=${n._count.customers}  pases=${n._count.passes}  tarjetas=${n._count.cards}  convenios=${n._count.convenios} (${n.conveniosEnabled ? 'habilitados' : 'apagados'})  infolinks=${n._count.infoLinks}`);
    for (const c of n.convenios) console.log(`    convenio ${c.slug}  «${c.name}»`);
    for (const c of n.cards) console.log(`    tarjeta ${c.id}  ${c.type}  ${c.isActive ? 'activa' : 'inactiva'}  «${c.name}»  ${c.createdAt.toISOString().slice(0, 10)}`);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
