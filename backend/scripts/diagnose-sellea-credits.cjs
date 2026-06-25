// Diagnóstico del bug de créditos de Sellea: muestra el estado de la marca, sus
// negocios (status/creación/periodo) y TODAS las transacciones de crédito, para
// entender por qué activar N negocios solo descontó 1 (¿se crearon con créditos
// ilimitados? ¿se activaron por otra vía sin CreditTransaction?).
// Usage: railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/diagnose-sellea-credits.cjs
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const wl = await prisma.whiteLabel.findFirst({
    where: { slug: 'sellea' },
    select: {
      id: true, name: true, status: true,
      creditsAvailable: true, creditsCommitted: true, creditsUsed: true, creditsUnlimited: true,
      createdAt: true,
    },
  });
  if (!wl) { console.log('No existe la marca sellea.'); return; }

  console.log('═══════ MARCA ═══════');
  console.log(`${wl.name} · status=${wl.status} · unlimited=${wl.creditsUnlimited}`);
  console.log(`Créditos → disponibles=${wl.creditsAvailable} comprometidos=${wl.creditsCommitted} usados=${wl.creditsUsed}`);
  console.log(`Marca creada: ${wl.createdAt.toISOString()}`);

  const tenants = await prisma.tenant.findMany({
    where: { whiteLabelId: wl.id },
    select: { id: true, brandName: true, status: true, createdAt: true, currentPeriodEnd: true, hotmartSubscriberCode: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n═══════ NEGOCIOS (${tenants.length}) ═══════`);
  for (const t of tenants) {
    console.log(`• ${t.brandName} · ${t.status} · creado ${t.createdAt.toISOString().slice(0,10)} · periodo→${t.currentPeriodEnd ? t.currentPeriodEnd.toISOString().slice(0,10) : '—'} · code=${t.hotmartSubscriberCode ?? '—'}`);
  }

  const tx = await prisma.creditTransaction.findMany({
    where: { whiteLabelId: wl.id },
    select: { type: true, amount: true, note: true, createdAt: true, tenantId: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n═══════ TRANSACCIONES DE CRÉDITO (${tx.length}) ═══════`);
  for (const x of tx) {
    console.log(`• ${x.createdAt.toISOString().slice(0,16)} · ${x.type} · ${x.amount > 0 ? '+' : ''}${x.amount} · ${x.note ?? ''}`);
  }

  const activeNonUnlimited = tenants.filter((t) => t.status === 'ACTIVE');
  const consumes = tx.filter((x) => x.type === 'CONSUME').length;
  console.log(`\n═══════ DIAGNÓSTICO ═══════`);
  console.log(`Negocios ACTIVE: ${activeNonUnlimited.length} · Consumos (-1) registrados: ${consumes}`);
  if (!wl.creditsUnlimited && activeNonUnlimited.length > consumes) {
    console.log(`⚠️ Hay ${activeNonUnlimited.length - consumes} negocio(s) ACTIVE SIN consumo de crédito → se activaron cuando la marca era ilimitada o por una vía que no descuenta (simulador/billing-mode).`);
  } else {
    console.log('✅ Consumos coinciden con negocios activos.');
  }

  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
