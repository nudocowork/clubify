// OPCIÓN A: setea subscriptionPriceUsd = precio REAL pagado por cada empresa
// (planilla del dueño) y recalcula las comisiones PENDING/APPROVED a
// base_real × % (directa = % del code; indirecta = 5%). Además:
//  - Wok Explosivo: anula (REJECTED) la comisión DUPLICADA (deja 1 ciclo).
//  - Mykoz: el % ya es 10 en el code; el recálculo corrige el monto.
// Dry-run por defecto. APPLY=1 para aplicar. No toca PAID ni REJECTED.
const { PrismaClient } = require('@prisma/client');

// [substring del brandName, precio real]. Birria NO se toca (quedó en $278).
const PRICES = [
  ['Birria Leon', 250],
  ['Wok Explosivo', 50],
  ['Quipao', 50], // Bubble
  ['Café 1550', 135],
  ['Konys', 50],
  ['AutoTech', 50],
  ['BUENOS DIAZ', 150],
  ['Cocoa Beauty', 135],
  ['MYKOZ', 135],
  ['Hydor', 135],
  ['&N COFFEE', 135],
  ['burguesia', 150],
  ['Valmont', 150],
  ['Revent', 150],
  ['Dolce Vita', 150],
  ['Urban Café', 150],
];

const round2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const apply = process.env.APPLY === '1';
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.log(apply ? '*** APPLY ***\n' : '*** DRY-RUN (APPLY=1 para aplicar) ***\n');

  const indRow = await prisma.setting.findUnique({ where: { key: 'referrals.indirectPercent' } });
  const indirectPct = indRow?.value ? Number(indRow.value) : 5;

  for (const [needle, price] of PRICES) {
    const tenants = await prisma.tenant.findMany({
      where: { brandName: { contains: needle, mode: 'insensitive' } },
      select: { id: true, brandName: true, planPeriodicity: true, subscriptionPriceUsd: true },
    });
    if (tenants.length === 0) { console.log(`✗ "${needle}": NO encontrado\n`); continue; }
    if (tenants.length > 1) { console.log(`⚠ "${needle}": ${tenants.length} matches (${tenants.map(t=>t.brandName).join(', ')}) — skip`); continue; }
    const t = tenants[0];
    console.log(`████ ${t.brandName} | ${t.planPeriodicity} | precioReal: ${t.subscriptionPriceUsd ?? '—'} → $${price}`);

    if (apply) {
      await prisma.tenant.update({ where: { id: t.id }, data: { subscriptionPriceUsd: price } });
    }

    const comms = await prisma.commission.findMany({
      where: { status: { in: ['PENDING', 'APPROVED'] }, referralUse: { tenantId: t.id } },
      select: {
        id: true, amount: true, createdAt: true, periodKey: true, recipientCodeId: true,
        referralUse: { select: { referralCodeId: true } },
        recipientCode: { select: { code: true, ownerName: true, role: true, commissionPercent: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Wok: anular la duplicada (la más vieja). Deja solo la más reciente.
    let dupIds = [];
    if (/wok/i.test(t.brandName) && comms.length > 1) {
      dupIds = comms.slice(0, comms.length - 1).map((c) => c.id);
    }

    for (const c of comms) {
      if (dupIds.includes(c.id)) {
        console.log(`   ANULAR (dup): $${Number(c.amount).toFixed(2)} ${c.recipientCode?.ownerName} pk=${c.periodKey}`);
        if (apply) await prisma.commission.update({ where: { id: c.id }, data: { status: 'REJECTED' } });
        continue;
      }
      const isDirect = c.recipientCodeId === c.referralUse?.referralCodeId;
      const pct = isDirect ? Number(c.recipientCode?.commissionPercent ?? 0) : indirectPct;
      const newAmount = round2((price * pct) / 100);
      const cur = Number(c.amount);
      const tag = isDirect ? 'directa' : 'indirecta';
      if (Math.abs(cur - newAmount) < 0.005) {
        console.log(`   ✓ $${cur.toFixed(2)} ${c.recipientCode?.ownerName} (${tag} ${pct}%) — ya ok`);
      } else {
        console.log(`   ${apply ? 'RECALC' : 'recalc'}: $${cur.toFixed(2)} → $${newAmount.toFixed(2)}  ${c.recipientCode?.ownerName} (${tag} ${pct}%)`);
        if (apply) await prisma.commission.update({ where: { id: c.id }, data: { amount: newAmount } });
      }
    }
    console.log('');
  }
  console.log(apply ? 'Done.' : 'Dry-run completo.');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
