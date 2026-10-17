/**
 * BACKFILL de participaciones globales sobre los cobros HISTÓRICOS.
 *
 * El dueño (2026-10-17) dijo «desde siempre»: Javier 10 % y Sara 2 % también
 * sobre las ventas pasadas. En vivo, una regla solo cubre los cobros llegados
 * después de crearla, a propósito: lo de antes lo decide un humano con esto.
 *
 * NO duplica la cuenta: carga con ts-node el MISMO motor que usan el webhook y
 * el cron (`src/referrals/participaciones-motor.ts` → `reglas-de-comision.ts`).
 *
 * SIMULA POR DEFECTO. Muestra:
 *   · total por beneficiario y por mes, y cuántas ventas;
 *   · las ventas EXCLUIDAS con su motivo (reembolsada, marca blanca, sin precio
 *     de plan, no es venta de plan…);
 *   · lo que pagó una MARCA BLANCA a Clubify (créditos, rebranding): es ingreso
 *     de Clubify pero NO entra — se informa para que el dueño decida.
 * Con `--aplicar` escribe las comisiones: PENDING, `availableAt` = fecha del
 * cobro + 15 días, `periodKey` PART-<mes del cobro> y la nota «Participación
 * histórica (backfill 2026-10-17)». Idempotente: la UNIQUE (participacionId,
 * ingresoId) hace que correrlo dos veces escriba cero la segunda.
 *
 * Uso:
 *   railway run node scripts/backfill-participaciones.cjs
 *   railway run node scripts/backfill-participaciones.cjs --desde=2026-05-01 --hasta=2026-10-16
 *   railway run node scripts/backfill-participaciones.cjs --aplicar [--retener] [--regla=<id>]
 *
 *   --retener  escribe RETAINED en vez de PENDING. Léase el AVISO del final.
 *   --regla=   solo esa participación (por id).
 *   --detalle  lista venta por venta lo que se crearía.
 */
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'commonjs' },
});
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const motor = require(path.join(__dirname, '..', 'src', 'referrals', 'participaciones-motor.ts'));
const { MOTIVOS_DE_EXCLUSION } = require(path.join(__dirname, '..', 'src', 'referrals', 'reglas-de-comision.ts'));

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const APLICAR = process.argv.includes('--aplicar');
const RETENER = process.argv.includes('--retener');
const DETALLE = process.argv.includes('--detalle');
const arg = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3).trim() : null;
};
const DESDE = arg('desde');
const HASTA = arg('hasta');
const REGLA = arg('regla');
const NOTA = 'Participación histórica (backfill 2026-10-17).';
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Días en hora de Bogotá (UTC−5): «hasta el 16» incluye el 16 entero.
const inicioBogota = (ymd) => new Date(`${ymd}T05:00:00.000Z`);
const finBogota = (ymd) => new Date(inicioBogota(ymd).getTime() + 86_400_000);
const usd = (n) => `$${n.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  for (const [k, v] of [['desde', DESDE], ['hasta', HASTA]]) {
    if (v && !YMD.test(v)) throw new Error(`--${k} debe ser AAAA-MM-DD`);
  }
  console.log(APLICAR ? 'MODO: APLICAR (escribe)' : 'MODO: SIMULACIÓN (no escribe nada)');
  console.log(`Rango: ${DESDE ?? 'desde siempre'} → ${HASTA ?? 'hoy'} (fecha del cobro, hora Bogotá)\n`);

  let reglas = await motor.cargarReglas(p);
  if (REGLA) reglas = reglas.filter((r) => r.id === REGLA);
  if (!reglas.length) {
    console.log('No hay participaciones activas (¿corriste sembrar-participaciones.cjs --aplicar?). Nada que hacer.');
    return p.$disconnect();
  }
  const codigos = await p.referralCode.findMany({
    where: { id: { in: reglas.map((r) => r.beneficiarioCodeId) } },
    select: { id: true, code: true, ownerName: true },
  });
  const quien = new Map(codigos.map((c) => [c.id, `${c.ownerName} (${c.code})`]));
  console.log('Participaciones:');
  for (const r of reglas) {
    console.log(`  · ${r.nombre}: ${r.tipo === 'FIJO' ? usd(r.valor) + ' fijos' : r.valor + ' %'} · ${r.aplicaA} · ${quien.get(r.beneficiarioCodeId)}`);
  }

  const where = {};
  if (DESDE || HASTA) {
    where.saleDate = {};
    if (DESDE) where.saleDate.gte = inicioBogota(DESDE);
    if (HASTA) where.saleDate.lt = finBogota(HASTA);
  }
  const ingresos = await p.incomeRecord.findMany({ where, select: motor.SELECT_INGRESO, orderBy: { saleDate: 'asc' } });
  const evaluaciones = await motor.evaluarIngresos(p, ingresos, reglas, { enVivo: false });

  const yaHay = await p.commission.findMany({
    where: { participacionId: { in: reglas.map((r) => r.id) }, ingresoId: { in: ingresos.map((i) => i.id) } },
    select: { participacionId: true, ingresoId: true },
  });
  const existe = new Set(yaHay.map((c) => `${c.participacionId}|${c.ingresoId}`));

  // ── Resumen ──
  const porBenef = new Map();
  const porMes = new Map();
  const ventasQueParticipan = new Set();
  let nuevas = 0;
  let yaExistentes = 0;
  for (const e of evaluaciones) {
    for (const f of e.filas) {
      ventasQueParticipan.add(e.ingreso.id);
      const ya = existe.has(`${f.participacionId}|${f.ingresoId}`);
      if (ya) yaExistentes++;
      else nuevas++;
      const b = porBenef.get(f.recipientCodeId) ?? { ventas: 0, total: 0, nuevo: 0 };
      b.ventas++;
      b.total = r2(b.total + f.amount);
      if (!ya) b.nuevo = r2(b.nuevo + f.amount);
      porBenef.set(f.recipientCodeId, b);
      const mes = e.ingreso.periodKey ?? new Date(e.venta.fecha.getTime() - 5 * 3600_000).toISOString().slice(0, 7);
      const k = `${mes}|${f.recipientCodeId}`;
      porMes.set(k, r2((porMes.get(k) ?? 0) + f.amount));
      if (DETALLE && !ya) {
        console.log(`    ${e.venta.fecha.toISOString().slice(0, 10)} ${e.ingreso.brandName ?? '—'} · ${e.venta.tipo} · base ${usd(f.baseAmountUsd)} → ${quien.get(f.recipientCodeId)} ${usd(f.amount)}`);
      }
    }
  }

  console.log(`\nCobros revisados: ${ingresos.length} · ventas que participan: ${ventasQueParticipan.size}`);
  console.log('\nTOTAL POR BENEFICIARIO (todo el rango · lo que falta crear):');
  for (const [id, b] of porBenef) console.log(`  ${quien.get(id)}: ${b.ventas} ventas · ${usd(b.total)} · por crear ${usd(b.nuevo)}`);

  console.log('\nPOR MES:');
  const meses = [...new Set([...porMes.keys()].map((k) => k.split('|')[0]))].sort();
  for (const m of meses) {
    const partes = [...porBenef.keys()].map((id) => `${quien.get(id)} ${usd(porMes.get(`${m}|${id}`) ?? 0)}`);
    console.log(`  ${m}: ${partes.join(' · ')}`);
  }

  // ── Excluidas ──
  const excl = evaluaciones.filter((e) => e.exclusion);
  const porMotivo = new Map();
  for (const e of excl) porMotivo.set(e.exclusion, [...(porMotivo.get(e.exclusion) ?? []), e]);
  console.log(`\nEXCLUIDAS: ${excl.length}`);
  for (const [motivo, lista] of porMotivo) {
    const bruto = r2(lista.reduce((s, e) => s + Number(e.ingreso.grossUsd), 0));
    console.log(`  ${MOTIVOS_DE_EXCLUSION[motivo]}: ${lista.length} (${usd(bruto)} cobrados)`);
    for (const e of lista.slice(0, 40)) {
      console.log(`    ${e.ingreso.saleDate.toISOString().slice(0, 10)} · ${e.ingreso.brandName ?? '—'} · ${e.ingreso.gateway} ${e.ingreso.externalTxId} · ${usd(Number(e.ingreso.grossUsd))} · ${e.ingreso.status} · ${e.ingreso.category ?? '—'}`);
    }
    if (lista.length > 40) console.log(`    … y ${lista.length - 40} más`);
  }

  // Lo que pagó una marca blanca a Clubify: SÍ es ingreso de Clubify, pero no
  // es venta de plan. Se informa, no se activa (lo decide el dueño).
  const deMarcas = evaluaciones.filter((e) => e.ingreso.payerWhiteLabelId && e.ingreso.status === 'PAGADO');
  if (deMarcas.length) {
    console.log(`\nPARA DECIDIR — ingresos de Clubify pagados por una MARCA BLANCA (créditos, rebranding, servicios): ${deMarcas.length}, ${usd(r2(deMarcas.reduce((s, e) => s + Number(e.ingreso.grossUsd), 0)))}.`);
    console.log('  No generan participación. Si el dueño quiere que cuenten, hay que decidir sobre qué base.');
  }

  console.log(`\nComisiones a crear: ${nuevas} · ya existentes (no se tocan): ${yaExistentes}`);

  if (APLICAR) {
    const r = await motor.escribirParticipaciones(p, evaluaciones, reglas, {
      prefijoDeNota: NOTA,
      estado: RETENER ? 'RETAINED' : 'PENDING',
    });
    console.log(`\nESCRITO: ${r.creadas} comisiones nuevas (de ${r.intentadas} filas; el resto ya existía).`);
  }

  console.log('\nAVISO: el cron de las 3:00 (promotePendingToApproved) pasa a APROBADA toda PENDING cuya');
  console.log('fecha de desbloqueo ya pasó, y el corte abierto la absorbe. En el histórico TODAS ya pasaron:');
  console.log('si se aplica con PENDING, mañana estarán aprobadas y en el corte en curso. Para revisarlas antes');
  console.log('de que eso ocurra, usar --retener (RETAINED: no entra a «Listo por pagar» hasta aprobarla a mano).');
  if (!APLICAR) console.log('\nSimulación terminada. Para escribir: --aplicar');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
