// READ-ONLY. Verifica el estado real de las correcciones de Sellea (PDF Modificaciones):
//   A (mapa)  → ¿WhiteLabel.mapsApiKey seteada? ¿appDomain/domain?
//   F (Stripe)→ ¿paymentGateway + paymentConfig con secretKey?
//   H (refer) → ¿módulo REFERRALS enabled?
//   J (admins)→ ¿existen Users admin de la marca? ¿los devolvería la lista?
//   railway run --service Postgres-Nq8w node scripts/verify-sellea-fixes.cjs
const { PrismaClient } = require('@prisma/client');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const wl = await p.whiteLabel.findFirst({
    where: { OR: [{ slug: { contains: 'sell', mode: 'insensitive' } }, { name: { contains: 'sell', mode: 'insensitive' } }] },
    select: { id: true, name: true, slug: true, domain: true, appDomain: true,
      mapsApiKey: true, paymentGateway: true, paymentConfig: true },
  });
  if (!wl) { console.log('No WL sellea'); process.exit(0); }

  console.log('════════ WhiteLabel Sellea ════════');
  console.log(`id=${wl.id} · slug=${wl.slug} · name=${wl.name}`);
  console.log(`\n── A (MAPA) ──`);
  console.log(`domain=${wl.domain || '—'} · appDomain=${wl.appDomain || '—'}`);
  console.log(`mapsApiKey: ${wl.mapsApiKey ? 'SETEADA ('+String(wl.mapsApiKey).slice(0,10)+'…)' : '❌ NO SETEADA → MapPicker cae a la key GLOBAL (necesita selleala.com en los referrers de esa key en Google Cloud)'}`);

  console.log(`\n── F (STRIPE) ──`);
  const pc = wl.paymentConfig || {};
  const pcKeys = Object.keys(pc);
  const stripeSecret = pc.secretKey || pc.stripeSecretKey || null;
  console.log(`paymentGateway=${wl.paymentGateway || '—'}`);
  console.log(`paymentConfig keys: [${pcKeys.join(', ') || 'vacío'}]`);
  console.log(`Stripe secretKey: ${stripeSecret ? 'SETEADA (cifrada)' : '❌ NO configurada'}`);

  console.log(`\n── H (REFERIDOS) ──`);
  const mods = await p.whiteLabelModule.findMany({ where: { whiteLabelId: wl.id }, select: { module: true, enabled: true }, orderBy: { module: 'asc' } });
  const refMod = mods.find((m) => m.module === 'REFERRALS');
  console.log(`Módulos: ${mods.map((m) => `${m.module}=${m.enabled ? 'on' : 'OFF'}`).join(' · ')}`);
  console.log(`REFERRALS: ${refMod ? (refMod.enabled ? '⚠️ ON (visible)' : '✅ OFF (oculto)') : '(sin fila)'}`);

  console.log(`\n── J (ADMINS DE MARCA) ──`);
  const tenants = await p.tenant.findMany({ where: { whiteLabelId: wl.id }, select: { id: true } });
  const tenantIds = tenants.map((t) => t.id);
  console.log(`Negocios de la marca: ${tenantIds.length}`);
  const admins = await p.user.findMany({
    where: { whiteLabelId: wl.id, role: { in: ['SUPER_ADMIN', 'MARKETING'] } },
    select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`Users admin de la marca (whiteLabelId=sellea, role SUPER_ADMIN/MARKETING): ${admins.length}`);
  for (const a of admins) {
    const wouldList = a.tenantId == null || tenantIds.includes(a.tenantId);
    console.log(`  ${wouldList ? '✅' : '❌'} ${a.email} · ${a.role} · tenantId=${a.tenantId || 'null'} · created ${day(a.createdAt)} ${wouldList ? '(aparece en lista)' : '(NO aparece)'}`);
  }
  if (!admins.length) console.log('  (ninguno — nunca se creó un admin de marca, o el intento falló antes de guardar)');

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
