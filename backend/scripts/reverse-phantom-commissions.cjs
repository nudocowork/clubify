// Revierte (status → REJECTED) las comisiones fantasma de JULIO 2026 de las 5
// empresas del reporte: creadas por el cron de calendario, SIN transacción
// Hotmart (externalTxId y hotmartTransactionId ambos null), estado APPROVED
// ("Disponible", aún NO pagadas). NO toca las de junio (ya PAID) ni las reales.
//
//   node ...             → DRY-RUN (solo lista)
//   APPLY=1 node ...     → aplica (status=REJECTED + nota)
//   railway run --service Postgres-Nq8w node scripts/reverse-phantom-commissions.cjs
const { PrismaClient } = require('@prisma/client');

const NAMES = process.env.NAMES
  ? process.env.NAMES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : ['birria leon', 'buenos diaz', 'mykoz', '&n coffee', 'cocoa beauty'];
const SINCE = (process.env.SINCE || '2026-07-01') + 'T00:00:00Z';
const APPLY = process.env.APPLY === '1';
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const dbUrl = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }
  const p = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  const tenants = await p.tenant.findMany({
    where: { OR: NAMES.map((n) => ({ OR: [
      { name: { contains: n, mode: 'insensitive' } },
      { brandName: { contains: n, mode: 'insensitive' } },
    ] })) },
    select: { id: true, name: true, brandName: true },
  });
  const ids = tenants.map((t) => t.id);
  console.log('Tenants:', tenants.map((t) => t.brandName || t.name).join(', '));

  const targets = await p.commission.findMany({
    where: {
      referralUse: { tenantId: { in: ids } },
      status: { in: ['PENDING', 'APPROVED'] },
      externalTxId: null,
      hotmartTransactionId: null,
      createdAt: { gte: new Date(SINCE) },
    },
    select: {
      id: true, amount: true, status: true, createdAt: true, periodKey: true, notes: true,
      recipientCode: { select: { role: true } },
      referralUse: { select: { tenant: { select: { name: true, brandName: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const sum = targets.reduce((s, c) => s + Number(c.amount), 0).toFixed(2);
  console.log(`\n${APPLY ? '── APLICANDO ──' : '── DRY-RUN ──'}  ${targets.length} comisiones · Suma $${sum}\n`);
  for (const c of targets) {
    const tn = c.referralUse?.tenant;
    console.log(`  ${day(c.createdAt)} · ${(tn?.brandName || tn?.name || '?').padEnd(26)} · ${(c.recipientCode?.role || '?').padEnd(10)} · $${Number(c.amount).toFixed(2).padStart(7)} · ${c.status} → REJECTED`);
  }

  if (APPLY && targets.length) {
    for (const c of targets) {
      const note = `${c.notes ? c.notes + ' | ' : ''}[2026-07-16] Anulada: comisión de renovación fantasma (cron de calendario sin pago Hotmart verificado).`;
      await p.commission.update({ where: { id: c.id }, data: { status: 'REJECTED', notes: note } });
    }
    console.log(`\n✅ ${targets.length} comisiones revertidas a REJECTED.`);
  } else if (!APPLY) {
    console.log('\nDRY-RUN. Correr con APPLY=1 para aplicar.');
  }

  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
