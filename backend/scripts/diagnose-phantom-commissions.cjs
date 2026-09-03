// READ-ONLY. Reporte de comisiones "fantasma": creadas por el cron
// reconcileRecurringCommissions (calendario, SIN pago Hotmart verificado).
// Marcador: una comisión REAL trae externalTxId o hotmartTransactionId; el cron
// no setea ninguno → candidata a fantasma = ambos null.
//
//   DAYS=21 railway run --service Postgres-Nq8w node scripts/diagnose-phantom-commissions.cjs
//
// NO modifica nada. Solo lista para que el dueño confirme cuáles anular.
const { PrismaClient } = require('@prisma/client');

const NAMES = ['birria leon', 'buenos diaz', 'mykoz', '&n coffee', 'cocoa beauty'];
const DAYS = process.env.DAYS ? Number(process.env.DAYS) : 21;

const money = (d) => (d == null ? '-' : Number(d).toFixed(2));
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const commSelect = {
    id: true, amount: true, status: true, createdAt: true, availableAt: true,
    externalTxId: true, hotmartTransactionId: true, periodKey: true, notes: true,
    recipientCode: { select: { role: true, code: true } },
    referralUse: { select: { tenant: { select: { name: true, brandName: true, planPeriodicity: true, lastChargeAt: true, currentPeriodEnd: true, hotmartTransactionId: true } } } },
  };
  const isPhantom = (c) => !c.externalTxId && !c.hotmartTransactionId;

  // ── SECCIÓN 1: empresas del reporte ────────────────────────────────
  console.log('══════════ EMPRESAS DEL REPORTE ══════════\n');
  for (const name of NAMES) {
    const t = await p.tenant.findFirst({
      where: { OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { brandName: { contains: name, mode: 'insensitive' } },
      ] },
      select: { id: true, name: true, brandName: true, planPeriodicity: true,
        lastChargeAt: true, currentPeriodEnd: true, hotmartTransactionId: true,
        subscriptionPriceUsd: true, status: true },
    });
    if (!t) { console.log(`❓ "${name}" → no encontrada\n`); continue; }
    console.log(`■ ${t.brandName || t.name}  [${t.planPeriodicity || 'MENSUAL'} · ${t.status}]`);
    console.log(`  tenant: lastChargeAt=${day(t.lastChargeAt)} · currentPeriodEnd=${day(t.currentPeriodEnd)} · hotmartTxId=${t.hotmartTransactionId ? 'sí('+String(t.hotmartTransactionId).slice(0,10)+'…)' : 'NO'} · subPriceUsd=${money(t.subscriptionPriceUsd)}`);
    const comms = await p.commission.findMany({
      where: { referralUse: { tenantId: t.id } },
      select: commSelect, orderBy: { createdAt: 'desc' }, take: 20,
    });
    if (!comms.length) { console.log('  (sin comisiones)\n'); continue; }
    for (const c of comms) {
      const tag = isPhantom(c) ? '🚩FANTASMA' : '✅real';
      const tx = c.hotmartTransactionId || c.externalTxId;
      console.log(`   ${tag} ${day(c.createdAt)} · ${c.recipientCode?.role || '?'} · $${money(c.amount)} · ${c.status} · avail=${day(c.availableAt)} · tx=${tx ? String(tx).slice(0,12)+'…' : 'NULL'} · pk=${c.periodKey || '—'}${c.notes ? ' · nota="'+c.notes.slice(0,40)+'"' : ''}`);
    }
    console.log('');
  }

  // ── SECCIÓN 2: TODAS las fantasma recientes (alcance total) ─────────
  const since = new Date(Date.now() - DAYS * 86400000);
  const recent = await p.commission.findMany({
    where: {
      externalTxId: null, hotmartTransactionId: null,
      status: { in: ['PENDING', 'APPROVED'] },
      createdAt: { gte: since },
      referralUseId: { not: null },
    },
    select: commSelect, orderBy: { createdAt: 'desc' },
  });
  console.log(`══════════ TODAS las comisiones sin transacción (PENDING/APPROVED, últimos ${DAYS}d) ══════════`);
  console.log(`Total candidatas a fantasma: ${recent.length} · Suma $${recent.reduce((s, c) => s + Number(c.amount), 0).toFixed(2)}\n`);
  for (const c of recent) {
    const tn = c.referralUse?.tenant;
    console.log(`  🚩 ${day(c.createdAt)} · ${(tn?.brandName || tn?.name || '?').slice(0,26).padEnd(26)} · ${(tn?.planPeriodicity||'MENSUAL').padEnd(10)} · ${(c.recipientCode?.role||'?').padEnd(10)} · $${money(c.amount).padStart(7)} · ${c.status.padEnd(8)} · avail=${day(c.availableAt)}`);
    console.log(`        tenant: lastCharge=${day(tn?.lastChargeAt)} · periodEnd=${day(tn?.currentPeriodEnd)} · hotmartTx=${tn?.hotmartTransactionId ? 'sí' : 'NO'}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
