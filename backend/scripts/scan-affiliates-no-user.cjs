// SOLO LECTURA. Lista afiliados (INFLUENCER/AMBASSADOR/VENDOR/SOCIO) cuyo
// ReferralCode NO tiene ownerUserId → no pueden entrar al panel ("→ Panel").
// Marca si son arreglables (no existe user con ese email → crear+vincular) o si
// chocan (email ya es user no-afiliado → conflicto).
//   railway run --service Postgres-Nq8w node scripts/scan-affiliates-no-user.cjs
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const codes = await prisma.referralCode.findMany({
    where: { ownerUserId: null, role: { in: ['INFLUENCER', 'AMBASSADOR', 'VENDOR', 'SOCIO'] } },
    select: { id: true, code: true, role: true, ownerName: true, ownerEmail: true, isActive: true, whiteLabelId: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`\n=== Afiliados SIN ownerUserId (no pueden "→ Panel"): ${codes.length} ===\n`);
  let creatable = 0, conflict = 0, linkable = 0;
  for (const c of codes) {
    const email = (c.ownerEmail || '').toLowerCase();
    const u = email ? await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, isActive: true } }) : null;
    let verdict;
    if (!u) { verdict = 'CREAR+vincular (setear pass lo arregla)'; creatable++; }
    else if (String(u.role).startsWith('AFFILIATE_')) { verdict = `LINKEAR (ya es ${u.role}, solo falta ownerUserId=${u.id})`; linkable++; }
    else { verdict = `CONFLICTO (email ya es ${u.role} no-afiliado)`; conflict++; }
    console.log(`  [${c.role}] ${c.code}  ${c.ownerName}  <${c.ownerEmail}>  act=${c.isActive}  → ${verdict}`);
  }
  console.log(`\nRESUMEN: total=${codes.length}  creables=${creatable}  linkeables=${linkable}  conflicto=${conflict}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
