// READ-ONLY: por qué "monet" quedó sin afiliado. Mira su atribución, el código
// de Nicolas (TAFMPWK5) y el `src`/tracking REAL del payload Hotmart guardado.
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

  const t = await p.tenant.findFirst({
    where: { brandName: { contains: 'monet', mode: 'insensitive' } },
    select: {
      id: true, brandName: true, email: true, referredByCode: true,
      hotmartSubscriberCode: true, createdAt: true, purchasedAt: true,
      status: true, whiteLabelId: true,
      referralUses: { select: { status: true, viaSlug: true, utmSource: true, createdAt: true, referralCode: { select: { code: true, slug: true, role: true, ownerName: true, isActive: true } } } },
    },
  });
  if (!t) { console.log('No encontré tenant "monet".'); await p.$disconnect(); return; }
  console.log('\n════ TENANT monet ════');
  console.log(JSON.stringify({ ...t, referralUses: undefined }, null, 2));
  console.log('  referredByCode:', t.referredByCode ?? '(null)');
  console.log('  ReferralUses:', t.referralUses.length);
  t.referralUses.forEach((u) => console.log(`   - ${u.referralCode?.role} ${u.referralCode?.code} (${u.referralCode?.ownerName}) status=${u.status} via=${u.viaSlug ?? '—'} utm=${u.utmSource ?? '—'} activo=${u.referralCode?.isActive}`));

  const nico = await p.referralCode.findUnique({
    where: { code: 'TAFMPWK5' },
    select: { id: true, code: true, slug: true, role: true, ownerName: true, isActive: true },
  });
  console.log('\n════ Código Nicolas ════');
  console.log(' ', JSON.stringify(nico));

  // Payload Hotmart de monet: por email del tenant, y por búsqueda amplia.
  const track = (rp) => {
    const tk = rp?.data?.purchase?.tracking || {};
    return { source: tk.source, source_sck: tk.source_sck, sck: tk.sck, external_code: tk.external_code };
  };
  console.log('\n════ PendingHotmartPayment por email del tenant ════');
  const pend = await p.pendingHotmartPayment.findMany({ where: { email: t.email }, select: { email: true, rawPayload: true, createdAt: true } });
  if (!pend.length) console.log('  (ninguno por ese email)');
  pend.forEach((x) => console.log(`  ${x.createdAt.toISOString().slice(0,10)} ${x.email} · tracking=${JSON.stringify(track(x.rawPayload))}`));

  // Búsqueda amplia (últimos 20) por si el email del comprador difiere.
  console.log('\n════ PendingHotmartPayment recientes (match por nombre/email de monet) ════');
  const recent = await p.pendingHotmartPayment.findMany({ orderBy: { createdAt: 'desc' }, take: 40, select: { email: true, rawPayload: true, createdAt: true } });
  const monetHits = recent.filter((x) => {
    const s = JSON.stringify(x.rawPayload).toLowerCase();
    return s.includes('monet') || (t.email && s.includes(t.email.toLowerCase()));
  });
  if (!monetHits.length) console.log('  (ningún payload reciente menciona monet / su email)');
  monetHits.forEach((x) => {
    const b = x.rawPayload?.data?.buyer || {};
    console.log(`  ${x.createdAt.toISOString().slice(0,10)} buyer=${b.name}/${b.email} · tracking=${JSON.stringify(track(x.rawPayload))}`);
  });

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
