/**
 * Clientes cuyo teléfono quedó con el indicativo del país DOS veces
 * («+50750766793699» = +507 + 507 66793699): el cliente escribió o autocompletó
 * el número con el indicativo y el formulario se lo volvió a poner. Con ese
 * teléfono no lo encuentra la búsqueda por número, no vuelve a su tarjeta
 * desde el enlace de alianza y ningún SMS/WhatsApp le llega.
 *
 * Simula sin --aplicar. Solo corrige cuando el número corregido no lo tiene
 * ya otro cliente del negocio (índice único por teléfono).
 *
 *   railway run --service backend --environment production node scripts/corregir-indicativo-repetido.cjs <slug> [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const INDICATIVO = { CO: '57', MX: '52', AR: '54', CL: '56', PE: '51', EC: '593', VE: '58', BO: '591', PY: '595', UY: '598', CR: '506', PA: '507', GT: '502', HN: '504', SV: '503', NI: '505', BZ: '501', DO: '1', ES: '34', US: '1', BR: '55', PT: '351', IT: '39' };

async function main() {
  const slug = process.argv[2];
  const aplicar = process.argv.includes('--aplicar');
  if (!slug) throw new Error('Uso: node scripts/corregir-indicativo-repetido.cjs <slug> [--aplicar]');
  const t = await prisma.tenant.findFirst({ where: { slug }, select: { id: true, name: true, country: true } });
  if (!t) throw new Error('No existe el negocio ' + slug);
  const ind = INDICATIVO[(t.country || '').toUpperCase()];
  if (!ind) throw new Error(`Sin indicativo conocido para el país ${t.country}`);
  const clientes = await prisma.customer.findMany({
    where: { tenantId: t.id, phone: { startsWith: `+${ind}${ind}` } },
    select: { id: true, fullName: true, phone: true },
  });
  console.log(`${t.name} (+${ind}): ${clientes.length} teléfono(s) con el indicativo repetido${aplicar ? '' : ' — SIMULACIÓN'}`);
  for (const c of clientes) {
    const digitos = c.phone.replace(/\D/g, '');
    const resto = digitos.slice(ind.length * 2);
    // Un número nacional tiene 7–10 dígitos; si no cuadra, no se toca.
    if (resto.length < 7 || resto.length > 10) { console.log(`  ? ${c.phone}  ${c.fullName}: largo raro, no se toca`); continue; }
    const nuevo = `+${ind}${resto}`;
    const choque = await prisma.customer.findFirst({ where: { tenantId: t.id, phone: nuevo, NOT: { id: c.id } }, select: { fullName: true } });
    if (choque) { console.log(`  ! ${c.phone} → ${nuevo}  ${c.fullName}: ya lo tiene ${choque.fullName}, no se toca`); continue; }
    console.log(`  ${aplicar ? '✓' : '·'} ${c.phone} → ${nuevo}  ${c.fullName}`);
    if (aplicar) await prisma.customer.update({ where: { id: c.id }, data: { phone: nuevo } });
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
