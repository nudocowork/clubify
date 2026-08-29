// Re-ancla el próximo cobro (currentPeriodEnd) de los negocios ACTIVOS de SELLEA
// a la ACTIVACIÓN del crédito: currentPeriodEnd = lastChargeAt + periodo del plan.
// Regla del dueño 2026-08-29 ("las fechas = cuando se activan los créditos"). El
// bug de activateTenant apilaba el tiempo de prueba/ventana ilimitada (Vizage
// quedó en 28-sep en vez de 14-sep; Farmacia en 26-oct en vez de 28-ago).
// Idempotente (solo cambia los que difieren > 1 min). DRY-RUN por defecto; --apply escribe.
//
// OJO consecuencia: Farmacia FarCentro (lastCharge 28-jul) queda en 28-ago (ya
// vencida) → el cron de renovaciones le cobrará 1 crédito a SELLEA y moverá el
// próximo a 28-sep. Aprobado por el dueño 2026-08-29.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

const addMonths = (dt, n) => { const r = new Date(dt); r.setMonth(r.getMonth() + n); return r; };
const monthsFor = (per) => { const P = (per || 'MENSUAL').toUpperCase(); return P === 'ANUAL' ? 12 : P === 'SEMESTRAL' ? 6 : P === 'TRIMESTRAL' ? 3 : 1; };
const iso = (d) => (d ? new Date(d).toISOString() : '—');

(async () => {
  const APPLY = process.argv.includes('--apply');
  const wl = await p.whiteLabel.findFirst({ where: { slug: 'sellea' }, select: { id: true } });
  const ts = await p.tenant.findMany({
    where: { whiteLabelId: wl.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, brandName: true, planPeriodicity: true, lastChargeAt: true, createdAt: true, currentPeriodEnd: true },
  });

  const changes = [];
  for (const t of ts) {
    const base = t.lastChargeAt || t.createdAt;
    if (!base) continue;
    const target = addMonths(base, monthsFor(t.planPeriodicity));
    const cur = t.currentPeriodEnd;
    const diffMs = cur ? Math.abs(new Date(cur) - target) : Infinity;
    if (diffMs > 60000) changes.push({ t, target });
  }

  console.log(`\nSELLEA activos: ${ts.length} · a corregir: ${changes.length}\n`);
  for (const { t, target } of changes) {
    const overdue = target < new Date() ? '  ⚠ QUEDA VENCIDA (se cobrará en el próximo cron)' : '';
    console.log(`${(t.brandName || '').padEnd(22)} ${iso(t.currentPeriodEnd).slice(0,10)} → ${iso(target).slice(0,10)}${overdue}`);
  }
  if (!changes.length) { console.log('Nada que corregir.'); await p.$disconnect(); return; }
  if (!APPLY) { console.log('\n[DRY-RUN] No se escribió nada. Para aplicar: --apply'); await p.$disconnect(); return; }

  for (const { t, target } of changes) {
    await p.tenant.update({ where: { id: t.id }, data: { currentPeriodEnd: target } });
  }
  console.log(`\n✅ Corregidos ${changes.length} negocio(s).`);
  await p.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
