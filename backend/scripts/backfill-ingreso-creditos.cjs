/**
 * Pone en Contabilidad el dinero de los «servicios adicionales» ya cobrados.
 *
 * Javier decidió el 2026-09-09 que estas compras SÍ son ingreso —packs de
 * créditos y «Descuento de Implementación»—, revirtiendo la decisión del
 * 2026-09-05. El webhook ya lo registra de aquí en adelante; esto tapa el
 * histórico: 18 transacciones desde el 2026-07-31.
 *
 * Idempotente: la clave (gateway, externalTxId) es única, así que correrlo dos
 * veces no duplica nada. Aditivo: no toca comisiones, ni negocios, ni créditos.
 *
 *   node scripts/backfill-ingreso-creditos.cjs            (simulación)
 *   node scripts/backfill-ingreso-creditos.cjs --escribir (de verdad)
 *
 * La regla del importe es la MISMA que la del webhook y vive en
 * `src/billing/precio-de-pack.ts`. Aquí se replica en JS plano porque este
 * script corre sin compilar TypeScript; si cambia una, cambia la otra —los
 * tests de `precio-de-pack.spec.ts` son el contrato.
 */
const { PrismaClient } = require('@prisma/client');

const ESCRIBIR = process.argv.includes('--escribir');
const TECHO_USD = 600;
const round2 = (n) => Math.round(n * 100) / 100;

const monedaDe = (p) =>
  ((p && (p.currency_code || p.currency_value)) || '').trim().toUpperCase();

function usdDe(p) {
  const v = p && p.value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  if (monedaDe(p) !== 'USD') return null;
  if (v > TECHO_USD) return null;
  return v;
}

/** Espejo de `precioDePackUsd`. */
function precioDePackUsd(compra, pack) {
  const oferta = usdDe(compra && compra.original_offer_price);
  if (oferta != null) return { usd: oferta, fuente: 'oferta' };
  const pagado = usdDe(compra && compra.price);
  if (pagado != null) return { usd: pagado, fuente: 'pagado' };
  const moneda = ((pack && pack.currency) || '').trim().toUpperCase();
  const configurado = Number(pack && pack.price);
  if (moneda === 'USD' && Number.isFinite(configurado) && configurado > 0) {
    return { usd: configurado, fuente: 'pack' };
  }
  return { usd: null, fuente: null };
}

/** Mes contable en hora de Bogotá (UTC-5), igual que `common/periodo-contable`. */
function mesContable(d) {
  const bogota = new Date(d.getTime() - 5 * 60 * 60 * 1000);
  return `${bogota.getUTCFullYear()}-${String(bogota.getUTCMonth() + 1).padStart(2, '0')}`;
}

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

    // Las tasas configurables, para que el desglose salga igual que el del
    // webhook. Si no están puestas, cero — que es lo que hay hoy.
    const settings = await prisma.setting.findMany({
      where: { key: { in: ['finance.gatewayFeePct.HOTMART', 'finance.taxPct', 'finance.taxBase'] } },
    });
    const val = (k) => (settings.find((s) => s.key === k) || {}).value;
    const feePct = Number((val('finance.gatewayFeePct.HOTMART') || '0').replace(',', '.')) || 0;
    const taxPct = Number((val('finance.taxPct') || '0').replace(',', '.')) || 0;
    const taxIncluido = (val('finance.taxBase') || 'gross').trim() === 'included';

    console.log(`${ESCRIBIR ? 'ESCRIBIENDO' : 'SIMULACION (usa --escribir)'}`);
    console.log(`Compras a revisar: ${compras.length}`);
    console.log(`Tasas: fee ${feePct}%  impuesto ${taxPct}% (${taxIncluido ? 'incluido' : 'sobre bruto'})\n`);

    let creados = 0;
    let yaEstaban = 0;
    let sinImporte = 0;
    let total = 0;

    for (const c of compras) {
      const compra = (c.rawPayload && c.rawPayload.data && c.rawPayload.data.purchase) || {};
      const { usd, fuente } = precioDePackUsd(compra, c.creditLink);
      const etiqueta =
        (compra.offer && (compra.offer.description || compra.offer.name)) ||
        (c.creditLink && c.creditLink.label) ||
        'Servicios adicionales';
      const fecha = compra.approved_date ? new Date(compra.approved_date) : c.createdAt;

      if (usd == null) {
        sinImporte += 1;
        console.log(`  SIN IMPORTE  tx=${c.transactionId}  "${etiqueta}"  — no se registra`);
        continue;
      }

      const dup = await prisma.incomeRecord.findUnique({
        where: { gateway_externalTxId: { gateway: 'HOTMART', externalTxId: c.transactionId } },
        select: { id: true },
      });
      if (dup) {
        yaEstaban += 1;
        console.log(`  YA ESTABA    tx=${c.transactionId}  $${usd}`);
        continue;
      }

      const fee = round2((usd * feePct) / 100);
      const tax = taxIncluido
        ? round2(usd - usd / (1 + taxPct / 100))
        : round2((usd * taxPct) / 100);

      total += usd;
      creados += 1;
      console.log(
        `  ${ESCRIBIR ? 'CREADO' : 'CREARIA'}  ${fecha.toISOString().slice(0, 10)}  ` +
          `$${String(usd).padStart(7)}  (${fuente})  marca=${(c.whiteLabel && c.whiteLabel.name) || 'sin asignar'}  "${etiqueta}"`,
      );

      if (!ESCRIBIR) continue;
      await prisma.incomeRecord.create({
        data: {
          gateway: 'HOTMART',
          externalTxId: c.transactionId,
          tenantId: null,
          whiteLabelId: c.whiteLabelId,
          productName: etiqueta,
          currency: 'USD',
          grossUsd: usd,
          gatewayFeeUsd: fee,
          taxUsd: tax,
          otherDiscountUsd: 0,
          netExpectedUsd: round2(usd - fee - tax),
          isFirstPayment: false,
          periodKey: mesContable(fecha),
          saleDate: fecha,
          reconStatus: 'PENDING',
          note: 'Backfill 2026-09-09 · servicios adicionales (creditos / implementacion)',
        },
      });
    }

    console.log(
      `\n${ESCRIBIR ? 'Creados' : 'Se crearian'}: ${creados}  ·  ya estaban: ${yaEstaban}  ·  ` +
        `sin importe: ${sinImporte}  ·  total $${round2(total)}`,
    );
    if (!ESCRIBIR) console.log('Nada escrito. Volvé a correrlo con --escribir.');
  } finally {
    await prisma.$disconnect();
  }
})();
