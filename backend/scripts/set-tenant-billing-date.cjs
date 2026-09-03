// Ancla la fecha de cobro/renovación (currentPeriodEnd) de UN negocio a una
// fecha fija (por defecto el 1 del mes). Como el cron de renovaciones extiende
// sumando meses de calendario (addPlanPeriod → setMonth), la fecha queda
// clavada en el mismo día del mes en cada ciclo.
//
//   Dry-run (solo lee):  TENANT="Oasis" node scripts/set-tenant-billing-date.cjs
//   Aplicar:             TENANT="Oasis" TARGET=2026-08-01 APPLY=1 node scripts/set-tenant-billing-date.cjs
//
// Se corre en prod con:  railway run --service Postgres-Nq8w TENANT="Oasis" [APPLY=1] node scripts/set-tenant-billing-date.cjs
const { PrismaClient } = require('@prisma/client');

const TENANT = (process.env.TENANT || 'Oasis Nutrition Bar').trim();
const TARGET = (process.env.TARGET || '2026-08-01').trim();
const APPLY = process.env.APPLY === '1';

(async () => {
  const p = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  });

  const matches = await p.tenant.findMany({
    where: {
      deletedAt: null,
      OR: [
        { brandName: { contains: TENANT, mode: 'insensitive' } },
        { name: { contains: TENANT, mode: 'insensitive' } },
        { slug: { contains: TENANT.toLowerCase().replace(/\s+/g, '-'), mode: 'insensitive' } },
      ],
    },
    select: {
      id: true, brandName: true, name: true, slug: true, status: true,
      planPeriodicity: true, currentPeriodEnd: true, lastChargeAt: true,
      trialEndsAt: true, gracePeriodDays: true,
      stripeSubscriptionId: true, stripeCustomerId: true,
      hotmartSubscriberCode: true, businessGroupId: true,
      whiteLabelId: true,
      whiteLabel: { select: { name: true, slug: true, creditsAvailable: true, creditsUnlimited: true } },
    },
  });

  if (matches.length === 0) { console.error(`❌ No se encontró negocio "${TENANT}"`); process.exit(1); }
  if (matches.length > 1) {
    console.error(`⚠️  ${matches.length} negocios coinciden con "${TENANT}" — sé más específico:`);
    for (const m of matches) console.error(`   · ${m.brandName || m.name} (${m.slug}) — marca ${m.whiteLabel?.slug || 'null'} — id ${m.id}`);
    process.exit(1);
  }

  const t = matches[0];
  const fmt = (d) => (d ? new Date(d).toISOString() : 'null');
  console.log('═══ NEGOCIO ═══');
  console.log(`Nombre:        ${t.brandName || t.name}  (${t.slug})`);
  console.log(`id:            ${t.id}`);
  console.log(`Marca:         ${t.whiteLabel?.name || '—'} (${t.whiteLabel?.slug || 'null'})`);
  console.log(`  créditos:    ${t.whiteLabel?.creditsUnlimited ? 'ILIMITADOS' : t.whiteLabel?.creditsAvailable}`);
  console.log(`status:        ${t.status}`);
  console.log(`planPeriod:    ${t.planPeriodicity || 'null (=MENSUAL)'}`);
  console.log(`grupoEmpresa:  ${t.businessGroupId || 'null (individual)'}`);
  console.log('');
  console.log('═══ FACTURACIÓN ACTUAL ═══');
  console.log(`currentPeriodEnd:     ${fmt(t.currentPeriodEnd)}`);
  console.log(`lastChargeAt:         ${fmt(t.lastChargeAt)}`);
  console.log(`trialEndsAt:          ${fmt(t.trialEndsAt)}`);
  console.log(`gracePeriodDays:      ${t.gracePeriodDays}`);
  console.log('');
  console.log('═══ PASARELA (para detectar cargo real a tarjeta) ═══');
  console.log(`stripeSubscriptionId: ${t.stripeSubscriptionId || 'null'}`);
  console.log(`stripeCustomerId:     ${t.stripeCustomerId || 'null'}`);
  console.log(`hotmartSubscriberCode: ${t.hotmartSubscriberCode || 'null'}`);
  console.log('');

  // Verificaciones de seguridad
  const warns = [];
  if (!t.whiteLabel || !/sellea/i.test(t.whiteLabel.slug || '')) warns.push(`Marca NO es Sellea (es "${t.whiteLabel?.slug || 'null'}") — confirmar antes de aplicar.`);
  if (t.stripeSubscriptionId) warns.push('TIENE stripeSubscriptionId → cargo REAL a tarjeta vía Stripe. Cambiar solo la BD DESINCRONIZA; hay que mover el anchor en Stripe también.');
  if (t.businessGroupId) warns.push('Pertenece a un Grupo Empresarial → su ciclo lo dicta el grupo, no su fecha individual.');
  if (t.status !== 'ACTIVE') warns.push(`status=${t.status} (no ACTIVE) → el cron de renovaciones solo procesa ACTIVE.`);

  // Fecha objetivo: día indicado a mediodía UTC (queda claramente "el 1" en toda América).
  const target = new Date(`${TARGET}T12:00:00.000Z`);
  if (Number.isNaN(target.getTime())) { console.error(`❌ TARGET inválido: "${TARGET}"`); process.exit(1); }

  console.log('═══ CAMBIO PROPUESTO ═══');
  console.log(`currentPeriodEnd: ${fmt(t.currentPeriodEnd)}  →  ${target.toISOString()}`);
  const cpe = t.currentPeriodEnd ? new Date(t.currentPeriodEnd) : null;
  if (cpe) {
    const deltaDays = Math.round((target - cpe) / 86400000);
    console.log(`  (${deltaDays >= 0 ? 'EXTIENDE' : 'ACORTA'} el ciclo actual en ${Math.abs(deltaDays)} días)`);
  }
  if (warns.length) { console.log('\n⚠️  AVISOS:'); for (const w of warns) console.log(`   · ${w}`); }

  if (!APPLY) { console.log('\n🔵 DRY-RUN. Revisar arriba y correr con APPLY=1 para aplicar.'); await p.$disconnect(); return; }

  if (t.stripeSubscriptionId) {
    console.error('\n🛑 ABORTADO: tiene stripeSubscriptionId (cargo real a tarjeta). No aplico automáticamente para no desincronizar. Quitar el bloqueo manualmente si es intencional.');
    await p.$disconnect(); process.exit(1);
  }

  await p.tenant.update({ where: { id: t.id }, data: { currentPeriodEnd: target } });
  const after = await p.tenant.findUnique({ where: { id: t.id }, select: { currentPeriodEnd: true } });
  console.log(`\n✅ APLICADO. currentPeriodEnd ahora: ${fmt(after.currentPeriodEnd)}`);
  console.log('   Renovaciones futuras sumarán meses de calendario → queda clavado en el día 1.');
  await p.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
