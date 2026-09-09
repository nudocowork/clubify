/**
 * SOLO LECTURA: qué dinero entró por packs de créditos y si se puede contar.
 *
 * Javier decidió el 2026-09-09 que los créditos SÍ son ingreso (no van a
 * comisiones, no crean negocio, no tienen influencer). Antes de escribir el
 * IncomeRecord hay que saber en qué moneda llegan: Hotmart manda
 * `purchase.price.value` en la moneda de la oferta y a veces sin `currency_code`
 * (ver `resolvePaidUsd` en hotmart.service.ts). Si vienen en MXN, tomarlos como
 * USD infla la contabilidad — que es justo el bug que este módulo vino a cerrar.
 */
const { PrismaClient } = require('@prisma/client');

const round2 = (n) => Math.round(n * 100) / 100;

(async () => {
  const prisma = new PrismaClient();
  try {
    const compras = await prisma.hotmartCreditPurchase.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        creditLink: { select: { label: true, price: true, currency: true } },
        whiteLabel: { select: { name: true } },
      },
    });
    const links = await prisma.hotmartCreditLink.findMany({
      include: { whiteLabel: { select: { name: true } } },
      orderBy: { position: 'asc' },
    });
    console.log('-- Packs configurados --');
    for (const l of links) {
      console.log(
        `  ${l.id.slice(0, 8)}  credits=${String(l.credits).padStart(3)}  "${l.label}"  ` +
          `precio=${l.price ?? '-'} ${l.currency}  prod=${l.hotmartProductId ?? '-'} ` +
          `offer=${l.hotmartOfferCode ?? '-'}  wl=${l.whiteLabel?.name ?? '-'}  activo=${l.isActive}`,
      );
    }

    console.log(`\nCompras de crédito: ${compras.length}\n`);

    const porMoneda = new Map();
    let sinPrecio = 0;
    for (const c of compras) {
      const p = c.rawPayload?.data?.purchase?.price ?? {};
      const value = typeof p.value === 'number' ? p.value : null;
      const ccy = (p.currency_code || p.currency_value || '').toUpperCase() || '(sin moneda)';
      if (value == null) sinPrecio += 1;
      const k = ccy;
      const acc = porMoneda.get(k) ?? { n: 0, suma: 0 };
      acc.n += 1;
      acc.suma += value ?? 0;
      porMoneda.set(k, acc);

      const full = c.rawPayload?.data?.purchase?.full_price ?? null;
      console.log(
        [
          c.createdAt.toISOString().slice(0, 10),
          c.status.padEnd(10),
          (c.whiteLabel?.name ?? '—').padEnd(14),
          `${String(c.credits).padStart(3)} cr`,
          `value=${value ?? '—'} ${ccy}`,
          full ? `full=${full.value} ${full.currency_value ?? full.currency_code ?? ''}` : '',
          `link="${c.creditLink?.label ?? '—'}" precio=${c.creditLink?.price ?? '—'} ${c.creditLink?.currency ?? ''}`,
        ].join('  '),
      );
    }

    console.log('\n── Por moneda ──');
    for (const [ccy, a] of porMoneda) {
      console.log(`  ${ccy.padEnd(14)} ${String(a.n).padStart(3)} compras  suma=${round2(a.suma)}`);
    }
    console.log(`  sin price.value: ${sinPrecio}`);

    // ¿Alguna ya tiene IncomeRecord? (no debería: hoy no se escribe ninguno)
    const ids = compras.map((c) => c.transactionId);
    const ya = await prisma.incomeRecord.findMany({
      where: { gateway: 'HOTMART', externalTxId: { in: ids } },
      select: { externalTxId: true, grossUsd: true },
    });
    console.log(`\nCompras que YA tienen IncomeRecord: ${ya.length}`);
    for (const r of ya) console.log(`  ${r.externalTxId} $${r.grossUsd}`);
  } finally {
    await prisma.$disconnect();
  }
})();
