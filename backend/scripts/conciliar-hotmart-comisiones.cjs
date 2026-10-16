/**
 * SOLO LECTURA. Cruza el reporte de SUSCRIPCIONES de Hotmart (CSV exportado,
 * separador «;») con lo que quedó en Clubify en un período: si cada cliente
 * tiene negocio, si llegaron los avisos de pago de Hotmart, si el ingreso quedó
 * en Contabilidad y si se generó la comisión cuando hay referido.
 *
 * Por qué hace falta (Javier, 2026-10-16): el reporte de suscripciones de
 * Hotmart solo trae la fecha de ADHESIÓN, no cada renovación. Las renovaciones
 * del período solo se ven cruzando con los avisos (`HotmartWebhookEvent`) y el
 * libro (`IncomeRecord`).
 *
 *   railway run --service backend --environment production node scripts/conciliar-hotmart-comisiones.cjs \
 *     --csv "C:\ruta\suscripciones.csv" --desde 2026-09-15 --hasta 2026-10-16
 *
 * `--hasta` es exclusivo (16 = incluye todo el 15).
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const csv = arg('csv');
// Con `--salida` se escribe en UTF-8 directo: redirigir con «>» en PowerShell 5.1
// lo guardaba en UTF-16 con las tildes rotas (2026-10-16).
const salida = arg('salida');
const lineas = [];
const log = (...a) => {
  const l = a.join(' ');
  lineas.push(l);
  console.log(l);
};
const desde = new Date(`${arg('desde') || '2026-09-15'}T05:00:00Z`); // 00:00 Bogotá
const hasta = new Date(`${arg('hasta') || '2026-10-16'}T05:00:00Z`);
if (!csv || !fs.existsSync(csv)) {
  console.error('Uso: --csv <ruta del CSV de Hotmart> [--desde AAAA-MM-DD] [--hasta AAAA-MM-DD]');
  process.exit(1);
}

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const usd = (n) => `$${Number(n ?? 0).toFixed(2)}`;

function leerCsv(ruta) {
  const lineas = fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const cab = lineas[0].split(';').map((s) => s.replace(/"/g, '').trim());
  const col = (nombre) => cab.findIndex((c) => c.toLowerCase().startsWith(nombre.toLowerCase()));
  const iE = col('Estatus'), iC = col('Cliente'), iCod = col('Código'), iProd = col('Producto'),
    iPlan = col('Plan'), iAd = col('Adhesión'), iCan = col('Cancelación'), iMail = col('Email');
  return lineas.slice(1).map((l) => {
    const c = l.split(';').map((s) => s.replace(/"/g, '').trim());
    const [d, m, a] = (c[iAd] || '').split(' ')[0].split('/');
    return {
      estatus: c[iE], cliente: c[iC], codigo: c[iCod], producto: c[iProd], plan: c[iPlan],
      adhesion: a ? new Date(`${a}-${m}-${d}T12:00:00Z`) : null, cancelacion: c[iCan] || '',
      email: (c[iMail] || '').toLowerCase(),
    };
  });
}

(async () => {
  const filas = leerCsv(csv).filter((r) => /CLUBIFY/i.test(r.producto));
  log(`Período ${f(desde)} → ${f(new Date(hasta.getTime() - 1))} · ${filas.length} suscripciones de Clubify en el CSV\n`);

  const avisos = [];
  for (const r of filas) {
   try {
    let t = await p.tenant.findFirst({
      where: { hotmartSubscriberCode: r.codigo },
      select: { id: true, brandName: true, status: true, planPeriodicity: true, manualPayment: true, businessGroupId: true },
    });
    let via = 'código';
    if (!t && r.email) {
      t = await p.tenant.findFirst({
        where: { email: { equals: r.email, mode: 'insensitive' }, deletedAt: null },
        select: { id: true, brandName: true, status: true, planPeriodicity: true, manualPayment: true, businessGroupId: true },
      });
      via = 'correo del negocio';
    }
    if (!t && r.email) {
      const u = await p.user.findFirst({
        where: { email: { equals: r.email, mode: 'insensitive' }, tenantId: { not: null } },
        select: { tenantId: true },
      });
      if (u?.tenantId) {
        t = await p.tenant.findUnique({
          where: { id: u.tenantId },
          select: { id: true, brandName: true, status: true, planPeriodicity: true, manualPayment: true, businessGroupId: true },
        });
        via = 'correo del dueño';
      }
    }

    const eventos = await p.$queryRaw`
      SELECT "eventType", "processedAt" FROM "HotmartWebhookEvent"
      WHERE payload::text ILIKE ${'%' + r.codigo + '%'}
        AND "processedAt" >= ${desde} AND "processedAt" < ${hasta}
      ORDER BY "processedAt"`;
    const aprobados = eventos.filter((e) => /APPROVED|COMPLETE/i.test(e.eventType));

    const nueva = r.adhesion && r.adhesion >= desde && r.adhesion < hasta;
    log(`● ${r.cliente} · ${r.codigo} · ${r.plan} · ${r.estatus}${r.cancelacion ? ` (cancelada ${r.cancelacion.split(' ')[0]})` : ''} · adhesión ${f(r.adhesion)}${nueva ? ' ← NUEVA EN EL PERÍODO' : ''}`);
    log(`  avisos de Hotmart en el período: ${eventos.length ? eventos.map((e) => `${e.eventType} ${f(e.processedAt)}`).join(', ') : 'ninguno'}`);

    if (!t) {
      log('  ✗ SIN NEGOCIO en Clubify (ni por código ni por correo)');
      if (aprobados.length || nueva) avisos.push(`${r.cliente} (${r.codigo}): pagó en el período y no tiene negocio`);
      log('');
      continue;
    }
    log(`  negocio: ${t.brandName} (${t.status}, ${t.planPeriodicity ?? 'sin periodicidad'}${t.manualPayment ? ', pago manual' : ''}) · encontrado por ${via}`);

    const ingresos = await p.incomeRecord.findMany({
      where: { tenantId: t.id, saleDate: { gte: desde, lt: hasta } },
      select: { gateway: true, grossUsd: true, saleDate: true, status: true },
      orderBy: { saleDate: 'asc' },
    });
    log(`  ingresos en Contabilidad: ${ingresos.length ? ingresos.map((i) => `${f(i.saleDate)} ${i.gateway} ${usd(i.grossUsd)} ${i.status}`).join(', ') : 'NINGUNO'}`);
    if (aprobados.length && !ingresos.length) avisos.push(`${t.brandName}: Hotmart avisó pago aprobado y no hay ingreso en Contabilidad`);
    if (nueva && !ingresos.length && !aprobados.length) avisos.push(`${t.brandName}: adhesión nueva en el período sin aviso ni ingreso`);

    const usos = await p.referralUse.findMany({
      where: { OR: [{ tenantId: t.id }] },
      select: { id: true, status: true, referralCode: { select: { code: true, ownerName: true } } },
    });
    const comisiones = await p.commission.findMany({
      where: {
        OR: [
          ...(usos.length ? [{ referralUseId: { in: usos.map((u) => u.id) } }] : []),
          ...(t.businessGroupId ? [{ businessGroupId: t.businessGroupId }] : []),
        ],
        businessDate: { gte: desde, lt: hasta },
      },
      select: { amount: true, status: true, businessDate: true, recipientCode: { select: { ownerName: true } } },
    }).catch(() => []);
    const referido = usos.map((u) => `${u.referralCode?.ownerName ?? '?'} (${u.referralCode?.code}, ${u.status})`).join(', ');
    log(`  referido: ${referido || 'ninguno'}${t.businessGroupId ? ' · pertenece a un GRUPO' : ''}`);
    log(`  comisiones del período: ${comisiones.length ? comisiones.map((c) => `${f(c.businessDate)} ${usd(c.amount)} ${c.status} → ${c.recipientCode?.ownerName ?? '?'}`).join(', ') : 'ninguna'}`);
    if ((usos.length || t.businessGroupId) && ingresos.some((i) => i.status === 'PAGADO') && !comisiones.length) {
      avisos.push(`${t.brandName}: tiene referido y cobro en el período, pero NINGUNA comisión`);
    }
    log('');
   } catch (e) {
    // Una fila rara no puede dejar sin revisar a las demás.
    const motivo = String(e.message).split(/\r?\n/)[0];
    log(`  ✗ ERROR revisando ${r.cliente} (${r.codigo}): ${motivo}`);
    log('');
    avisos.push(`${r.cliente} (${r.codigo}): no se pudo revisar — ${motivo}`);
   }
  }

  // Al revés: comisiones del período cuyo negocio no tiene ingreso en el período.
  const todas = await p.commission.findMany({
    where: { businessDate: { gte: desde, lt: hasta }, status: { not: 'REJECTED' } },
    select: {
      amount: true, status: true, businessDate: true,
      recipientCode: { select: { ownerName: true } },
      referralUse: { select: { tenantId: true, tenant: { select: { brandName: true } } } },
      businessGroup: { select: { name: true } },
    },
    orderBy: { businessDate: 'asc' },
  });
  log(`══ Comisiones con fecha de negocio en el período: ${todas.length}`);
  for (const c of todas) {
    const tid = c.referralUse?.tenantId;
    const nombre = c.referralUse?.tenant?.brandName ?? (c.businessGroup ? `${c.businessGroup.name} (grupo)` : '— sin negocio —');
    let marca = '';
    if (tid) {
      const n = await p.incomeRecord.count({ where: { tenantId: tid, saleDate: { gte: desde, lt: hasta }, status: 'PAGADO' } });
      if (!n) {
        marca = '  ⚠ sin ingreso PAGADO en el período';
        avisos.push(`${nombre}: comisión ${usd(c.amount)} sin ingreso pagado en el período`);
      }
    }
    log(`  ${f(c.businessDate)} ${usd(c.amount)} ${c.status} · ${nombre} → ${c.recipientCode?.ownerName ?? '?'}${marca}`);
  }

  log(`\n══ PARA REVISAR (${avisos.length})`);
  for (const a of avisos) log(`  - ${a}`);
  if (salida) fs.writeFileSync(salida, lineas.join('\r\n'), 'utf8');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
