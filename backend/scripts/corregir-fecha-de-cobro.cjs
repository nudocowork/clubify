// Corrige los negocios cuya FECHA DE PRÓXIMO COBRO (`currentPeriodEnd`) apunta
// DESPUÉS del ciclo real (último cobro + periodicidad del plan).
//
// EL CASO (2026-09-16, Café Macondo): compró por Hotmart el 16-06 (TRIMESTRAL) y
// el webhook `PURCHASE_COMPLETE` llegó el 24-06, al cerrar la ventana de
// garantía, sin `date_next_charge`. El fallback de primer pago contaba desde
// «hoy» en vez de desde la fecha del pago, así que se escribió 24-09 cuando
// Hotmart cobraba el 16-09. Los avisos D-7/D-3/D-1/D-0 cuelgan de esa fecha:
// los tres quedaron programados DESPUÉS del cobro real, el negocio no recibió
// ninguno y se enteró con el «tu pago falló».
//
// La raíz se arregló el 18-08 (f8b067df): Hotmart ya manda la fecha en el
// payload, así que el fallback casi nunca entra. Esto repara a
// los que ya tienen la fecha mal escrita.
//
// REGLA DE SEGURIDAD: solo se corrige a quien, al recalcular, queda con la fecha
// en el FUTURO. A quien quedaría en el PASADO no se le toca — pasaría a estar
// «vencido» de golpe y el cron de mora podría suspender a un negocio que paga
// bien. Esos se listan aparte para mirarlos a mano.
//
// NO toca los campos de dedup de avisos (`preReminder*SentFor`): quedaron
// sellados contra la fecha VIEJA, así que al cambiar la fecha dejan de casar
// solos y el cron vuelve a mandar los avisos del ciclo. Es justo lo que se
// quiere y evita un segundo UPDATE.
//
// Uso: railway run --service Postgres-Nq8w node scripts/corregir-fecha-de-cobro.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
// Margen por drift de fechas de la pasarela. Mismo umbral que `paidButStale` y
// que `MARGEN_DESFASE_DIAS` en src/billing/fecha-de-cobro.ts.
const MARGEN_DIAS = 2;
const DIA_MS = 24 * 60 * 60 * 1000;

// Espejo EXACTO de src/common/plan-period.ts (esto es .cjs y no puede importar
// el TS). Si allí cambia la regla de fin de mes, cambiarla también aquí.
function bundleMonths(p) {
  switch (String(p || 'MENSUAL').toUpperCase()) {
    case 'TRIMESTRAL': return 3;
    case 'SEMESTRAL': return 6;
    case 'ANUAL': return 12;
    default: return 1;
  }
}
function addPlanPeriod(from, p) {
  const d = new Date(from);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + bundleMonths(p));
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimoDia));
  return d;
}

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const ahora = new Date();
  // 8 días, no 7: el cobro del séptimo día cae a una hora concreta y con el
  // corte justo en 7*24h se quedaba fuera del aviso por unas horas (Top Man).
  const enUnaSemana = new Date(ahora.getTime() + 8 * DIA_MS);

  // Mismo universo que los recordatorios de pre-cobro en billing.service.ts:
  // Clubify (whiteLabelId null = legacy Clubify) + marcas que cobran por Stripe.
  const tenants = await prisma.tenant.findMany({
    where: {
      status: 'ACTIVE',
      canceledAt: null,
      deletedAt: null,
      isCampaignHost: false,
      currentPeriodEnd: { not: null },
      lastChargeAt: { not: null },
      OR: [
        { whiteLabelId: null },
        { whiteLabel: { slug: 'clubify' } },
        { whiteLabel: { paymentGateway: 'STRIPE' } },
      ],
    },
    select: {
      id: true, brandName: true, planPeriodicity: true,
      currentPeriodEnd: true, lastChargeAt: true, failedPaymentCount: true,
      hotmartSubscriberCode: true, manualPayment: true,
    },
    orderBy: { brandName: 'asc' },
  });

  const corregibles = [];
  const revision = [];
  // Códigos que no vienen de una compra real en la pasarela.
  const SIN_RASTRO = /^(wl-|trial-|dup-|comp-)/i;
  for (const t of tenants) {
    const esperado = addPlanPeriod(t.lastChargeAt, t.planPeriodicity);
    const diasTarde = (t.currentPeriodEnd.getTime() - esperado.getTime()) / DIA_MS;
    if (diasTarde <= MARGEN_DIAS) continue; // alineado (o atrasado: eso es paidButStale)
    const fila = { ...t, esperado, diasTarde: Math.round(diasTarde) };
    // La regla de seguridad: recalcular solo si queda en el futuro. Moverle la
    // fecha a una que ya pasó lo vuelve moroso de golpe.
    if (esperado.getTime() <= ahora.getTime()) {
      revision.push({ ...fila, motivo: 'la fecha recalculada cae en el pasado' });
      continue;
    }
    // Y solo si hay un cobro de la pasarela detrás. Un código sintético
    // (wl-/trial-/dup-/comp-) o un pago metido a mano significan que
    // `lastChargeAt` no lo puso Hotmart, así que recalcular sobre él sería
    // inventarse la fecha. Fusion sushi entraba por aquí: su fecha la había
    // sanado healStaleCharge, no un cobro real.
    if (SIN_RASTRO.test(t.hotmartSubscriberCode || '')) {
      revision.push({ ...fila, motivo: 'código sintético: no hay cobro de la pasarela detrás' });
      continue;
    }
    if (t.manualPayment) {
      revision.push({ ...fila, motivo: 'pago manual: la fecha la lleva una persona' });
      continue;
    }
    corregibles.push(fila);
  }

  console.log(`negocios activos con cobro por pasarela: ${tenants.length}`);
  console.log(`con la fecha apuntada DESPUÉS del ciclo real (>${MARGEN_DIAS}d): ${corregibles.length + revision.length}\n`);

  console.log(`── SE CORRIGEN (${corregibles.length}) ──`);
  for (const t of corregibles) {
    console.log(
      `  ${t.brandName} [${t.planPeriodicity || 'MENSUAL'}] ` +
      `hoy=${ymd(t.currentPeriodEnd)} → recalculada=${ymd(t.esperado)} ` +
      `(${t.diasTarde}d tarde, último cobro ${ymd(t.lastChargeAt)})`,
    );
  }

  console.log(`\n── QUEDAN PARA REVISIÓN MANUAL (${revision.length}) ──`);
  for (const t of revision) console.log(`   · ${t.brandName}: ${t.motivo || '—'}`);
  console.log('  La fecha recalculada cae en el PASADO: corregirla los dejaría');
  console.log('  vencidos de golpe y el cron de mora podría suspenderlos.');
  for (const t of revision) {
    console.log(
      `  ${t.brandName} [${t.planPeriodicity || 'MENSUAL'}] ` +
      `hoy=${ymd(t.currentPeriodEnd)} → recalculada=${ymd(t.esperado)} ` +
      `(${t.diasTarde}d tarde, último cobro ${ymd(t.lastChargeAt)}, ` +
      `cobros fallidos=${t.failedPaymentCount})`,
    );
  }

  const estaSemana = corregibles.filter((t) => t.esperado <= enUnaSemana);
  if (estaSemana.length) {
    console.log('\n' + '='.repeat(70));
    console.log('  ⚠  COBRAN ESTA SEMANA — si no se corrige AHORA, les pasa lo');
    console.log('     mismo que a Café Macondo: cobro sin un solo aviso previo.');
    console.log('='.repeat(70));
    for (const t of estaSemana) {
      console.log(`     ${t.brandName}: cobra el ${ymd(t.esperado)} (tenemos apuntado el ${ymd(t.currentPeriodEnd)})`);
    }
    console.log('='.repeat(70));
  }

  if (!corregibles.length) {
    console.log('\nNada que corregir.');
    await prisma.$disconnect();
    return;
  }

  if (!APLICAR) {
    console.log(`\n-- ENSAYO (dry run). Con --aplicar se corregirían ${corregibles.length} fechas.`);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let saltados = 0;
  for (const t of corregibles) {
    // UPDATE CONDICIONAL sobre el valor que leímos: si otra cosa (un webhook de
    // Hotmart, el auto-sanador) ya movió la fecha entre la lectura y ahora, el
    // count viene 0 y NO se pisa. Esto es lo que hace el script idempotente y
    // seguro de repetir.
    const r = await prisma.tenant.updateMany({
      where: { id: t.id, currentPeriodEnd: t.currentPeriodEnd },
      data: { currentPeriodEnd: t.esperado },
    });
    if (r.count === 1) {
      ok++;
      console.log(`corregido ${t.brandName}: ${ymd(t.currentPeriodEnd)} → ${ymd(t.esperado)}`);
    } else {
      saltados++;
      console.log(`SALTADO ${t.brandName}: la fecha cambió desde la lectura (count=${r.count}). Volver a correr el ensayo.`);
    }
  }
  console.log(`\ncorregidos: ${ok} · saltados: ${saltados} · para revisión manual: ${revision.length}`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
