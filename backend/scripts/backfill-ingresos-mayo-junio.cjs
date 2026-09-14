// Relleno de los cobros de MAYO y de la primera quincena de JUNIO de 2026 en
// Contabilidad (`IncomeRecord`), reconstruidos desde lo que quedó en la base.
//
// EL HUECO (Sara, 2026-09-14): «en mayo no hay data de pago» en Contabilidad,
// pero Comisiones sí enseña negocios que entraron en mayo y a principios de
// junio. Es cierto: el crudo de Hotmart (`HotmartWebhookEvent`) empieza el
// 14-jun y `PendingHotmartPayment` el 11-jun. Todo cobro anterior se procesó
// sin guardar el payload, así que ningún conciliador puede recuperarlo por
// transacción. Lo único que quedó de esos cobros es su DERIVADO: la comisión.
//
// DE DÓNDE SALE CADA FILA. Para cada negocio con comisión de primer ciclo
// fechada antes del 14-jun y sin ningún cobro en el libro antes de esa fecha:
//   · la FECHA es el `businessDate` de esa comisión — lo que Comisiones enseña
//     y Sara ya está usando —, contrastada con el ciclo de renovación que SÍ
//     está en el crudo (un mensual comprado el 26-may tiene su siguiente cobro
//     el 26-jun; un trimestral del 30-may renueva el 30/31-ago). El ensayo
//     imprime esa contrastación negocio por negocio.
//   · el IMPORTE es el precio del PLAN, no lo que cobró la pasarela: la misma
//     política que rige todo el libro desde el 2026-09-03 (precio pactado del
//     negocio → canónico de su periodicidad). Se cruza con la comisión: un 10 %
//     de $50 son $5, y si no cuadra se avisa.
//   · la PASARELA es Hotmart: todos traen `hotmartSubscriberCode` real (no los
//     marcadores `wl-`/`comp-`/`dup-`/`SIMTX`). Sin código real no se rellena.
//
// QUÉ NO HACE. No toca `Commission` (territorio de Jhon: solo lectura). No
// adivina: si falta la periodicidad y el precio pactado, la fila se queda fuera
// y se reporta. No borra ni cambia filas existentes (la anulada de BUENOS DIAZ
// del 01-abr se queda como está; se menciona en la nota).
//
// IDEMPOTENTE. Una fila por negocio, con `externalTxId = backfill-mayo-<tenantId>`
// —el prefijo `backfill-` es el que el conciliador ya reconoce como relleno
// (`ES_DE_RELLENO`)— y el índice único (gateway, externalTxId) hace imposible
// duplicarla. Además salta cualquier negocio que ya tenga un cobro PAGADO antes
// del 14-jun o un cobro del mismo día e importe. Correrlo dos veces no cambia
// nada.
//
// Ensayo por defecto; escribe solo con --aplicar.
// Uso: cd backend && railway run --service Postgres-Nq8w node scripts/backfill-ingresos-mayo-junio.cjs [--aplicar]
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');

/** Desde cuándo hay crudo de Hotmart en el libro. Antes de esto está el hueco. */
const INICIO_DEL_LIBRO = new Date('2026-06-14T00:00:00.000Z');
/** Nada anterior a la venta más antigua con rastro (Wok Explosivo, 26-may). */
const PRIMERA_VENTA_CON_RASTRO = new Date('2026-05-26T00:00:00.000Z');

/** Los mismos canónicos de `common/plan-pricing.ts`, con override por Setting. */
const CANONICOS = { MENSUAL: 68, TRIMESTRAL: 150, SEMESTRAL: 278, ANUAL: 500 };
const PERIODOS = new Set(Object.keys(CANONICOS));

/**
 * Excepciones a «la fecha es la de Comisiones», con su razón. Solo entran aquí
 * los casos en los que el `businessDate` es el fallback `createdAt` del backfill
 * (la comisión se creó en lote días después) y otra evidencia da el día real.
 */
const FECHA_CORREGIDA = {
  // AutoTech Services: la comisión dice 13-jun porque se creó en lote ese día.
  // El negocio se dio de alta el 02-jun, `lastChargeAt` es 01-jun y Hotmart
  // avisó del cobro mensual siguiente RETRASADO el 01-jul → compra el 01-jun.
  'f1e409bd-3233-4927-afd4-e527ade613a6': {
    dia: '2026-06-01',
    razon: 'businessDate 13-jun es el createdAt del lote; alta 02-jun, lastChargeAt 01-jun y PURCHASE_DELAYED del 01-jul → 01-jun',
  },
};

const round2 = (n) => Math.round(n * 100) / 100;
const usd = (n) => (n == null ? '—' : '$' + round2(Number(n)).toFixed(2));
const d10 = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
/** Día calendario en Bogotá, que es como lo ve el panel de Comisiones. */
const diaBogota = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
/** Mediodía de Bogotá (17:00 UTC): el día no se corre por zona horaria. */
const alMediodiaBogota = (ymd) => new Date(`${ymd}T17:00:00.000Z`);
const esCodigoHotmartReal = (c) => !!c && !/^(wl-|comp-|dup-|SIMTX)/i.test(c);

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const host = new URL(url).hostname;
  if (/localhost|127\.0\.0\.1|railway\.internal/.test(host)) {
    console.error(`Este script es para producción y ${host} no lo es.`);
    process.exit(1);
  }
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ db }] = await p.$queryRawUnsafe('SELECT current_database() AS db');
    console.log(`base: ${db} @ ${host} · ${APLICAR ? '*** APLICANDO ***' : 'ENSAYO (no escribe nada)'}\n`);

    // ── Tasas y precios, los mismos que usa la captura en vivo ─────────────
    const settings = await p.setting.findMany({ where: { OR: [{ key: { startsWith: 'finance.' } }, { key: { startsWith: 'landing.plans.' } }] } });
    const S = Object.fromEntries(settings.map((s) => [s.key, s.value]));
    const pct = (k) => { const n = Number(String(S[k] ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
    const feePct = pct('finance.gatewayFeePct.HOTMART');
    const taxPct = pct('finance.taxPct');
    const taxIncluido = (S['finance.taxBase'] ?? 'gross').trim() === 'included';
    const canonico = (periodicidad) => {
      const per = PERIODOS.has(periodicidad) ? periodicidad : null;
      if (!per) return null;
      const override = Number(S[`landing.plans.${per.toLowerCase()}.price`]);
      return Number.isFinite(override) && override > 0 ? override : CANONICOS[per];
    };
    console.log(`tasas: fee Hotmart ${feePct}% · impuesto ${taxPct}% (${taxIncluido ? 'incluido' : 'sobre bruto'})`);
    console.log(`canónicos: ${Object.keys(CANONICOS).map((k) => `${k} ${usd(canonico(k))}`).join(' · ')}\n`);

    const clubify = await p.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });

    // ── 1. Lo que ya está en el libro ──────────────────────────────────────
    const libro = await p.incomeRecord.findMany({
      select: { gateway: true, externalTxId: true, tenantId: true, grossUsd: true, saleDate: true, status: true, note: true },
    });
    const claves = new Set(libro.map((r) => `${r.gateway}|${r.externalTxId}`));
    const porTenant = new Map();
    for (const r of libro) {
      if (!r.tenantId) continue;
      if (!porTenant.has(r.tenantId)) porTenant.set(r.tenantId, []);
      porTenant.get(r.tenantId).push(r);
    }

    // ── 2. Los negocios cuya PRIMERA comisión es anterior al 14-jun ────────
    const comisiones = await p.commission.findMany({
      where: { status: { not: 'REJECTED' }, referralUse: { tenantId: { not: null } } },
      select: {
        id: true, amount: true, businessDate: true, createdAt: true,
        recipientCode: { select: { role: true, code: true } },
        referralUse: { select: { tenantId: true, convertedAt: true } },
      },
    });
    const primera = new Map(); // tenantId → { fecha, comisiones de ese mismo día }
    for (const c of comisiones) {
      const t = c.referralUse.tenantId;
      const fecha = new Date(c.businessDate ?? c.createdAt);
      const cur = primera.get(t);
      if (!cur || fecha < cur.fecha) primera.set(t, { fecha, sinBusinessDate: !c.businessDate, filas: [c] });
      else if (diaBogota(fecha) === diaBogota(cur.fecha)) cur.filas.push(c);
    }
    const candidatos = [...primera.entries()].filter(([, v]) => v.fecha < INICIO_DEL_LIBRO);

    const tenants = await p.tenant.findMany({
      where: { id: { in: candidatos.map(([id]) => id) } },
      select: {
        id: true, brandName: true, status: true, deletedAt: true, createdAt: true, purchasedAt: true,
        lastChargeAt: true, planId: true, planPeriodicity: true, subscriptionPriceUsd: true,
        lastPaymentAmountUsd: true, hotmartSubscriberCode: true, hotmartTransactionId: true,
        whiteLabelId: true, whiteLabel: { select: { slug: true } },
      },
    });
    const tenantPorId = new Map(tenants.map((t) => [t.id, t]));

    // Los eventos de Hotmart del negocio, para contrastar el ciclo.
    const eventos = await p.hotmartWebhookEvent.findMany({
      where: { tenantId: { in: tenants.map((t) => t.id) } },
      select: { tenantId: true, eventType: true, processedAt: true, payload: true },
      orderBy: { processedAt: 'asc' },
    });
    const eventosPorTenant = new Map();
    for (const e of eventos) {
      if (!eventosPorTenant.has(e.tenantId)) eventosPorTenant.set(e.tenantId, []);
      eventosPorTenant.get(e.tenantId).push(e);
    }

    // ── 3. Decidir fila por fila ───────────────────────────────────────────
    const aCrear = [];
    const fuera = [];
    for (const [tenantId, pc] of candidatos.sort((a, b) => a[1].fecha - b[1].fecha)) {
      const t = tenantPorId.get(tenantId);
      const nombre = t?.brandName ?? tenantId;
      if (!t) { fuera.push({ nombre, motivo: 'el negocio ya no existe' }); continue; }

      const enLibro = (porTenant.get(tenantId) ?? []);
      const yaAntes = enLibro.filter((r) => r.status === 'PAGADO' && r.saleDate < INICIO_DEL_LIBRO);
      if (yaAntes.length) {
        fuera.push({ nombre, motivo: `ya tiene cobro en el libro antes del 14-jun (${yaAntes.map((r) => `${d10(r.saleDate)} ${usd(r.grossUsd)} tx=${r.externalTxId}`).join(', ')})` });
        continue;
      }
      const clave = `backfill-mayo-${tenantId}`;
      if (claves.has(`HOTMART|${clave}`)) { fuera.push({ nombre, motivo: 'ya estaba (misma clave de relleno)' }); continue; }

      if (!esCodigoHotmartReal(t.hotmartSubscriberCode)) {
        fuera.push({ nombre, motivo: `sin código de suscriptor real de Hotmart (${t.hotmartSubscriberCode ?? 'null'}): no se sabe por qué pasarela cobró` });
        continue;
      }

      // Fecha: la de Comisiones, salvo excepción documentada.
      const corregida = FECHA_CORREGIDA[tenantId];
      const dia = corregida ? corregida.dia : diaBogota(pc.fecha);
      const saleDate = alMediodiaBogota(dia);
      if (saleDate < PRIMERA_VENTA_CON_RASTRO) { fuera.push({ nombre, motivo: `fecha ${dia} anterior a la primera venta con rastro (26-may)` }); continue; }
      if (saleDate >= INICIO_DEL_LIBRO) { fuera.push({ nombre, motivo: `fecha corregida ${dia} ya cae dentro del crudo de Hotmart` }); continue; }

      // Importe: precio del plan. Nunca el monto FX ni un número inventado.
      const pactado = t.subscriptionPriceUsd == null ? null : Number(t.subscriptionPriceUsd);
      const gross = pactado != null && pactado > 0 ? pactado : canonico(t.planPeriodicity);
      const origenImporte = pactado != null && pactado > 0 ? `precio pactado ${usd(pactado)}` : `canónico ${t.planPeriodicity ?? '?'} ${usd(gross)}`;
      if (!(gross > 0)) { fuera.push({ nombre, motivo: `sin precio pactado ni periodicidad (${t.planPeriodicity ?? 'null'}): no se puede saber cuánto pagó` }); continue; }

      // Cruces (informativos): comisión ↔ importe, y ciclo de renovación ↔ fecha.
      // Cada comisión del día tiene que ser un porcentaje REDONDO (múltiplo de
      // 5 %) del importe: $5 son el 10 % de $50; $12,50 y $62,50 son el 5 % y
      // el 25 % de $250. Si ninguna tasa razonable lo explica, el precio del
      // plan que tiene hoy el negocio no es el que tenía cuando compró.
      const porcentajes = pc.filas.map((c) => (Number(c.amount) / gross) * 100);
      const cuadraComision = porcentajes.every((x) => Math.abs(x - Math.round(x)) < 0.02 && Math.round(x) % 5 === 0 && x >= 1 && x <= 50);
      const tasas = porcentajes.map((x) => `${Math.round(x * 100) / 100} %`).join(' + ');
      const cobros = (eventosPorTenant.get(tenantId) ?? [])
        .filter((e) => /^(PURCHASE_APPROVED|PURCHASE_DELAYED|PURCHASE_BILLET_PRINTED)$/.test(e.eventType))
        .map((e) => `${d10(e.processedAt)} ${e.eventType.replace('PURCHASE_', '')}`);
      const mismoDiaImporte = enLibro.find((r) => diaBogota(r.saleDate) === dia && Math.abs(Number(r.grossUsd) - gross) < 0.01);
      if (mismoDiaImporte) { fuera.push({ nombre, motivo: `ya hay un cobro de ${usd(gross)} el ${dia} (tx=${mismoDiaImporte.externalTxId}, ${mismoDiaImporte.status})` }); continue; }

      const fee = round2((gross * feePct) / 100);
      const tax = taxIncluido ? round2(gross - gross / (1 + taxPct / 100)) : round2((gross * taxPct) / 100);
      const anulada = enLibro.find((r) => r.status === 'CANCELADO');
      const nota =
        `Reconstruido el 2026-09-14 (relleno de mayo/junio, sin evento de pasarela: el crudo de Hotmart empieza el 14-jun). ` +
        `Fecha: ${corregida ? corregida.razon : `businessDate de la 1ª comisión (${pc.filas.map((c) => c.id).join(', ')}), la que enseña Comisiones`}. ` +
        `Importe: ${origenImporte}${cuadraComision ? ' (cuadra con la comisión)' : ''}. ` +
        `Hotmart: suscriptor ${t.hotmartSubscriberCode}${t.hotmartTransactionId ? `, última transacción conocida ${t.hotmartTransactionId}` : ''}.` +
        (anulada ? ` La fila anulada del ${d10(anulada.saleDate)} (tx=${anulada.externalTxId}) era este mismo cobro con fecha semilla; se deja anulada.` : '');

      aCrear.push({
        nombre, t, dia, corregida: !!corregida, origenImporte, cuadraComision, tasas, cobros, pc,
        data: {
          gateway: 'HOTMART', externalTxId: clave, tenantId, whiteLabelId: t.whiteLabelId ?? null,
          brandName: t.brandName, planId: t.planId ?? null, planPeriodicity: t.planPeriodicity ?? null,
          productName: null, currency: 'USD', grossUsd: gross, gatewayFeeUsd: fee, taxUsd: tax,
          otherDiscountUsd: 0, netExpectedUsd: round2(gross - fee - tax), isFirstPayment: true,
          category: 'NUEVA', status: 'PAGADO', periodKey: dia.slice(0, 7), saleDate,
          reconStatus: 'PENDING', note: nota,
        },
      });
    }

    // ── 4. Ensayo: lo que se crearía y lo que queda fuera ──────────────────
    console.log(`negocios con primera comisión antes del 14-jun: ${candidatos.length}`);
    console.log(`filas a crear: ${aCrear.length} · fuera: ${fuera.length}\n`);
    for (const f of aCrear) {
      const t = f.t;
      console.log(`  ${f.dia}  ${usd(f.data.grossUsd).padStart(8)}  ${f.nombre}  [${t.status}${t.deletedAt ? ' · BORRADO' : ''}]  marca=${t.whiteLabel?.slug ?? 'null'}`);
      console.log(`      fecha: ${f.corregida ? 'CORREGIDA — ' + FECHA_CORREGIDA[t.id].razon : `Comisiones (businessDate ${d10(f.pc.fecha)}${f.pc.sinBusinessDate ? ', que es createdAt' : ''})`}` +
        ` · alta ${d10(t.createdAt)} · compra ${d10(t.purchasedAt)} · últimoCobro ${d10(t.lastChargeAt)} · convertido ${d10(f.pc.filas[0]?.referralUse?.convertedAt)}`);
      console.log(`      importe: ${f.origenImporte} · comisión ${f.pc.filas.map((c) => `${usd(c.amount)} ${c.recipientCode?.role ?? '?'}`).join(' + ')} = ${f.tasas} del importe ${f.cuadraComision ? '✓' : '✗ NO CUADRA'}`);
      console.log(`      ciclo en el crudo: ${f.cobros.length ? f.cobros.slice(0, 5).join(' · ') + (f.cobros.length > 5 ? ' …' : '') : '(sin eventos de cobro después del 14-jun)'}`);
      console.log(`      clave: ${f.data.externalTxId} · periodo ${f.data.periodKey} · plan ${t.planPeriodicity ?? '—'} · sub=${t.hotmartSubscriberCode} tx=${t.hotmartTransactionId ?? '—'}`);
    }
    console.log('\n  fuera:');
    for (const f of fuera) console.log(`    · ${f.nombre}: ${f.motivo}`);

    const porMes = new Map();
    for (const f of aCrear) {
      const m = porMes.get(f.data.periodKey) ?? { n: 0, bruto: 0 };
      m.n += 1; m.bruto = round2(m.bruto + f.data.grossUsd);
      porMes.set(f.data.periodKey, m);
    }
    console.log('\n  totales que se añadirían al libro:');
    for (const [m, v] of [...porMes.entries()].sort()) console.log(`    ${m}  ${String(v.n).padStart(3)} cobros  ${usd(v.bruto).padStart(10)}`);
    const sinCuadre = aCrear.filter((f) => !f.cuadraComision);
    if (sinCuadre.length) console.log(`\n  ⚠ ${sinCuadre.length} fila(s) cuyo importe no cuadra con la comisión: revisar antes de aplicar.`);
    if (clubify) {
      const deOtraMarca = aCrear.filter((f) => f.t.whiteLabelId && f.t.whiteLabelId !== clubify.id);
      if (deOtraMarca.length) console.log(`  ⚠ ${deOtraMarca.length} fila(s) de una marca distinta de Clubify: ${deOtraMarca.map((f) => f.nombre).join(', ')}`);
    }

    if (!APLICAR) {
      console.log('\n-- ENSAYO. No se escribió nada. Con --aplicar se crean las filas de arriba.');
      return;
    }

    // ── 5. Aplicar: una a una, y el índice único decide si ya estaba ───────
    let creadas = 0, yaEstaban = 0;
    for (const f of aCrear) {
      try {
        await p.incomeRecord.create({ data: f.data });
        creadas += 1;
        console.log(`  creada  ${f.dia} ${usd(f.data.grossUsd)} ${f.nombre}`);
      } catch (e) {
        if (e?.code === 'P2002') { yaEstaban += 1; console.log(`  ya estaba ${f.nombre}`); }
        else throw e;
      }
    }
    const total = await p.incomeRecord.aggregate({ where: { status: 'PAGADO' }, _sum: { grossUsd: true }, _count: { _all: true } });
    console.log(`\ncreadas ${creadas} · ya estaban ${yaEstaban} · libro: ${total._count._all} cobros PAGADO · ${usd(total._sum.grossUsd)}`);
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error(e); process.exit(1); });
