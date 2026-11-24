/**
 * Simula (o aplica) la DEVOLUCIÓN de un cobro con la MISMA lógica del backend
 * (`revertirComisionesDeDevolucion` + las reglas de `estado-del-negocio`).
 *
 * Para qué: ver contra los datos reales qué pasaría con un reembolso o un
 * contracargo —qué comisiones se anulan, cuáles ya se pagaron y cuánto se
 * recupera de cada colaborador— antes de pulsar nada. Nació con Protein
 * Station (2026-11-23).
 *
 * Por defecto SIMULA y no escribe nada. Con `--aplicar` escribe lo mismo que
 * hace el sistema: el cobro deja de contar en Contabilidad, se revierten sus
 * comisiones y el negocio queda CANCELADO con su origen. NO manda el SMS: para
 * que el dueño reciba su aviso, usa en el panel «Estado de la suscripción →
 * Registrar devolución», que hace todo esto Y el aviso.
 *
 * Uso (desde backend/):
 *   railway run --service backend --environment production --project <id> \
 *     npx ts-node --transpile-only scripts/devolucion-de-un-cobro.ts <slug> <tx> <REEMBOLSO|CONTRACARGO|DISPUTA> [--aplicar]
 */
import { PrismaClient } from '@prisma/client';
import {
  revertirComisionesDeDevolucion,
  resumenDeDevolucion,
  type TipoDeDevolucion,
} from '../src/billing/revertir-devolucion';
import { motivoDeAnulacion } from '../src/billing/anular-comisiones-de-reembolso';
import { origenQueManda } from '../src/billing/estado-del-negocio';

const [slug, tx, tipoArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const APLICAR = process.argv.includes('--aplicar');
const tipo = (tipoArg ?? '').toUpperCase() as TipoDeDevolucion;

async function main() {
  if (!slug || !tx || !['REEMBOLSO', 'CONTRACARGO', 'DISPUTA'].includes(tipo)) {
    throw new Error('Uso: <slug> <tx> <REEMBOLSO|CONTRACARGO|DISPUTA> [--aplicar]');
  }
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  const t = await prisma.tenant.findFirst({
    where: { slug },
    select: { id: true, brandName: true, status: true, canceledAt: true, hotmartTransactionId: true },
  });
  if (!t) throw new Error(`No existe el negocio ${slug}`);
  const ingreso = await prisma.incomeRecord.findFirst({
    where: { tenantId: t.id, externalTxId: tx },
    select: { id: true, gateway: true, saleDate: true, status: true, grossUsd: true },
  });
  if (!ingreso) throw new Error(`El cobro ${tx} no está en Contabilidad para ${t.brandName}`);
  let actual = !t.hotmartTransactionId || t.hotmartTransactionId === tx;
  const ahora = new Date();
  const evento = tipo === 'CONTRACARGO' ? 'PURCHASE_CHARGEBACK' : tipo === 'DISPUTA' ? 'PURCHASE_PROTEST' : 'PURCHASE_REFUNDED';

  console.log(`${APLICAR ? '── APLICANDO ──' : '── SIMULACIÓN (no escribe nada) ──'}`);
  console.log(`Negocio: ${t.brandName} · ${t.status}${t.canceledAt ? ` · cancelado el ${t.canceledAt.toISOString().slice(0, 10)}` : ''}`);
  console.log(`Cobro: ${tx} · ${ingreso.gateway} · $${Number(ingreso.grossUsd).toFixed(2)} · ${ingreso.saleDate.toISOString().slice(0, 10)} · ${ingreso.status}`);

  // 1) Contabilidad (antes que las comisiones, como en el backend).
  const nuevoEstado = tipo === 'DISPUTA' ? 'EN_DISPUTA' : 'REEMBOLSADO';
  console.log(`\nContabilidad: ${ingreso.status} → ${nuevoEstado} (deja de contar como cobrado).`);
  if (APLICAR) {
    await prisma.incomeRecord.updateMany({
      where: {
        gateway: ingreso.gateway,
        externalTxId: tx,
        status: { in: nuevoEstado === 'EN_DISPUTA' ? ['PAGADO'] : ['PAGADO', 'EN_DISPUTA'] },
      },
      data: { status: nuevoEstado, refundedAt: ahora },
    });
  }

  // 2) Comisiones: la MISMA función del backend.
  const r = await revertirComisionesDeDevolucion(prisma, {
    tx,
    tipo,
    motivo: motivoDeAnulacion(evento, tx, ahora),
    tenantId: t.id,
    fechaDelCobro: ingreso.saleDate,
    cuando: ahora,
    simular: !APLICAR,
  });
  const nombres = new Map(
    (
      await prisma.referralCode.findMany({
        where: { id: { in: r.ajustes.map((a) => a.recipientCodeId) } },
        select: { id: true, ownerName: true, code: true },
      })
    ).map((c) => [c.id, `${c.ownerName} (${c.code})`]),
  );
  // Un pago sustituto (otro cobro que pagó lo mismo) manda: el período sigue
  // pagado y las comisiones pasan a él. Drive Pizza, 2026-11-24.
  if (r.sustituto) {
    actual = false;
    const s = r.sustituto;
    console.log(`\nPAGO SUSTITUTO: ${s.externalTxId} (${s.gateway}, ${s.saleDate.toISOString().slice(0, 10)}, $${s.grossUsd.toFixed(2)}).`);
    for (const c of r.traspasadas ?? []) {
      console.log(`  · ${c.id.slice(0, 8)} $${c.monto.toFixed(2)} ${c.pagada ? '(ya pagada)' : '(sin pagar)'} → pasa al sustituto`);
    }
    for (const a of r.ajustesAnulados ?? []) console.log(`  · descuento ${a.id.slice(0, 8)} −$${a.montoUsd.toFixed(2)} → se anula`);
    for (const id of r.ajustesYaDescontados ?? []) console.log(`  · descuento ${id.slice(0, 8)} YA aplicado en un corte → devolver a mano`);
  }
  console.log(`\n¿Es el cobro del período actual? ${actual ? 'sí → el negocio queda CANCELADO y desconectado' : 'no → el negocio no se toca'}`);
  console.log('\nComisiones de ese cobro:');
  for (const d of r.anulacion.detalle) {
    const que =
      d.que === 'anulada'
        ? 'NO pagada → se anula'
        : d.que === 'pagada'
          ? `YA pagada ($${(d.pagado ?? d.monto).toFixed(2)}) → ajuste por recuperar`
          : d.que === 'reactivada'
            ? 'reactivada a mano → se respeta'
            : 'de otro ciclo → no se toca (revisar)';
    console.log(`  · ${d.id.slice(0, 8)} $${d.monto.toFixed(2)} — ${que}`);
  }
  if (!r.anulacion.detalle.length) console.log('  (ninguna por transacción)');
  console.log('\nAjustes por recuperar (se descuentan del siguiente corte de cada uno):');
  for (const a of r.ajustes) {
    console.log(`  · ${nombres.get(a.recipientCodeId) ?? a.recipientCodeId} — $${a.montoUsd.toFixed(2)} (${a.origen}, ${a.resultado})`);
  }
  if (!r.ajustes.length) console.log('  (ninguno)');
  console.log(`\nProject Manager: ${r.equipo}`);
  console.log(`Socio: ${r.socio}`);

  // 3) El negocio.
  if (actual) {
    const previo = await prisma.tenant.findUnique({ where: { id: t.id }, select: { cancelSource: true } }).catch(() => null);
    const origen = t.canceledAt ? origenQueManda((previo as any)?.cancelSource ?? null, tipo) : tipo;
    console.log(`\nNegocio: CANCELADO por ${origen}${t.status === 'SUSPENDED' ? ' (ya estaba desconectado)' : ' y desconectado ahora'}.`);
    if (APLICAR) {
      await prisma.tenant.update({
        where: { id: t.id },
        data: {
          canceledAt: t.canceledAt ?? ahora,
          cancelSource: origen,
          cancelReason: `tx ${tx} · aplicado con scripts/devolucion-de-un-cobro.ts`,
          ...(t.status !== 'SUSPENDED' ? { status: 'SUSPENDED', suspendedAt: ahora } : {}),
          suspendReason: 'DEVOLUCION',
        },
      });
      await prisma.auditLog.create({
        data: {
          tenantId: t.id,
          action: 'billing.devolucion',
          resource: `tenant:${t.id}`,
          metadata: { tx, tipo, registradaPor: 'script', resumen: resumenDeDevolucion(tx, r) } as any,
        },
      });
    }
  }
  console.log(`\n${resumenDeDevolucion(tx, r)}`);
  if (!APLICAR) console.log('\nNada escrito. Repetir con --aplicar para aplicarlo (sin SMS: para el SMS, el botón del panel).');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
