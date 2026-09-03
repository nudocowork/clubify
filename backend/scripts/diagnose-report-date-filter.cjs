/* READ-ONLY. Replica el filtro por fecha de registro del "Reporte por empresa"
 * para jun 15-30 2026 (Bogotá) y verifica el createdAt de negocios de la captura. */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const d = (x) => (x ? new Date(x).toISOString() : '—');
const bogotaDayStartMs = (ymd) => new Date(`${ymd}T05:00:00.000Z`).getTime();

(async () => {
  const fromMs = bogotaDayStartMs('2026-06-15');
  const toMs = bogotaDayStartMs('2026-06-30') + 86_400_000; // inclusive del 30
  const all = await prisma.tenant.findMany({
    select: { brandName: true, createdAt: true, status: true },
  });
  const inRange = all.filter((t) => {
    const r = t.createdAt ? new Date(t.createdAt).getTime() : null;
    return r !== null && r >= fromMs && r < toMs;
  });
  console.log(`Total tenants: ${all.length}`);
  console.log(`En rango jun 15–30 (createdAt): ${inRange.length}`);
  console.log(`Fuera de rango: ${all.length - inRange.length}\n`);

  const captura = ['Arepas Sabrositas', 'Amor Espresso', 'Bahama', 'Burra Burger', 'Buza', 'SUGAR', 'Ponke', 'Trucco'];
  console.log('createdAt de negocios de la captura (¿deberían salir con filtro jun?):');
  for (const nm of captura) {
    const t = all.find((x) => (x.brandName || '').toLowerCase().includes(nm.toLowerCase()));
    if (!t) { console.log(`  · ${nm}: (no encontrado)`); continue; }
    const r = new Date(t.createdAt).getTime();
    const dentro = r >= fromMs && r < toMs;
    console.log(`  · ${t.brandName}: createdAt=${d(t.createdAt)} → ${dentro ? 'DENTRO jun15-30 ✓' : 'FUERA ✗ (no debería salir)'}`);
  }
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
