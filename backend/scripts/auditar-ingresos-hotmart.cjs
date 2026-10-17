/**
 * SOLO LECTURA. Auditoría de Contabilidad contra Hotmart, venta por venta.
 *
 * Pide a la API de Hotmart (`/payments/api/v1/sales/history`, con las
 * credenciales HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET de Railway) TODAS las
 * transacciones del período y las cruza por código (HP…) con `IncomeRecord`
 * (gateway HOTMART, externalTxId). El reporte de SUSCRIPCIONES de Hotmart no
 * sirve para esto: solo trae la fecha de alta, no cada renovación
 * (conciliación del 2026-10-16).
 *
 * Reporta:
 *   - Ventas aprobadas/completas en Hotmart que NO están en Contabilidad.
 *   - Ventas con estado distinto (reembolsada en Hotmart y PAGADA aquí, etc.).
 *   - Ingresos HOTMART en Contabilidad que Hotmart no reporta en el período.
 * Separa los productos que no son de Clubify (Master Creativo, WhatsApp…).
 *
 *   railway run --service backend --environment production node scripts/auditar-ingresos-hotmart.cjs \
 *     --desde 2026-09-01 --hasta 2026-10-17 [--salida C:\ruta\auditoria.txt]
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const desde = new Date(`${arg('desde') || '2026-09-01'}T05:00:00Z`);
const hasta = new Date(`${arg('hasta') || new Date().toISOString().slice(0, 10)}T05:00:00Z`);
hasta.setUTCDate(hasta.getUTCDate() + 1); // incluye el día de --hasta
const salida = arg('salida');
const lineas = [];
const log = (...a) => {
  const l = a.join(' ');
  lineas.push(l);
  console.log(l);
};
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

async function token() {
  const id = process.env.HOTMART_CLIENT_ID;
  const secret = process.env.HOTMART_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Faltan HOTMART_CLIENT_ID / HOTMART_CLIENT_SECRET (córrelo con railway run --service backend).');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const r = await fetch(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
    { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' } },
  );
  if (!r.ok) throw new Error(`Hotmart token → HTTP ${r.status}`);
  return (await r.json()).access_token;
}

/** Todas las páginas de un estado. Hotmart filtra por estado de transacción. */
async function ventas(tk, estado) {
  const out = [];
  let pagina = null;
  for (let n = 0; n < 200; n++) {
    const q = new URLSearchParams({
      start_date: String(desde.getTime()),
      end_date: String(hasta.getTime()),
      max_results: '500',
      transaction_status: estado,
    });
    if (pagina) q.set('page_token', pagina);
    const r = await fetch(`https://developers.hotmart.com/payments/api/v1/sales/history?${q}`, {
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) throw new Error(`Hotmart ventas (${estado}) → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const cuerpo = await r.json();
    out.push(...(cuerpo.items ?? []));
    pagina = cuerpo.page_info?.next_page_token;
    if (!pagina) break;
  }
  return out;
}

const ESTADOS = ['APPROVED', 'COMPLETE', 'REFUNDED', 'CHARGEBACK', 'PROTESTED', 'PARTIALLY_REFUNDED'];
const esReembolso = (s) => ['REFUNDED', 'CHARGEBACK', 'PROTESTED', 'PARTIALLY_REFUNDED'].includes(s);

(async () => {
  log(`Auditoría Hotmart ↔ Contabilidad · ${f(desde)} a ${f(new Date(hasta.getTime() - 1))}\n`);
  const tk = await token();
  const todas = [];
  for (const e of ESTADOS) {
    const vs = await ventas(tk, e);
    log(`Hotmart ${e}: ${vs.length}`);
    todas.push(...vs);
  }
  // Una transacción puede venir en dos estados si cambió en el período: manda el último.
  const porTx = new Map();
  for (const v of todas) {
    const tx = v?.purchase?.transaction;
    if (!tx) continue;
    const previo = porTx.get(tx);
    if (!previo || esReembolso(v.purchase.status)) porTx.set(tx, v);
  }
  const deClubify = [];
  const otros = new Map();
  for (const v of porTx.values()) {
    const prod = String(v?.product?.name ?? '');
    if (/clubify/i.test(prod)) deClubify.push(v);
    else otros.set(prod || '(sin nombre)', (otros.get(prod || '(sin nombre)') ?? 0) + 1);
  }
  log(`\nTransacciones distintas: ${porTx.size} · de Clubify: ${deClubify.length}`);
  if (otros.size) log(`No son de Clubify (no se auditan): ${[...otros].map(([k, n]) => `${k} (${n})`).join(', ')}`);

  const libro = await p.incomeRecord.findMany({
    where: { gateway: 'HOTMART', externalTxId: { in: deClubify.map((v) => v.purchase.transaction) } },
    select: { externalTxId: true, status: true, grossUsd: true, saleDate: true, brandName: true },
  });
  const enLibro = new Map(libro.map((i) => [i.externalTxId, i]));

  const faltan = [];
  const distintos = [];
  let bien = 0;
  for (const v of deClubify) {
    const tx = v.purchase.transaction;
    const st = v.purchase.status;
    const fila = enLibro.get(tx);
    const quien = `${v?.buyer?.name ?? '?'} <${v?.buyer?.email ?? '?'}>`;
    const fecha = f(v.purchase.approved_date ?? v.purchase.order_date);
    const monto = `${v?.purchase?.price?.value ?? '?'} ${v?.purchase?.price?.currency_code ?? ''}`.trim();
    if (!fila) {
      if (!esReembolso(st)) faltan.push(`${fecha} ${tx} ${st} · ${quien} · ${monto} · ${v?.product?.name}`);
      continue;
    }
    const reembolsadoAqui = fila.status === 'REEMBOLSADO';
    if (esReembolso(st) !== reembolsadoAqui) {
      distintos.push(`${fecha} ${tx} · Hotmart ${st} · Contabilidad ${fila.status} ($${Number(fila.grossUsd)}, ${fila.brandName ?? '—'}) · ${quien}`);
    } else bien++;
  }

  const sobran = await p.incomeRecord.findMany({
    where: {
      gateway: 'HOTMART',
      saleDate: { gte: desde, lt: hasta },
      externalTxId: { notIn: [...porTx.keys()] },
    },
    select: { externalTxId: true, status: true, grossUsd: true, saleDate: true, brandName: true },
    orderBy: { saleDate: 'asc' },
  });

  log(`\n══ Bien registradas: ${bien}`);
  log(`\n══ EN HOTMART Y NO EN CONTABILIDAD (${faltan.length})`);
  for (const x of faltan) log(`  - ${x}`);
  log(`\n══ ESTADO DISTINTO (${distintos.length})`);
  for (const x of distintos) log(`  - ${x}`);
  log(`\n══ EN CONTABILIDAD Y NO EN HOTMART en el período (${sobran.length})`);
  for (const i of sobran) log(`  - ${f(i.saleDate)} ${i.externalTxId} ${i.status} $${Number(i.grossUsd)} · ${i.brandName ?? '—'}`);

  if (salida) fs.writeFileSync(salida, lineas.join('\r\n'), 'utf8');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  if (salida) fs.writeFileSync(salida, [...lineas, `ERROR: ${e.message}`].join('\r\n'), 'utf8');
  await p.$disconnect();
  process.exit(1);
});
