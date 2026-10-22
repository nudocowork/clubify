/**
 * Cómo quedaron grabados los teléfonos de los clientes de un negocio: por
 * prefijo, con rarezas (sin «+», prefijo repetido, muy cortos) y los últimos
 * altas. Para investigar «el formulario borra el número» sin pedirle capturas
 * al cliente.
 *
 *   railway run --service backend --environment production node scripts/diag-telefonos-negocio.cjs <slug>
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('Uso: node scripts/diag-telefonos-negocio.cjs <slug>');
  const t = await prisma.tenant.findFirst({ where: { slug }, select: { id: true, name: true, country: true } });
  if (!t) throw new Error('No existe el negocio ' + slug);
  const clientes = await prisma.customer.findMany({
    where: { tenantId: t.id },
    select: { fullName: true, phone: true, email: true, createdAt: true, _count: { select: { passes: true, stamps: true } } },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`${t.name} (país ${t.country ?? '—'}): ${clientes.length} clientes`);
  const porPrefijo = new Map();
  const raros = [];
  for (const c of clientes) {
    const p = c.phone ?? '';
    const m = p.match(/^\+(\d{1,3})/);
    const pref = !p ? '(sin teléfono)' : m ? '+' + (p.startsWith('+507') ? '507' : p.startsWith('+57') ? '57' : p.startsWith('+1') ? '1' : m[1]) : '(sin +)';
    porPrefijo.set(pref, (porPrefijo.get(pref) ?? 0) + 1);
    const digitos = p.replace(/\D/g, '');
    if (p && (!p.startsWith('+') || digitos.length < 9 || digitos.length > 14 || /^\+507\s*507/.test(p) || /^\+57\s*57/.test(p) || /\s/.test(p))) {
      raros.push(c);
    }
  }
  console.log('\nPor prefijo:');
  for (const [k, v] of [...porPrefijo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
  console.log(`\nRaros (${raros.length}): sin «+», largo anómalo, prefijo repetido o con espacios`);
  for (const c of raros.slice(0, 40)) console.log(`  ${c.createdAt.toISOString().slice(0, 16)}  ${JSON.stringify(c.phone)}  ${c.fullName}`);
  console.log('\nÚltimas 25 altas:');
  for (const c of clientes.slice(0, 25)) console.log(`  ${c.createdAt.toISOString().slice(0, 16)}  ${JSON.stringify(c.phone)}  ${c.fullName}  pases=${c._count.passes} sellos=${c._count.stamps}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
