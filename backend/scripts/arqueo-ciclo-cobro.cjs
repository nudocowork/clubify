#!/usr/bin/env node
/**
 * SOLO LECTURA: arqueo del ciclo de cobro de los negocios ACTIVOS.
 *
 * Por qué existe: el caso Quipao Bubble Tea (2026-09-06). El cron mandó el aviso
 * «tu cobro es en 7 días» para un ciclo con vencimiento 09-sep y, ese mismo día,
 * una corrección a mano devolvió `currentPeriodEnd` a 01-sep. Todos los avisos
 * de cobro se buscan en ventanas RELATIVAS a `currentPeriodEnd`
 * (`billing.service.ts` → sendPreChargeReminder7d/3d/Today, sendPaymentReminders),
 * así que un negocio cuya fecha está en el pasado se cae de todas las ventanas
 * pre-cobro, y solo le queda la vía de mora (`processOverdueAccounts`), que
 * después del día 2 calla hasta suspender el día 6.
 *
 * Este script no arregla nada: cuenta cuántos negocios están en cada situación
 * rara y lista los peores, para decidir con datos y no con un caso.
 *
 * Tres invariantes que mide (sobre tenants ACTIVE, no borrados):
 *   1. `currentPeriodEnd` en el pasado. Un ACTIVE con fecha vencida está en
 *      mora o tiene la fecha desincronizada — las dos cosas importan.
 *   2. `preReminder7dSentFor` distinto de `currentPeriodEnd` (habiendo marca).
 *      Si la marca es POSTERIOR a la fecha, la fecha RETROCEDIÓ después de
 *      avisar (patrón Quipao). Si es anterior, el ciclo avanzó sin pasar por el
 *      reset de `activatePurchase` — inocuo para el dedup (compara igualdad),
 *      pero delata por dónde se movió la fecha.
 *   3. `lastChargeAt + periodicidad` distinto de `currentPeriodEnd` (tolerancia
 *      ±2 días, la misma que usa `paidButStale`). Es la invariante que el propio
 *      auto-reparador (`healStaleCharge`) da por buena. Cuando la fecha está
 *      ANTES de lo esperado, el cron la va a empujar solo; cuando está DESPUÉS,
 *      alguien la movió (Hotmart `date_next_charge`, un script, un admin).
 *
 * Uso (desde backend/, con las variables de producción):
 *   railway run node scripts/arqueo-ciclo-cobro.cjs
 *   railway run node scripts/arqueo-ciclo-cobro.cjs --full   # lista todos los casos
 */
const { PrismaClient } = require('@prisma/client');

const FULL = process.argv.includes('--full');
const DIA_MS = 24 * 60 * 60 * 1000;
// Misma tolerancia que `paidButStale` en billing.service.ts: 2 días de drift
// de la pasarela no cuentan como descuadre.
const TOLERANCIA_MS = 2 * DIA_MS;

// Copia fiel de `addPlanPeriod` (src/common/plan-period.ts): suma MESES de
// calendario acotando el día al último del mes destino. No se importa el .ts
// porque este script corre con node pelado.
function mesesDelPlan(p) {
  switch ((p || 'MENSUAL').toUpperCase()) {
    case 'TRIMESTRAL':
      return 3;
    case 'SEMESTRAL':
      return 6;
    case 'ANUAL':
      return 12;
    default:
      return 1;
  }
}
function sumarPeriodo(desde, periodicidad) {
  const d = new Date(desde);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + mesesDelPlan(periodicidad));
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return d;
}

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '-');
const dias = (a, b) => Math.round((a.getTime() - b.getTime()) / DIA_MS);
const nombre = (t) => (t.brandName || t.name || t.id).slice(0, 28).padEnd(28);
const marca = (t) => (t.whiteLabel ? t.whiteLabel.slug : 'sin-marca');
// Solo estas marcas entran en los crons de avisos de cobro (mismo filtro que
// billing.service.ts): Clubify, sin marca (legacy = Clubify) y marcas Stripe.
const entraEnAvisos = (t) =>
  !t.whiteLabelId ||
  marca(t) === 'clubify' ||
  (t.whiteLabel && t.whiteLabel.paymentGateway === 'STRIPE');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL (correr con `railway run`).');
    process.exit(1);
  }
  const p = new PrismaClient({ datasources: { db: { url } } });
  const ahora = new Date();
  try {
    const ts = await p.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        brandName: true,
        name: true,
        planPeriodicity: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        firstFailedAt: true,
        failedPaymentCount: true,
        preReminder7dSentFor: true,
        preReminder3dSentFor: true,
        preReminderTodaySentFor: true,
        paymentReminderSentFor: true,
        manualPayment: true,
        businessGroupId: true,
        isCampaignHost: true,
        hotmartSubscriberCode: true,
        stripeSubscriptionId: true,
        whiteLabelId: true,
        whiteLabel: { select: { slug: true, paymentGateway: true, creditsUnlimited: true } },
      },
    });

    console.log(`Arqueo del ciclo de cobro - ${ahora.toISOString()}`);
    console.log(`Tenants ACTIVE (no borrados): ${ts.length}`);
    const sinFecha = ts.filter((t) => !t.currentPeriodEnd);
    console.log(`  sin currentPeriodEnd (cuenta gratis/ilimitada): ${sinFecha.length}`);
    const conFecha = ts.filter((t) => t.currentPeriodEnd);

    // 1. Fecha en el pasado
    const vencidos = conFecha
      .map((t) => ({ t, d: dias(ahora, t.currentPeriodEnd) }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d);
    const enAvisos = vencidos.filter((x) => entraEnAvisos(x.t));
    console.log(`\n1) currentPeriodEnd EN EL PASADO: ${vencidos.length}`);
    console.log(
      `   - con cobro fallido marcado (failedPaymentCount>0): ${vencidos.filter((x) => x.t.failedPaymentCount > 0).length}`,
    );
    console.log(
      `   - sin fallo marcado (solo fecha vencida):          ${vencidos.filter((x) => !(x.t.failedPaymentCount > 0)).length}`,
    );
    console.log(`   - 1-5 dias (en gracia):    ${vencidos.filter((x) => x.d <= 5).length}`);
    console.log(`   - 6-60 dias:               ${vencidos.filter((x) => x.d > 5 && x.d <= 60).length}`);
    console.log(
      `   - >60 dias (tope legacy, el cron NO suspende por fecha): ${vencidos.filter((x) => x.d > 60).length}`,
    );
    console.log(
      `   - que entran en los crons de avisos (Clubify/Stripe): ${enAvisos.length}; el resto son marcas por creditos (cron de renovaciones)`,
    );
    const porMarca = {};
    for (const x of vencidos) porMarca[marca(x.t)] = (porMarca[marca(x.t)] || 0) + 1;
    console.log(
      `   - por marca: ${Object.entries(porMarca)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`,
    );

    // 2. Marca del aviso D-7 distinta de la fecha
    const conMarca7 = conFecha.filter((t) => t.preReminder7dSentFor);
    const desc7 = conMarca7.filter(
      (t) => t.preReminder7dSentFor.getTime() !== t.currentPeriodEnd.getTime(),
    );
    const retrocedio = desc7.filter(
      (t) => t.preReminder7dSentFor.getTime() > t.currentPeriodEnd.getTime(),
    );
    const avanzo = desc7.filter(
      (t) => t.preReminder7dSentFor.getTime() < t.currentPeriodEnd.getTime(),
    );
    console.log(
      `\n2) preReminder7dSentFor distinto de currentPeriodEnd: ${desc7.length} (de ${conMarca7.length} con marca)`,
    );
    console.log(`   - la fecha RETROCEDIO despues de avisar (patron Quipao): ${retrocedio.length}`);
    console.log(`   - la fecha avanzo sin reset de la marca (ciclo nuevo):    ${avanzo.length}`);

    // 3. lastChargeAt + periodicidad vs currentPeriodEnd
    const conAmbas = conFecha.filter((t) => t.lastChargeAt);
    const descuadre = conAmbas
      .map((t) => {
        const esperado = sumarPeriodo(t.lastChargeAt, t.planPeriodicity);
        const delta = t.currentPeriodEnd.getTime() - esperado.getTime();
        return { t, esperado, delta };
      })
      .filter((x) => Math.abs(x.delta) > TOLERANCIA_MS)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const antes = descuadre.filter((x) => x.delta < 0);
    const despues = descuadre.filter((x) => x.delta > 0);
    console.log(
      `\n3) lastChargeAt + periodo distinto de currentPeriodEnd (+-2 dias): ${descuadre.length} (de ${conAmbas.length} con ambas fechas)`,
    );
    console.log(
      `   - fecha ANTES de lo esperado (paidButStale: el cron la empuja solo): ${antes.length}`,
    );
    console.log(
      `   - fecha DESPUES de lo esperado (alguien la movio mas alla):         ${despues.length}`,
    );
    console.log(`   - sin lastChargeAt (no se puede contrastar): ${conFecha.length - conAmbas.length}`);

    // Los peores
    const fila = (t, extra) =>
      `   ${nombre(t)} ${marca(t).padEnd(9)} ${(t.planPeriodicity || 'MENSUAL').padEnd(10)} ` +
      `fin=${ymd(t.currentPeriodEnd)} ultCobro=${ymd(t.lastChargeAt)} d7=${ymd(t.preReminder7dSentFor)} ` +
      `fallos=${t.failedPaymentCount}${t.firstFailedAt ? ` 1erFallo=${ymd(t.firstFailedAt)}` : ''}` +
      `${t.manualPayment ? ' porFuera' : ''}${t.businessGroupId ? ' grupo' : ''}` +
      `${t.hotmartSubscriberCode ? ' hotmart' : ''}${t.stripeSubscriptionId ? ' stripe' : ''}` +
      (extra ? `  ${extra}` : '');

    console.log(`\nPEORES 10 - fecha vencida (mas dias primero):`);
    for (const x of vencidos.slice(0, FULL ? vencidos.length : 10)) {
      console.log(fila(x.t, `vencido hace ${x.d}d`));
    }

    console.log(`\nTODOS - la fecha retrocedio despues de avisar (patron Quipao): ${retrocedio.length}`);
    for (const t of retrocedio) {
      console.log(
        fila(t, `aviso para ${ymd(t.preReminder7dSentFor)}, hoy dice ${ymd(t.currentPeriodEnd)}`),
      );
    }

    console.log(
      `\nPEORES 10 - lastChargeAt + periodo distinto de currentPeriodEnd (mayor diferencia primero):`,
    );
    for (const x of descuadre.slice(0, FULL ? descuadre.length : 10)) {
      console.log(
        fila(x.t, `esperado=${ymd(x.esperado)} (${x.delta > 0 ? '+' : ''}${Math.round(x.delta / DIA_MS)}d)`),
      );
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
