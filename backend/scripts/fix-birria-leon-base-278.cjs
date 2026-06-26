// Corrige las comisiones PENDING de Birria Leon a la base correcta del bundle
// SEMESTRAL = $278 (estaban sobre $300 = priceMonthly $50 × 6, bug viejo).
//   Santiago (N3CKQGBD, AMBASSADOR 25%): $75.00 → $69.50
//   Juan     (XYAQE6XH, INFLUENCER 5% indirecto): $15.00 → $13.90
// Dry-run por defecto. APPLY=1 para ejecutar. Idempotente (set a valor exacto).
//
//   railway run --service Postgres-Nq8w \
//     node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/fix-birria-leon-base-278.cjs
//   (con APPLY=1 para aplicar)

const { PrismaClient } = require('@prisma/client');

const BASE = 278;
const TARGETS = [
  { code: 'N3CKQGBD', who: 'Santiago Romero', pct: 25, amount: 69.5 },
  { code: 'XYAQE6XH', who: 'Juan Camilo Rincón', pct: 5, amount: 13.9 },
];

(async () => {
  const apply = process.env.APPLY === '1';
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const tenant = await prisma.tenant.findFirst({
    where: { brandName: { contains: 'Birria', mode: 'insensitive' } },
    select: { id: true, brandName: true, planPeriodicity: true },
  });
  if (!tenant) { console.error('No se encontró Birria Leon'); process.exit(1); }
  console.log(`Tenant: ${tenant.brandName} (${tenant.id.slice(0, 8)}) ${tenant.planPeriodicity}`);
  console.log(`Base SEMESTRAL canónica: $${BASE}\n`);
  console.log(apply ? '*** MODO APPLY ***\n' : '*** DRY-RUN (APPLY=1 para aplicar) ***\n');

  for (const t of TARGETS) {
    const code = await prisma.referralCode.findUnique({
      where: { code: t.code },
      select: { id: true, ownerName: true },
    });
    if (!code) { console.log(`✗ Code ${t.code} no existe — skip`); continue; }

    // Solo comisiones PENDING/APPROVED no pagadas de este tenant+recipient.
    const rows = await prisma.commission.findMany({
      where: {
        recipientCodeId: code.id,
        referralUse: { tenantId: tenant.id },
        status: { in: ['PENDING', 'APPROVED'] },
        paymentStatus: 'PENDING',
      },
      select: { id: true, amount: true, status: true, createdAt: true },
    });

    console.log(`${t.who} (${t.code}, ${t.pct}%) → objetivo $${t.amount.toFixed(2)}`);
    if (rows.length === 0) { console.log('  (sin comisiones PENDING para ajustar)\n'); continue; }
    for (const r of rows) {
      const cur = Number(r.amount);
      if (Math.abs(cur - t.amount) < 0.005) {
        console.log(`  ✓ ${r.id.slice(0, 8)} ya está en $${cur.toFixed(2)} — ok`);
        continue;
      }
      console.log(`  ${apply ? 'ACTUALIZA' : 'actualizaría'} ${r.id.slice(0, 8)}: $${cur.toFixed(2)} → $${t.amount.toFixed(2)}`);
      if (apply) {
        await prisma.commission.update({
          where: { id: r.id },
          data: { amount: t.amount },
        });
      }
    }
    console.log('');
  }

  console.log(apply ? 'Done. Comisiones ajustadas.' : 'Dry-run completo. Re-correr con APPLY=1.');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
