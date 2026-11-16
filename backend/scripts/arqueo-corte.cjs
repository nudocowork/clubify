// SOLO LECTURA. Arqueo de un corte de comisiones (Sara, 2026-11-16, «Corte 21»
// = CORTE-2026-11-15, ventana 1→15 nov).
//
//  1. Cada pago del reporte de Hotmart (TSV con tx, oferta, fecha, correo,
//     suscriptor, usd) está registrado en Contabilidad.
//  2. Cada pago tiene a quién comisionarle (afiliado / venta directa).
//  3. Cada pago con afiliado generó su comisión, incluidos los pagos manuales.
//  4. Cada comisión está en el corte que le toca (por su `availableAt`).
//  5. La comisión de equipo de Sara = 2 % de los ingresos de la quincena.
//  6. La comisión del socio NO va en un corte de mitad de mes.
//
//   railway run ... node scripts/arqueo-corte.cjs <reporte.tsv> 2026-11-15
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });

const [archivo, corteYmd = '2026-11-15'] = process.argv.slice(2);
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—');
const r2 = (n) => Math.round(n * 100) / 100;
// Bogotá = UTC-5, sin horario de verano.
const inicioBog = (ymd) => new Date(`${ymd}T05:00:00.000Z`);
const finBog = (ymd) => new Date(new Date(`${ymd}T05:00:00.000Z`).getTime() + 86400000);
const DIA = 86400000;

(async () => {
  const lote = await p.payoutBatch.findUnique({ where: { code: `CORTE-${corteYmd}` } });
  if (!lote) throw new Error('no existe el corte');
  const [y, m, dd] = corteYmd.split('-').map(Number);
  const desdeYmd = `${corteYmd.slice(0, 8)}${dd <= 15 ? '01' : '16'}`;
  console.log(`=== ${lote.code} (${lote.status}) ventana ${desdeYmd}→${corteYmd} · total guardado $${lote.totalUsd}`);

  const clubify = await p.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } });
  const deClubify = { OR: [{ whiteLabelId: clubify?.id ?? null }, { whiteLabelId: null }] };

  const SEL = {
    id: true, amount: true, baseAmountUsd: true, appliedPercent: true, status: true, paymentStatus: true, amountPaid: true,
    businessDate: true, createdAt: true, availableAt: true, hotmartTransactionId: true, externalTxId: true, periodKey: true,
    payoutBatch: { select: { code: true } },
    recipientCode: { select: { code: true, ownerName: true, role: true } },
    referralUse: { select: { tenantId: true, tenant: { select: { brandName: true } } } },
    businessGroup: { select: { id: true, name: true } },
  };
  const quien = (c) => `${c.recipientCode?.ownerName ?? '¿sin dueño?'} (${c.recipientCode?.role ?? '—'})`;
  const linea = (c) => `$${Number(c.amount)} a ${quien(c)} · base ${c.baseAmountUsd ?? '—'} · ${c.status}/${c.paymentStatus} · disp. ${d(c.availableAt)} · corte ${c.payoutBatch?.code ?? 'NINGUNO'}${c.periodKey ? ' · ' + c.periodKey : ''}`;

  // ── Contenido del corte ──────────────────────────────────────────────────
  const enCorte = await p.commission.findMany({ where: { payoutBatchId: lote.id }, select: SEL, orderBy: { availableAt: 'asc' } });
  console.log(`\n### CONTENIDO DEL CORTE: ${enCorte.length} comisiones, suma $${r2(enCorte.reduce((s, c) => s + Number(c.amount), 0))}`);
  for (const c of enCorte) console.log(`  ${c.referralUse?.tenant?.brandName ?? c.businessGroup?.name ?? '(sin negocio)'} · venta ${d(c.businessDate ?? c.createdAt)} · ${linea(c)}`);

  // Comisiones que por fecha deberían estar y no están, y las retenidas.
  const ventana = { gte: inicioBog(desdeYmd), lt: finBog(corteYmd) };
  const deberian = await p.commission.findMany({
    where: { availableAt: ventana, status: { in: ['APPROVED', 'PAID', 'PENDING'] }, NOT: { payoutBatchId: lote.id } },
    select: SEL,
  });
  console.log(`\n### DISPONIBLES EN LA VENTANA Y FUERA DEL CORTE: ${deberian.length}`);
  for (const c of deberian) console.log(`  ${c.referralUse?.tenant?.brandName ?? c.businessGroup?.name ?? '(sin negocio)'} · ${linea(c)}`);

  // ── Pagos del reporte de Hotmart ─────────────────────────────────────────
  if (archivo) {
    const filas = fs.readFileSync(archivo, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => {
      const [tx, producto, oferta, fecha, estatus, email, suscriptor, usd, origen, gratis] = l.split('\t');
      return { tx, producto, oferta, fecha, estatus, email, suscriptor, usd: Number(usd), origen, gratis };
    });
    console.log(`\n### PAGOS DEL REPORTE DE HOTMART: ${filas.length}`);
    for (const f of filas) {
      const ing = await p.incomeRecord.findFirst({ where: { externalTxId: f.tx }, select: { tenantId: true, businessGroupId: true, brandName: true, grossUsd: true, status: true, category: true } });
      let tenant = ing?.tenantId ? await p.tenant.findUnique({ where: { id: ing.tenantId }, select: { id: true, brandName: true, status: true } }) : null;
      if (!tenant && f.suscriptor) tenant = await p.tenant.findFirst({ where: { hotmartSubscriberCode: f.suscriptor }, select: { id: true, brandName: true, status: true } });
      const grupo = ing?.businessGroupId
        ? await p.businessGroup.findUnique({ where: { id: ing.businessGroupId }, select: { id: true, name: true } })
        : f.suscriptor ? await p.businessGroup.findFirst({ where: { hotmartSubscriberCode: f.suscriptor, deletedAt: null }, select: { id: true, name: true } }) : null;
      const usos = tenant ? await p.referralUse.findMany({ where: { tenantId: tenant.id }, select: { status: true, referralCode: { select: { code: true, ownerName: true, role: true } } } }) : [];
      const fechaPago = new Date(`${f.fecha.replace(' ', 'T')}:00-05:00`);
      const coms = await p.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          OR: [
            { hotmartTransactionId: f.tx }, { externalTxId: f.tx },
            ...(tenant ? [{ referralUse: { tenantId: tenant.id }, businessDate: { gte: new Date(fechaPago.getTime() - 5 * DIA), lte: new Date(fechaPago.getTime() + 5 * DIA) } }] : []),
            ...(grupo ? [{ businessGroupId: grupo.id, businessDate: { gte: new Date(fechaPago.getTime() - 5 * DIA), lte: new Date(fechaPago.getTime() + 5 * DIA) } }] : []),
          ],
          NOT: { periodKey: { startsWith: 'EQUIPO-' } },
        },
        select: SEL,
      });
      const marcas = [];
      if (!ing) marcas.push('⚠ NO ESTÁ EN CONTABILIDAD');
      else if (ing.status !== 'PAGADO') marcas.push(`⚠ en Contabilidad como ${ing.status}`);
      if (!tenant && !grupo) marcas.push('⚠ sin negocio');
      console.log(`\n  ${f.tx} ${f.fecha} ${f.producto} oferta ${f.oferta} $${f.usd} cuota ${f.suscriptor ? '' : '(servicio)'} · ${tenant?.brandName ?? grupo?.name ?? f.email} ${marcas.join(' ')}`);
      if (ing) console.log(`     contabilidad: $${Number(ing.grossUsd)} ${ing.status} ${ing.category}`);
      console.log(`     referidos: ${usos.length ? usos.map((u) => `${u.referralCode?.ownerName} [${u.referralCode?.code}, ${u.referralCode?.role}] ${u.status}`).join(' · ') : 'NINGUNO'}`);
      console.log(`     comisiones: ${coms.length ? '' : 'NINGUNA'}`);
      for (const c of coms) console.log(`       ${linea(c)}`);
    }
  }

  // ── Pagos de Contabilidad de la quincena (base del 2 % de Sara) ─────────
  const ingresos = await p.incomeRecord.findMany({
    where: { AND: [{ status: 'PAGADO', payerWhiteLabelId: null, saleDate: { gte: inicioBog(desdeYmd), lt: finBog(corteYmd) } }, deClubify] },
    select: { externalTxId: true, gateway: true, brandName: true, grossUsd: true, saleDate: true, category: true, tenantId: true },
    orderBy: { saleDate: 'asc' },
  });
  const suma = r2(ingresos.reduce((s, i) => s + Number(i.grossUsd), 0));
  console.log(`\n### INGRESOS ${desdeYmd}→${corteYmd} (Contabilidad, Clubify): ${ingresos.length} · $${suma}`);
  for (const i of ingresos) console.log(`  ${d(i.saleDate)} ${i.gateway} ${i.externalTxId} ${i.brandName ?? '—'} $${Number(i.grossUsd)} ${i.category}`);

  // Pagos de Hotmart de la quincena que NO llegaron a Contabilidad.
  const eventos = await p.$queryRawUnsafe(`
    SELECT DISTINCT ON (tx) tx, oferta, precio, cuando, "tenantId" FROM (
      SELECT e.payload->'data'->'purchase'->>'transaction' tx, e.payload->'data'->'purchase'->'offer'->>'code' oferta,
             (e.payload->'data'->'purchase'->'price'->>'value')::float8 precio, e."processedAt" cuando, e."tenantId"
        FROM "HotmartWebhookEvent" e
       WHERE e."eventType" IN ('PURCHASE_APPROVED','PURCHASE_COMPLETE') AND e."processedAt" >= $1 AND e."processedAt" < $2) x
    ORDER BY tx, cuando`, inicioBog(desdeYmd), new Date(finBog(corteYmd).getTime() + 2 * DIA));
  const txIngresos = new Set((await p.incomeRecord.findMany({ where: { externalTxId: { in: eventos.map((e) => e.tx).filter(Boolean) } }, select: { externalTxId: true } })).map((x) => x.externalTxId));
  const faltan = eventos.filter((e) => e.tx && !txIngresos.has(e.tx) && (e.precio ?? 0) > 0);
  console.log(`\n### PAGOS DE HOTMART DE LA QUINCENA SIN INGRESO: ${faltan.length} (de ${eventos.length} avisos)`);
  for (const e of faltan) console.log(`  ${e.tx} ${d(e.cuando)} oferta ${e.oferta} precio ${e.precio} tenant ${e.tenantId ?? '—'}`);

  // Pagos manuales/otras pasarelas de la quincena y sus comisiones.
  const manuales = ingresos.filter((i) => i.gateway !== 'HOTMART');
  console.log(`\n### PAGOS NO-HOTMART DE LA QUINCENA: ${manuales.length}`);
  for (const i of manuales) {
    const usos = i.tenantId ? await p.referralUse.findMany({ where: { tenantId: i.tenantId }, select: { status: true, referralCode: { select: { ownerName: true, code: true } } } }) : [];
    const coms = i.tenantId ? await p.commission.findMany({ where: { referralUse: { tenantId: i.tenantId }, status: { not: 'REJECTED' }, businessDate: { gte: new Date(i.saleDate.getTime() - 5 * DIA), lte: new Date(i.saleDate.getTime() + 5 * DIA) } }, select: SEL }) : [];
    console.log(`  ${d(i.saleDate)} ${i.gateway} ${i.brandName} $${Number(i.grossUsd)} · referidos: ${usos.map((u) => `${u.referralCode?.ownerName} [${u.referralCode?.code}] ${u.status}`).join(' · ') || 'NINGUNO'}`);
    for (const c of coms) console.log(`     ${linea(c)}`);
  }

  // ── Equipo (Sara) y socio ────────────────────────────────────────────────
  const equipo = await p.commission.findMany({ where: { periodKey: { startsWith: 'EQUIPO-' } }, select: SEL, orderBy: { periodKey: 'asc' } });
  console.log(`\n### COMISIÓN DE EQUIPO (2 %): esperado para ${corteYmd} = 2 % de $${suma} = $${r2(suma * 0.02)}`);
  for (const c of equipo) console.log(`  ${c.periodKey} · ${linea(c)}`);
  const socio = await p.commission.findMany({ where: { periodKey: { startsWith: 'SOCIO-' } }, select: SEL, orderBy: { periodKey: 'asc' } });
  console.log(`\n### COMISIÓN DEL SOCIO`);
  for (const c of socio) console.log(`  ${c.periodKey} · ${linea(c)}`);
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
