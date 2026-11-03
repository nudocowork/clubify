#!/usr/bin/env node
/**
 * Enciende la comisión del socio en el reporte de comisiones (Javier,
 * 2026-11-03): una por mes, en el corte de fin de mes, desde octubre de 2026.
 * Ver `src/referrals/comision-del-socio.service.ts`. Sin `--aplicar` solo muestra.
 *
 *   railway run --service backend --environment production \
 *     --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *     node scripts/activar-comision-del-socio.cjs [--aplicar]
 *
 * 1. Crea el código SOCIO-JAVIER con rol SOCIO (copia nombre, correo y
 *    WhatsApp del código de Javier en Clubify, 38454GNM). El rol SOCIO es lo
 *    que impide que Contabilidad lo reste dos veces. No se le pone usuario:
 *    su panel de vendedor sigue leyendo su código de siempre.
 * 2. Guarda `comisiones.socio.codeId`. NO toca `referrals.socioCodeId` (ese
 *    enciende la comisión de socio venta a venta: pagaría dos veces).
 * El cron de cada hora (minuto 20) crea la de octubre y la mete en el corte
 * CORTE-2026-10-31. Aquí solo se muestra cuánto va a ser.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');
const CLUBIFY = 'dfd3cdff-7836-4aee-96a4-d7fa2b2907be';
const r2 = (n) => Math.round(n * 100) / 100;

(async () => {
  console.log(APLICAR ? '=== APLICANDO ===' : '=== ENSAYO (sin --aplicar no se escribe nada) ===');
  const vendedor = await prisma.referralCode.findUnique({ where: { code: '38454GNM' } });
  if (!vendedor) throw new Error('No encuentro el código 38454GNM de Javier');
  let socio = await prisma.referralCode.findUnique({ where: { code: 'SOCIO-JAVIER' } });
  if (socio) console.log(`= código SOCIO-JAVIER ya existe (${socio.role})`);
  else {
    console.log(`→ crear código SOCIO-JAVIER (${vendedor.ownerName}, rol SOCIO, 10 %)`);
    if (APLICAR) {
      socio = await prisma.referralCode.create({
        data: {
          code: 'SOCIO-JAVIER',
          ownerName: vendedor.ownerName,
          ownerEmail: vendedor.ownerEmail,
          ownerWhatsapp: vendedor.ownerWhatsapp,
          country: vendedor.country,
          whiteLabelId: CLUBIFY,
          role: 'SOCIO',
          commissionPercent: 10,
        },
      });
    }
  }
  if (socio && socio.role !== 'SOCIO') throw new Error('SOCIO-JAVIER existe sin rol SOCIO: revisar a mano');
  const actual = await prisma.setting.findUnique({ where: { key: 'comisiones.socio.codeId' } });
  if (socio && actual?.value === socio.id) console.log('= comisiones.socio.codeId ya apunta a SOCIO-JAVIER');
  else {
    console.log('→ guardar comisiones.socio.codeId');
    if (APLICAR && socio) {
      await prisma.setting.upsert({ where: { key: 'comisiones.socio.codeId' }, update: { value: socio.id }, create: { key: 'comisiones.socio.codeId', value: socio.id } });
    }
  }
  const viejo = await prisma.setting.findUnique({ where: { key: 'referrals.socioCodeId' } });
  if (viejo?.value) console.log(`⚠ referrals.socioCodeId está puesto (${viejo.value}): eso paga al socio venta a venta. Revisar.`);

  // Lo que va a calcular el cron para octubre (misma base que la línea «Socio»).
  const filas = await prisma.incomeRecord.findMany({
    where: { status: 'PAGADO', OR: [{ whiteLabelId: CLUBIFY }, { whiteLabelId: null }], saleDate: { gte: new Date('2026-10-01T05:00:00Z'), lt: new Date('2026-11-01T05:00:00Z') } },
    select: { netExpectedUsd: true },
  });
  const base = r2(filas.reduce((a, f) => a + Number(f.netExpectedUsd), 0));
  console.log(`\nOctubre: base neta ${base} → comisión del socio ≈ ${r2(base * 0.1)} (entra al CORTE-2026-10-31 en la siguiente hora)`);
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
