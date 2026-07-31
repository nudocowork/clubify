// SOLO LECTURA. Mide la exposición del cambio "créditos = creditCost × meses":
// los negocios COMPLETOS con periodicidad no-mensual pasarán de 1 crédito a
// 3/6/12 en su próxima renovación. Reporta por marca: cuántos hay, cuánto
// crédito EXTRA necesitarán, y cuáles renuevan en los próximos 30 días.
// Usage: railway run --service Postgres-Nq8w node scripts/audit-nonmonthly-credit-exposure.cjs
const { PrismaClient } = require('@prisma/client');

function bundleMonths(p) {
  switch ((p || 'MENSUAL').toUpperCase()) {
    case 'TRIMESTRAL': return 3;
    case 'SEMESTRAL': return 6;
    case 'ANUAL': return 12;
    default: return 1;
  }
}

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Todos los negocios ACTIVE de marcas blancas (excluye Clubify: paga directo,
  // no consume créditos). businessType aún no existe en prod → todos son FULL.
  const tenants = await prisma.tenant.findMany({
    where: {
      status: 'ACTIVE',
      isCampaignHost: false,
      whiteLabelId: { not: null },
      whiteLabel: { slug: { not: 'clubify' }, creditsUnlimited: false },
    },
    select: {
      id: true, planPeriodicity: true, currentPeriodEnd: true,
      whiteLabel: { select: { id: true, name: true, creditsAvailable: true, creditsCommitted: true } },
    },
  });

  const byBrand = new Map();
  for (const t of tenants) {
    const wl = t.whiteLabel;
    if (!wl) continue;
    if (!byBrand.has(wl.id)) {
      byBrand.set(wl.id, {
        name: wl.name, available: wl.creditsAvailable, committed: wl.creditsCommitted,
        counts: { MENSUAL: 0, TRIMESTRAL: 0, SEMESTRAL: 0, ANUAL: 0 },
        extraTotal: 0, due30Cost: 0, due30Count: 0,
      });
    }
    const b = byBrand.get(wl.id);
    const months = bundleMonths(t.planPeriodicity);
    const key = months === 3 ? 'TRIMESTRAL' : months === 6 ? 'SEMESTRAL' : months === 12 ? 'ANUAL' : 'MENSUAL';
    b.counts[key]++;
    // Extra crédito por ciclo respecto al modelo viejo (que cobraba 1).
    b.extraTotal += (months - 1);
    // Exposición inmediata: renueva dentro de 30 días.
    if (t.currentPeriodEnd && t.currentPeriodEnd <= in30) {
      b.due30Cost += months;      // nuevo costo del ciclo
      b.due30Count++;
    }
  }

  const rows = [...byBrand.values()].filter((b) => b.extraTotal > 0 || b.due30Count > 0);
  rows.sort((a, b) => b.extraTotal - a.extraTotal);

  console.log('\n=== EXPOSICIÓN: costo de crédito por ciclo (Completos no-mensuales) ===');
  console.log(`Negocios ACTIVE de marca blanca (no ilimitada): ${tenants.length}\n`);
  if (rows.length === 0) {
    console.log('✅ No hay negocios con periodicidad no-mensual. Cero impacto en renovaciones.');
  } else {
    for (const b of rows) {
      const risk = b.available < b.due30Cost ? '  ⚠️ SALDO INSUFICIENTE para lo que renueva en 30d' : '';
      console.log(`• ${b.name}`);
      console.log(`    Trim:${b.counts.TRIMESTRAL} Sem:${b.counts.SEMESTRAL} Anual:${b.counts.ANUAL} (Mensual:${b.counts.MENSUAL})`);
      console.log(`    Créditos extra que necesitará (todos sus ciclos): +${b.extraTotal}`);
      console.log(`    Renueva en ≤30d: ${b.due30Count} negocio(s) → nuevo costo ${b.due30Cost} créd · disponibles ${b.available}${risk}`);
    }
    console.log('\nRecomendación: recargar créditos a las marcas con ⚠️ ANTES de desplegar el backend');
    console.log('(el cron de renovación corre 02:00 UTC diario).');
  }

  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
