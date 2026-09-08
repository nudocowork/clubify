/**
 * SOLO LECTURA: qué hay en Contabilidad y qué falta desde mayo.
 *
 * `IncomeRecord` lo escriben los webhooks EN VIVO desde que se encendió el
 * módulo. Todo lo cobrado antes de esa fecha no está: nadie hizo el volcado
 * histórico. Este arqueo mide exactamente cuánto es y de dónde saldría.
 *
 * Fuentes del histórico:
 *   · HotmartWebhookEvent  → el payload crudo de cada cobro (producto 6504901).
 *   · CrossTransaction     → cobros de la pasarela propia.
 *   · ManualPayment        → pagos por fuera.
 *   · Stripe               → invoices (no guardamos crudo; hay que pedirlas).
 *
 * Excluye el producto 7929341 (SERVICIOS ADICIONALES) por decisión del
 * 2026-09-05: no es ingreso de este módulo y da 18 falsos positivos.
 */
const { PrismaClient } = require('@prisma/client');

const PRODUCTO_SUSCRIPCION = '6504901';
const PRODUCTO_EXCLUIDO = '7929341';
const mes = (d) => new Date(d).toISOString().slice(0, 7);

(async () => {
  const p = new PrismaClient();
  try {
    // ── Lo que HAY en Contabilidad ──────────────────────────────────────
    const filas = await p.incomeRecord.findMany({
      select: { periodKey: true, saleDate: true, grossUsd: true, gateway: true },
      orderBy: { saleDate: 'asc' },
    });
    console.log(`IncomeRecord: ${filas.length} filas`);
    if (filas.length) {
      console.log(`  de ${filas[0].saleDate.toISOString().slice(0, 10)} a ${filas[filas.length - 1].saleDate.toISOString().slice(0, 10)}`);
    }
    const porMes = new Map();
    for (const f of filas) {
      const k = f.periodKey ?? mes(f.saleDate);
      const a = porMes.get(k) ?? { n: 0, usd: 0 };
      a.n++;
      a.usd += Number(f.grossUsd);
      porMes.set(k, a);
    }
    console.log('\n  mes        filas    bruto USD');
    for (const k of [...porMes.keys()].sort()) {
      const a = porMes.get(k);
      console.log(`  ${k}    ${String(a.n).padStart(5)}   ${a.usd.toFixed(2).padStart(10)}`);
    }

    // ── Lo que HAY en el histórico de Hotmart ───────────────────────────
    const evs = await p.hotmartWebhookEvent.findMany({
      where: { processedAt: { gte: new Date('2026-05-01T00:00:00Z') } },
      select: { eventId: true, eventType: true, processedAt: true, payload: true },
      orderBy: { processedAt: 'asc' },
    });
    console.log(`\nHotmartWebhookEvent desde mayo: ${evs.length}`);

    const yaEstan = new Set(
      (
        await p.incomeRecord.findMany({
          where: { gateway: 'HOTMART' },
          select: { externalTxId: true },
        })
      ).map((r) => r.externalTxId),
    );

    const faltan = new Map(); // mes → { n, usd }
    const tipos = new Map();
    let excluidos = 0;
    for (const e of evs) {
      const d = e.payload?.data ?? {};
      const productId = String(d.product?.id ?? '');
      if (productId === PRODUCTO_EXCLUIDO) {
        excluidos++;
        continue;
      }
      if (productId && productId !== PRODUCTO_SUSCRIPCION) continue;
      const tx = d.purchase?.transaction ?? null;
      const valor = Number(
        d.purchase?.price?.value ?? d.purchase?.full_price?.value ?? 0,
      );
      const estado = String(d.purchase?.status ?? e.eventType ?? '');
      tipos.set(e.eventType, (tipos.get(e.eventType) ?? 0) + 1);
      if (!tx || !valor || valor <= 0) continue;
      // Solo cobros efectivos.
      if (!/APPROVED|COMPLETE/i.test(estado) && !/PURCHASE_APPROVED|PURCHASE_COMPLETE/i.test(e.eventType)) continue;
      if (yaEstan.has(tx)) continue;
      const k = mes(d.purchase?.order_date ? new Date(d.purchase.order_date) : e.processedAt);
      const a = faltan.get(k) ?? { n: 0, usd: 0 };
      a.n++;
      a.usd += valor;
      faltan.set(k, a);
    }
    console.log(`  (excluidos por ser SERVICIOS ADICIONALES: ${excluidos})`);
    console.log('  tipos de evento:', [...tipos.entries()].map(([k, v]) => `${k}=${v}`).join(' '));

    console.log('\nCOBROS DE HOTMART QUE NO ESTÁN EN CONTABILIDAD');
    console.log('  mes        cobros   bruto USD');
    let tn = 0, tu = 0;
    for (const k of [...faltan.keys()].sort()) {
      const a = faltan.get(k);
      tn += a.n;
      tu += a.usd;
      console.log(`  ${k}    ${String(a.n).padStart(5)}   ${a.usd.toFixed(2).padStart(10)}`);
    }
    console.log(`  TOTAL      ${String(tn).padStart(5)}   ${tu.toFixed(2).padStart(10)}`);

    // ── Otras fuentes ───────────────────────────────────────────────────
    const manuales = await p.manualPayment
      .findMany({ select: { id: true, paidAt: true, createdAt: true, amount: true } })
      .catch(() => []);
    const manualesFuera = manuales.filter(
      (m) => !yaEstan.has(m.id),
    );
    console.log(`\nManualPayment: ${manuales.length} · sin IncomeRecord: ${manualesFuera.length}`);

    const cross = await p.crossTransaction
      .count()
      .catch(() => null);
    console.log(`CrossTransaction: ${cross ?? '(no existe el modelo)'}`);
  } finally {
    await p.$disconnect();
  }
})();
