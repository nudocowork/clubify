// DIAGNÓSTICO (solo lectura) de la nueva secuencia de mora P4 (PDF 2026-07-01).
// Muestra qué negocios Clubify/Hotmart ACTIVE están en mora y qué acción les
// tocaría (recordatorio D+1 / aviso D+2 / suspensión D+3), sin escribir nada.
// Úsalo ANTES/DESPUÉS de desplegar para revisar que no haya falsos positivos
// (cuentas legacy con currentPeriodEnd viejo).
//
// Usage:
//   railway run --service Postgres-Nq8w node /ABS/PATH/backend/scripts/diagnose-overdue-suspension.cjs
const { PrismaClient } = require('@prisma/client');

const PAUSE_DAYS = 3;
const STALE_CAP = 60;
const dayMs = 24 * 60 * 60 * 1000;

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const now = new Date();

  const clubify = await prisma.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
  const candidates = await prisma.tenant.findMany({
    where: {
      status: 'ACTIVE',
      AND: [
        { OR: [{ whiteLabelId: null }, { whiteLabel: { slug: 'clubify' } }] },
        { OR: [{ failedPaymentCount: { gt: 0 } }, { currentPeriodEnd: { lt: now } }] },
      ],
    },
    select: {
      id: true, brandName: true, failedPaymentCount: true,
      lastPaymentAttemptAt: true, currentPeriodEnd: true, lastChargeAt: true,
    },
    orderBy: { currentPeriodEnd: 'asc' },
  });

  console.log(`Clubify wlId: ${clubify?.id ?? 'null'} · candidatos ACTIVE en posible mora: ${candidates.length}\n`);
  let willReminder = 0, willNotice = 0, willSuspend = 0, staleSkipped = 0;

  for (const t of candidates) {
    let dueSince = null, byFailure = false;
    if ((t.failedPaymentCount ?? 0) > 0 && t.lastPaymentAttemptAt) {
      dueSince = t.lastPaymentAttemptAt; byFailure = true;
    } else if (t.currentPeriodEnd && t.currentPeriodEnd.getTime() < now.getTime()) {
      const renewed = t.lastChargeAt != null && t.lastChargeAt.getTime() >= t.currentPeriodEnd.getTime();
      if (!renewed) dueSince = t.currentPeriodEnd;
    }
    if (!dueSince) continue;
    const days = Math.floor((now.getTime() - dueSince.getTime()) / dayMs);
    if (days < 1) continue;

    let action;
    if (days >= PAUSE_DAYS) {
      if (!byFailure && days > STALE_CAP) { action = `SKIP (legacy, ${days}d > ${STALE_CAP})`; staleSkipped++; }
      else { action = 'SUSPENDER'; willSuspend++; }
    } else if (days === 2) { action = 'aviso D+2'; willNotice++; }
    else if (days === 1) { action = 'recordatorio D+1'; willReminder++; }
    else { action = '—'; }

    console.log(
      `· ${t.brandName} · ${days}d en mora ${byFailure ? '(cobro fallido)' : '(fecha vencida)'} → ${action}` +
      `  [failed=${t.failedPaymentCount} cpe=${t.currentPeriodEnd?.toISOString().slice(0,10) ?? '—'} lastCharge=${t.lastChargeAt?.toISOString().slice(0,10) ?? '—'}]`,
    );
  }

  console.log(`\nResumen → recordatorios D+1: ${willReminder} · avisos D+2: ${willNotice} · SUSPENDERÍA: ${willSuspend} · legacy omitidos: ${staleSkipped}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
