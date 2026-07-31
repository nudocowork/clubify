// SOLO LECTURA. Diagnostica por qué dejó de llegar el SMS "🎉 Nueva compra
// Clubify" al fundador al pagar por Hotmart. Revisa: config de
// teléfonos, cuenta GrowBusiness (proveedor SMS) y actividad reciente de compras.
//   railway run --service Postgres-Nq8w node scripts/diagnose-nueva-compra-alert.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const mask = (s) => (s ? s.slice(0, 4) + '…(' + s.length + ')' : '(vacío)');

  console.log('=== SETTINGS relevantes ===');
  for (const k of ['prereg.alertPhones', 'prereg.alertAccountId', 'salesWhatsapp', 'salesEmail', 'referrals.notifyChannel']) {
    const row = await prisma.setting.findUnique({ where: { key: k } });
    console.log(`  ${k} = ${row ? JSON.stringify(row.value) : '(no seteado)'}`);
  }

  console.log('\n=== GrowBusinessAccounts (proveedor SMS) ===');
  const accts = await prisma.growBusinessAccount.findMany({
    select: { id: true, name: true, purpose: true, deletedAt: true, locationId: true, apiKey: true, switchNumber: true, isDefault: true, lastTestAt: true, lastTestOk: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  for (const a of accts) {
    console.log(`  [${a.purpose}] "${a.name}" id=${a.id.slice(0,8)} del=${a.deletedAt ? 'SÍ' : 'no'} loc=${a.locationId ? 'ok' : 'FALTA'} apiKey=${mask(a.apiKey)} switch=${a.switchNumber ?? '-'} default=${a.isDefault ? 'sí' : 'no'} lastTest=${a.lastTestAt ? a.lastTestAt.toISOString().slice(0,10) + '/' + (a.lastTestOk ? 'ok' : 'FAIL') : 'nunca'}`);
  }
  const general = accts.filter((a) => a.purpose === 'GENERAL' && !a.deletedAt);
  console.log(`  → GENERAL activas: ${general.length}  (resolveAccount usa la 1ra GENERAL, o cualquiera no-eliminada)`);

  console.log('\n=== Actividad reciente de compras (últimos 30 días) ===');
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentTenants = await prisma.tenant.count({ where: { createdAt: { gte: since } } });
  console.log(`  Tenants creados (proxy de compras NUEVAS): ${recentTenants}`);
  try {
    const pending = await prisma.pendingHotmartPayment.findMany({
      where: { createdAt: { gte: since } },
      select: { email: true, createdAt: true, consumedAt: true },
      orderBy: { createdAt: 'desc' }, take: 10,
    });
    console.log(`  PendingHotmartPayment recientes: ${pending.length}`);
    pending.forEach((p) => console.log(`    · ${p.createdAt.toISOString().slice(0,10)} ${p.email} consumed=${p.consumedAt ? 'sí' : 'NO'}`));
  } catch (e) { console.log('  (no se pudo leer PendingHotmartPayment:', e.message, ')'); }

  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
