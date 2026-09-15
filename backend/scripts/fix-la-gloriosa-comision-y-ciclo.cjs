/**
 * La Gloriosa — la comisión del pago trimestral del 24-07-2026 para Nicolás
 * Rojas al 20%, con la fecha de ese pago, y el ciclo de cobro contado desde él.
 * Pedido de Javier, 2026-09-15.
 *
 * QUÉ HAY EN PRODUCCIÓN (leído el 2026-09-15, solo lectura):
 *   Tenant c94a3df6 «La Gloriosa» · Clubify · ACTIVE · TRIMESTRAL · paga por
 *   fuera (código sintético `wl-…`, cero eventos de Hotmart).
 *   - ManualPayment b833fbcf, registrado el 21-08 por javier@gmail.com:
 *     paidAt 04-07, cubre 04-07 → 04-10, nota «activada el 4 de julio». El 4 de
 *     julio es el INICIO DE ACTIVIDAD (nota del propio negocio): la cuenta ni
 *     existía (se creó el 13-07, en prueba). El pago fue el 24-07.
 *   - Tenant.lastChargeAt 04-07 · currentPeriodEnd 04-10: el próximo cobro y
 *     los avisos D-7/D-3/D-0 salen 20 días antes de tiempo.
 *   - IncomeRecord 3c36fc8d (MANUAL): saleDate 04-07.
 *   - ReferralUse 176a2d83 → Nicolás Rojas (JTK24H9Z, INFLUENCER, código al
 *     25%), creado el 31-08 con «asignar afiliado» (setTenantAssignment).
 *   - Commission a546a111: $37.50 (25% de $150) · PENDING · periodKey 2026-08
 *     · businessDate null · availableAt null · sin corte. Los paneles la pintan
 *     el 31-08 (su createdAt) y se desbloquearía el 15-09.
 *
 * QUÉ DEJA (en una transacción; cada escritura exige el valor de antes, así que
 * correrlo dos veces no hace nada y, si alguien tocó algo entretanto, no escribe):
 *   1. CommissionException (La Gloriosa × Rojas) = 20%, con su fila de
 *      historial. Es la forma de fijar un % por negocio SIN tocar el 25% del
 *      código, que le paga a Rojas en otros negocios. Con ella el arqueo, el
 *      recálculo y los cobros siguientes también dan 20%.
 *   2. Commission a546a111 → $30.00 · 20% · base $150 · businessDate 24-07 ·
 *      periodKey 2026-07 · availableAt 08-08 (hold de 15 días ya cumplido).
 *      Sigue PENDING: el cron de las 3:00 la pasa a APPROVED y el top-up
 *      horario la mete en el corte que esté ABIERTO en ese momento.
 *   3. Tenant: lastChargeAt 24-07 · currentPeriodEnd 24-10 · los 6 campos de
 *      dedup de avisos a null (el ciclo se movió; si no, no sale ningún aviso
 *      del ciclo corregido).
 *   4. ManualPayment b833fbcf: paidAt y periodStart 24-07 · periodEnd 24-10 ·
 *      nota reescrita.
 *   5. IncomeRecord 3c36fc8d: saleDate 24-07 (el período 2026-07 no cambia).
 *   6. AuditLog de la comisión y del pago.
 *
 *   7. IncomeRecord 3c36fc8d: categoría RENOVACION → NUEVA. Javier (15-09): «La
 *      venta registrada es en la fecha que te indiqué, el 24 de julio de 2026;
 *      la renovación y los futuros cobros son cada 3 meses a partir de ahí.»
 *
 * NO TOCA: comisiones pagadas o metidas en un corte (si la comisión ya tiene
 * corte o pago, aborta) ni el % del código de Rojas.
 *
 * Uso (desde backend/):
 *   railway run --service Postgres-Nq8w node scripts/fix-la-gloriosa-comision-y-ciclo.cjs            # simula
 *   railway run --service Postgres-Nq8w node scripts/fix-la-gloriosa-comision-y-ciclo.cjs --aplicar  # escribe
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.slice(2).includes('--aplicar');
// `railway run --service Postgres-Nq8w` inyecta las dos; la interna
// (*.railway.internal) no se alcanza desde fuera de Railway.
const URL_BD = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!URL_BD) {
  console.error('Falta DATABASE_PUBLIC_URL: córrelo con railway run --service Postgres-Nq8w.');
  process.exit(1);
}
const p = new PrismaClient({ datasources: { db: { url: URL_BD } } });

const TENANT_ID = 'c94a3df6-79bb-478f-a31b-209b4796f46f';
const ROJAS_ID = '79d912c8-ace5-404e-ac9d-b7d8bf806680';
const USE_ID = '176a2d83-0c63-4975-9b0a-9479a98d2fb4';
const COMISION_ID = 'a546a111-614d-4292-b6e4-56181cf839aa';
const PAGO_MANUAL_ID = 'b833fbcf-a635-4c37-b7d8-7352f1452d9b';
const INGRESO_ID = '3c36fc8d-80fc-4bbc-83dc-d76a80f93759';

const DIA = 86400000;
// 12:00 UTC: la misma hora que guarda el modal de «Registrar pago manual».
const PAGO = new Date('2026-07-24T12:00:00.000Z');
const FIN_CICLO = new Date('2026-10-24T12:00:00.000Z'); // + 3 meses reales (TRIMESTRAL)
const DESBLOQUEO = new Date(PAGO.getTime() + 15 * DIA); // COMMISSION_HOLD_DAYS
const PERIODO_NUEVO = '2026-07';
const PORCENTAJE = 20;
const BASE_USD = 150;
const MONTO = 30; // 20% de 150

// Lo que había al verificar. Cada UPDATE lo exige en el WHERE.
const ANTES = {
  lastChargeAt: new Date('2026-07-04T12:00:00.000Z'),
  currentPeriodEnd: new Date('2026-10-04T12:00:00.000Z'),
  comisionMonto: 37.5,
  comisionPeriodo: '2026-08',
  pagoInicio: new Date('2026-07-04T12:00:00.000Z'),
  pagoFin: new Date('2026-10-04T12:00:00.000Z'),
  ingresoFecha: new Date('2026-07-04T12:00:00.000Z'),
};

const RAZON =
  'Pedido de Javier (2026-09-15): la venta de La Gloriosa (pago trimestral del 24-07-2026) se le paga a Nicolás Rojas al 20%.';
const NOTA_COMISION =
  'Corregida el 15-09-2026 (pedido de Javier): comisión del pago trimestral de La Gloriosa del 24-07-2026, al 20% de $150 = $30. ' +
  'Antes: $37.50 (25% del código), período 2026-08 y sin fecha, porque nació al asignar el afiliado el 31-08.';
const NOTA_PAGO = [
  'La Gloriosa pagó su plan trimestral el 24 de julio de 2026.',
  'Pago recibido por fuera de la pasarela (Nequi/efectivo/transferencia).',
  'Cubre del 24 de julio al 24 de octubre de 2026.',
  '(Corregido el 15-09-2026: antes decía 4 de julio, que es el inicio de actividad del negocio, no la fecha del pago.)',
].join('\n');

const f = (d) => (d ? new Date(d).toISOString().replace('.000Z', 'Z') : '—');
const igual = (a, b) => (a == null || b == null ? a == b : new Date(a).getTime() === new Date(b).getTime());
const num = (x) => (x == null ? null : Number(x));

class Aborto extends Error {}
const abortar = (msg) => {
  throw new Aborto(msg);
};

/**
 * Lee todo, aplica los candados y dice qué está hecho y qué falta.
 *
 * `trasEscribir`: la relectura final NO vuelve a aplicar los candados de «no
 * tocar lo pagado ni lo que está en un corte». Si el top-up horario mete la
 * comisión en el corte justo después del commit, lo escrito está bien y
 * abortar ahí haría creer que falló (Fable, 15-09-2026).
 */
async function leer(trasEscribir = false) {
  const t = await p.tenant.findUnique({
    where: { id: TENANT_ID },
    select: {
      name: true, slug: true, status: true, deletedAt: true, planPeriodicity: true,
      subscriptionPriceUsd: true, manualPayment: true, lastChargeAt: true, currentPeriodEnd: true,
    },
  });
  if (!t || t.deletedAt || t.slug !== 'la-gloriosa') abortar('No encuentro La Gloriosa viva con ese id.');
  if (t.planPeriodicity !== 'TRIMESTRAL') abortar(`La periodicidad ya no es TRIMESTRAL (${t.planPeriodicity}).`);

  // La base la decide getCommissionBase: precio pactado del negocio o, si no
  // hay, el canónico del plan. Tiene que dar 150; si no, el 20% no es $30 y el
  // arqueo discreparía de lo escrito.
  const pactado = num(t.subscriptionPriceUsd);
  const canonico = await p.setting.findUnique({ where: { key: 'landing.plans.trimestral.price' } });
  const base = pactado && pactado > 0 ? pactado : canonico?.value ? Number(canonico.value) : 150;
  if (base !== BASE_USD) abortar(`La base de comisión del negocio es $${base}, no $${BASE_USD}.`);

  const usos = await p.referralUse.findMany({
    where: { tenantId: TENANT_ID },
    include: { referralCode: { select: { code: true, ownerName: true, role: true, commissionPercent: true } } },
  });
  if (usos.length !== 1 || usos[0].id !== USE_ID || usos[0].referralCodeId !== ROJAS_ID) {
    const quien = usos.map((u) => `${u.referralCode.ownerName}/${u.referralCode.role}`).join(', ') || 'nadie';
    abortar(`La atribución cambió (hoy: ${quien}).`);
  }

  // Un segundo pago manual es un ciclo nuevo ya registrado: retroceder la fecha
  // del negocio lo pisaría.
  const pagos = await p.manualPayment.findMany({ where: { tenantId: TENANT_ID } });
  if (pagos.length !== 1 || pagos[0].id !== PAGO_MANUAL_ID) {
    abortar(`Hay ${pagos.length} pagos manuales del negocio; esperaba solo ${PAGO_MANUAL_ID}.`);
  }
  const pago = pagos[0];

  const eventos = await p.hotmartWebhookEvent.count({ where: { tenantId: TENANT_ID } });
  if (eventos > 0) abortar(`Hay ${eventos} eventos de Hotmart del negocio: su ciclo ya no es solo manual.`);

  const comisiones = await p.commission.findMany({
    where: { referralUse: { tenantId: TENANT_ID } },
    include: { payoutItem: { select: { id: true } } },
  });
  if (comisiones.length !== 1 || comisiones[0].id !== COMISION_ID) {
    abortar(`Hay ${comisiones.length} comisiones del negocio; esperaba solo ${COMISION_ID}.`);
  }
  const c = comisiones[0];
  if (c.recipientCodeId !== ROJAS_ID) abortar('La comisión no es de Nicolás Rojas.');
  // Lo pagado o metido en un corte no se reescribe: el dinero ya salió o está
  // comprometido en una transferencia.
  if (!trasEscribir && (c.status === 'PAID' || c.paidAt || c.paymentStatus !== 'PENDING' || num(c.amountPaid) !== 0)) {
    abortar(`La comisión ya tiene pago (status ${c.status}, pagado $${num(c.amountPaid)}). No se toca.`);
  }
  if (!trasEscribir && (c.payoutBatchId || c.payoutItem)) {
    abortar(`La comisión ya está en un corte (payoutBatchId ${c.payoutBatchId}). Sácala del corte en el panel y vuelve a correr.`);
  }
  if (!trasEscribir && c.status !== 'PENDING' && c.status !== 'APPROVED') abortar(`La comisión está ${c.status}.`);

  const exc = await p.commissionException.findUnique({
    where: { tenantId_recipientCodeId: { tenantId: TENANT_ID, recipientCodeId: ROJAS_ID } },
  });
  if (exc && !(exc.isActive && num(exc.customPercent) === PORCENTAJE)) {
    abortar(`Ya hay una excepción distinta (${num(exc.customPercent)}%, activa=${exc.isActive}). No la piso.`);
  }

  const ingreso = await p.incomeRecord.findUnique({ where: { id: INGRESO_ID } });
  if (!ingreso || ingreso.gateway !== 'MANUAL' || ingreso.externalTxId !== PAGO_MANUAL_ID || ingreso.tenantId !== TENANT_ID) {
    abortar('El ingreso contable del pago manual no es el esperado.');
  }
  if (ingreso.periodKey !== '2026-07') abortar(`El ingreso está en el período ${ingreso.periodKey}; esperaba 2026-07.`);

  const estado = (hecho, pendiente, que) => {
    if (hecho) return 'hecho';
    if (pendiente) return 'pendiente';
    return abortar(`${que}: valores inesperados (ni los de antes ni los corregidos). Revisar a mano.`);
  };
  const plan = {
    excepcion: exc ? 'hecho' : 'pendiente',
    comision: estado(
      num(c.amount) === MONTO && c.periodKey === PERIODO_NUEVO && igual(c.businessDate, PAGO) &&
        igual(c.availableAt, DESBLOQUEO) && num(c.appliedPercent) === PORCENTAJE && num(c.baseAmountUsd) === BASE_USD,
      num(c.amount) === ANTES.comisionMonto && c.periodKey === ANTES.comisionPeriodo && c.businessDate == null,
      'Comisión',
    ),
    ciclo: estado(
      igual(t.lastChargeAt, PAGO) && igual(t.currentPeriodEnd, FIN_CICLO),
      igual(t.lastChargeAt, ANTES.lastChargeAt) && igual(t.currentPeriodEnd, ANTES.currentPeriodEnd),
      'Ciclo del negocio',
    ),
    pagoManual: estado(
      igual(pago.paidAt, PAGO) && igual(pago.periodStart, PAGO) && igual(pago.periodEnd, FIN_CICLO),
      igual(pago.paidAt, ANTES.pagoInicio) && igual(pago.periodStart, ANTES.pagoInicio) && igual(pago.periodEnd, ANTES.pagoFin),
      'Pago manual',
    ),
    ingreso: estado(igual(ingreso.saleDate, PAGO), igual(ingreso.saleDate, ANTES.ingresoFecha), 'Ingreso contable'),
    categoria: estado(ingreso.category === 'NUEVA', ingreso.category === 'RENOVACION', 'Categoría del ingreso'),
  };
  return { t, uso: usos[0], pago, c, exc, ingreso, plan };
}

async function main() {
  const [{ db }] = await p.$queryRawUnsafe('SELECT current_database() AS db');
  let host = '?';
  try {
    host = new URL(URL_BD).host;
  } catch {
    /* sin host legible */
  }
  console.log(`Base «${db}» en ${host} · ${APLICAR ? 'MODO APLICAR' : 'simulación (no escribe nada)'}\n`);

  const { t, uso, pago, c, exc, ingreso, plan } = await leer();
  const pctCodigo = num(uso.referralCode.commissionPercent);
  console.log(`${t.name.trim()} · ${t.planPeriodicity} · ${t.status} · pago manual=${t.manualPayment}`);
  console.log(`Atribuida a ${uso.referralCode.ownerName} (${uso.referralCode.code}, ${uso.referralCode.role}, código al ${pctCodigo}%)\n`);

  const linea = (clave, titulo, antes, despues) =>
    console.log(`[${plan[clave] === 'hecho' ? 'ya está' : 'CAMBIA '}] ${titulo}\n          hoy:     ${antes}\n          queda:   ${despues}`);
  linea(
    'excepcion',
    'Excepción de comisión La Gloriosa × Rojas',
    exc ? `${num(exc.customPercent)}% (activa)` : `no hay → se aplica el ${pctCodigo}% del código`,
    `${PORCENTAJE}% solo en este negocio; el código de Rojas sigue en ${pctCodigo}% para los demás`,
  );
  linea(
    'comision',
    `Comisión ${COMISION_ID.slice(0, 8)}`,
    `$${num(c.amount)} · ${num(c.appliedPercent) ?? '—'}% · período ${c.periodKey} · fecha ${f(c.businessDate)} · desbloqueo ${f(c.availableAt)} · ${c.status}`,
    `$${MONTO.toFixed(2)} · ${PORCENTAJE}% de $${BASE_USD} · período ${PERIODO_NUEVO} · fecha ${f(PAGO)} · desbloqueo ${f(DESBLOQUEO)} · ${c.status}`,
  );
  linea(
    'ciclo',
    'Ciclo del negocio',
    `último cobro ${f(t.lastChargeAt)} · próximo cobro ${f(t.currentPeriodEnd)}`,
    `último cobro ${f(PAGO)} · próximo cobro ${f(FIN_CICLO)} · avisos del ciclo re-armados`,
  );
  linea(
    'pagoManual',
    `Pago manual ${PAGO_MANUAL_ID.slice(0, 8)}`,
    `pagado ${f(pago.paidAt)} · cubre ${f(pago.periodStart)} → ${f(pago.periodEnd)}`,
    `pagado ${f(PAGO)} · cubre ${f(PAGO)} → ${f(FIN_CICLO)} · nota reescrita`,
  );
  linea(
    'ingreso',
    `Ingreso contable ${INGRESO_ID.slice(0, 8)}`,
    `fecha de venta ${f(ingreso.saleDate)} · ${ingreso.category} · período ${ingreso.periodKey}`,
    `fecha de venta ${f(PAGO)} · período sin cambios`,
  );
  linea(
    'categoria',
    `Categoría del ingreso ${INGRESO_ID.slice(0, 8)}`,
    `${ingreso.category}`,
    'NUEVA: es la venta del 24-07; las renovaciones vienen cada 3 meses desde ahí',
  );

  const cortes = await p.payoutBatch.findMany({ where: { status: 'OPEN' }, select: { code: true, totalUsd: true } });
  console.log(`\nCortes ABIERTOS ahora: ${cortes.map((b) => `${b.code} ($${num(b.totalUsd)})`).join(', ') || 'ninguno'}.`);
  console.log(
    'Ojo: la comisión corregida nace con el desbloqueo ya vencido. El cron de las 3:00 (hora del servidor) la pasa a APPROVED\n' +
      'y el top-up horario la mete en el corte que siga ABIERTO. Si ese corte ya se transfirió, ciérralo antes de aplicar,\n' +
      'o su total no cuadrará con la transferencia (el caso Hydor/Quipao/Monet).',
  );

  const pendientes = Object.entries(plan).filter(([, v]) => v === 'pendiente').map(([k]) => k);
  if (!pendientes.length) {
    console.log('\nNada que hacer: todo está corregido.');
    return;
  }
  if (!APLICAR) {
    console.log(`\nSimulación: cambiarían ${pendientes.length} cosas (${pendientes.join(', ')}). No se escribió nada. Repite con --aplicar.`);
    return;
  }
  if (db !== 'railway') abortar(`La base es «${db}», no la de producción. No escribo.`);

  await p.$transaction(
    async (tx) => {
      const exige = (r, que) => {
        if (r.count !== 1) {
          throw new Aborto(`${que}: cambió entre la lectura y la escritura (count=${r.count}). No se escribió nada.`);
        }
      };

      let excepcionId = exc?.id ?? null;
      if (plan.excepcion === 'pendiente') {
        const nueva = await tx.commissionException.create({
          data: {
            tenantId: TENANT_ID,
            recipientCodeId: ROJAS_ID,
            customPercent: PORCENTAJE,
            reason: RAZON,
            isActive: true,
            createdById: null,
          },
        });
        excepcionId = nueva.id;
        // El mismo rastro que deja el panel al crearla (commission-exceptions.service).
        await tx.commissionExceptionHistory.create({
          data: {
            exceptionId: nueva.id,
            previousPercent: null,
            newPercent: PORCENTAJE,
            previousActive: null,
            newActive: true,
            reason: RAZON,
            changedById: null,
          },
        });
      }

      if (plan.comision === 'pendiente') {
        exige(
          await tx.commission.updateMany({
            where: {
              id: COMISION_ID,
              amount: ANTES.comisionMonto,
              periodKey: ANTES.comisionPeriodo,
              businessDate: null,
              payoutBatchId: null,
              paidAt: null,
              paymentStatus: 'PENDING',
              amountPaid: 0,
              status: { in: ['PENDING', 'APPROVED'] },
              notes: c.notes,
            },
            data: {
              amount: MONTO,
              appliedPercent: PORCENTAJE,
              baseAmountUsd: BASE_USD,
              businessDate: PAGO,
              availableAt: DESBLOQUEO,
              periodKey: PERIODO_NUEVO,
              notes: c.notes ? `${c.notes}\n${NOTA_COMISION}` : NOTA_COMISION,
            },
          }),
          'Comisión',
        );
        await tx.auditLog.create({
          data: {
            actorId: null,
            tenantId: TENANT_ID,
            action: 'commission.recalculated',
            resource: `Commission:${COMISION_ID}`,
            metadata: {
              recipientCodeId: ROJAS_ID,
              previousAmount: ANTES.comisionMonto,
              newAmount: MONTO,
              percentApplied: PORCENTAJE,
              baseAmountUsd: BASE_USD,
              previousPeriodKey: ANTES.comisionPeriodo,
              newPeriodKey: PERIODO_NUEVO,
              previousBusinessDate: null,
              newBusinessDate: PAGO.toISOString(),
              newAvailableAt: DESBLOQUEO.toISOString(),
              commissionExceptionId: excepcionId,
              reason: RAZON,
              script: 'scripts/fix-la-gloriosa-comision-y-ciclo.cjs',
            },
          },
        });
      }

      if (plan.ciclo === 'pendiente') {
        exige(
          await tx.tenant.updateMany({
            where: { id: TENANT_ID, lastChargeAt: ANTES.lastChargeAt, currentPeriodEnd: ANTES.currentPeriodEnd },
            data: {
              lastChargeAt: PAGO,
              currentPeriodEnd: FIN_CICLO,
              // Se movió el ciclo: los seis campos de dedup de avisos a null o
              // no sale ningún aviso del ciclo corregido.
              preReminder7dSentFor: null,
              preReminder3dSentFor: null,
              preReminderTodaySentFor: null,
              paymentReminderSentFor: null,
              paymentFailureNoticeSentAt: null,
              pausePendingNoticeSentAt: null,
            },
          }),
          'Ciclo del negocio',
        );
      }

      if (plan.pagoManual === 'pendiente') {
        exige(
          await tx.manualPayment.updateMany({
            where: {
              id: PAGO_MANUAL_ID,
              paidAt: ANTES.pagoInicio,
              periodStart: ANTES.pagoInicio,
              periodEnd: ANTES.pagoFin,
            },
            data: { paidAt: PAGO, periodStart: PAGO, periodEnd: FIN_CICLO, note: NOTA_PAGO },
          }),
          'Pago manual',
        );
      }

      if (plan.ingreso === 'pendiente') {
        exige(
          await tx.incomeRecord.updateMany({
            where: { id: INGRESO_ID, saleDate: ANTES.ingresoFecha },
            data: {
              saleDate: PAGO,
              note: `${ingreso.note ?? 'Pago manual'} · fecha corregida 04-07 → 24-07 (15-09-2026)`,
            },
          }),
          'Ingreso contable',
        );
      }

      if (plan.categoria === 'pendiente') {
        exige(
          await tx.incomeRecord.updateMany({
            where: { id: INGRESO_ID, category: 'RENOVACION' },
            data: { category: 'NUEVA' },
          }),
          'Categoría del ingreso',
        );
      }

      if (
        plan.ciclo === 'pendiente' ||
        plan.pagoManual === 'pendiente' ||
        plan.ingreso === 'pendiente' ||
        plan.categoria === 'pendiente'
      ) {
        await tx.auditLog.create({
          data: {
            actorId: null,
            tenantId: TENANT_ID,
            action: 'tenant.manual_payment_corrected',
            resource: `manual_payment:${PAGO_MANUAL_ID}`,
            metadata: {
              brandName: t.name,
              previousPaidAt: ANTES.pagoInicio.toISOString(),
              newPaidAt: PAGO.toISOString(),
              previousPeriodEnd: ANTES.pagoFin.toISOString(),
              newPeriodEnd: FIN_CICLO.toISOString(),
              previousLastChargeAt: ANTES.lastChargeAt.toISOString(),
              newLastChargeAt: PAGO.toISOString(),
              incomeRecordId: INGRESO_ID,
              previousCategory: 'RENOVACION',
              newCategory: 'NUEVA',
              reason: 'Pedido de Javier (2026-09-15): el pago trimestral fue el 24-07-2026; el 04-07 era el inicio de actividad.',
              script: 'scripts/fix-la-gloriosa-comision-y-ciclo.cjs',
            },
          },
        });
      }
    },
    { timeout: 30000 },
  );

  // Una escritura no está hecha hasta que se relee.
  const despues = await leer(true);
  const faltan = Object.entries(despues.plan).filter(([, v]) => v !== 'hecho').map(([k]) => k);
  if (faltan.length) abortar(`Tras escribir, no cuadra: ${faltan.join(', ')}.`);
  console.log('\nAplicado y releído: las 6 piezas cuadran.');
}

main()
  .catch((e) => {
    console.error(e instanceof Aborto ? `\nABORTADO: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
