// Corrige currentPeriodEnd de Vizage MedSpa (SELLEA). Se activó el 14-ago en modo
// ilimitado (ventana 14→28 ago); esa ventana empujó el ancla de cobro a hoy
// (28-ago) → currentPeriodEnd quedó en 28-sep. El próximo pago correcto es
// 14-sep = lastChargeAt (14-ago) + 1 mes, la misma invariante que cumplen los
// demás negocios de SELLEA (currentPeriodEnd = último cobro + 1 periodo).
// Aprobado por el dueño 2026-08-28. Idempotente. DRY-RUN por defecto; --apply escribe.
const { PrismaClient } = require('@prisma/client');

const addMonths = (dt, n) => { const r = new Date(dt); r.setMonth(r.getMonth() + n); return r; };
const iso = (d) => (d ? new Date(d).toISOString() : '—');

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const APPLY = process.argv.includes('--apply');

  const t = await p.tenant.findFirst({
    where: { brandName: { contains: 'Vizage', mode: 'insensitive' }, whiteLabel: { slug: 'sellea' } },
    select: { id: true, brandName: true, status: true, planPeriodicity: true, lastChargeAt: true, createdAt: true, currentPeriodEnd: true },
  });
  if (!t) { console.error('No se encontró Vizage en SELLEA'); process.exit(1); }

  const per = (t.planPeriodicity || 'MENSUAL').toUpperCase();
  const months = per === 'ANUAL' ? 12 : per === 'SEMESTRAL' ? 6 : per === 'TRIMESTRAL' ? 3 : 1;
  const base = t.lastChargeAt || t.createdAt;
  const target = addMonths(base, months);

  console.log(`\n${t.brandName} · ${t.status} · ${per}`);
  console.log(`  lastChargeAt (base):   ${iso(base)}`);
  console.log(`  currentPeriodEnd AHORA: ${iso(t.currentPeriodEnd)}`);
  console.log(`  currentPeriodEnd NUEVO: ${iso(target)}`);

  if (t.currentPeriodEnd && Math.abs(new Date(t.currentPeriodEnd) - target) < 60000) {
    console.log('\n✔ Ya está en la fecha correcta. Nada que hacer.');
    await p.$disconnect();
    return;
  }
  if (!APPLY) { console.log('\n[DRY-RUN] No se escribió nada. Para aplicar: --apply'); await p.$disconnect(); return; }

  await p.tenant.update({ where: { id: t.id }, data: { currentPeriodEnd: target } });
  const after = await p.tenant.findUnique({ where: { id: t.id }, select: { currentPeriodEnd: true } });
  console.log(`\n✅ Actualizado. currentPeriodEnd = ${iso(after.currentPeriodEnd)}`);
  await p.$disconnect();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
