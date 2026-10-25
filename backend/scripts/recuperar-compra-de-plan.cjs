/**
 * Recupera una compra de PLAN que el webhook tomó por un pack de créditos
 * (la oferta vivía en el producto «Servicios adicionales» de Hotmart).
 *
 * Caso que lo originó: 27 Grados Licores (2026-10-25), «Implementacion Oferta
 * 25 USD» = Mensualidad básica. El pago quedó sin negocio ni enlace de
 * activación.
 *
 * Qué hace (simula sin --aplicar):
 *  1. Registra la oferta en los enlaces de venta como «Mensualidad básica»
 *     MENSUAL, INACTIVA (no aparece en el panel de afiliados, pero el sistema
 *     la reconoce como plan para activar y fijar la periodicidad).
 *  2. Crea el PendingHotmartPayment con el payload original, para que el pago
 *     salga en Admin → «Pagos sin activar» y se pueda reenviar el enlace.
 *     NO le manda nada al comprador: el reenvío lo decide el equipo.
 *  3. Marca la compra de créditos «sin asignar» como IGNORED para que no
 *     aparezca como créditos pendientes de repartir.
 *
 *   railway run --service backend --environment production node scripts/recuperar-compra-de-plan.cjs <transacción> <codigo-oferta> [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const [tx, oferta] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const aplicar = process.argv.includes('--aplicar');
  if (!tx || !oferta) throw new Error('Uso: node scripts/recuperar-compra-de-plan.cjs <transacción> <codigo-oferta> [--aplicar]');

  const ev = await prisma.$queryRawUnsafe(
    `SELECT "eventId", payload FROM "HotmartWebhookEvent" WHERE payload->'data'->'purchase'->>'transaction' = $1 ORDER BY "processedAt" LIMIT 1`,
    tx,
  );
  if (!ev.length) throw new Error('No hay webhook con esa transacción');
  const payload = ev[0].payload;
  const d = payload.data || {};
  const email = (d.buyer?.email || '').trim().toLowerCase();
  if ((d.purchase?.offer?.code || '') !== oferta) throw new Error(`La transacción es de la oferta ${d.purchase?.offer?.code}, no ${oferta}`);
  console.log(`${aplicar ? 'APLICANDO' : 'SIMULACIÓN'} · ${d.buyer?.name} <${email}> · ${d.purchase?.offer?.name} · tx ${tx}`);

  // 1. Enlace de venta.
  const fila = await prisma.setting.findUnique({ where: { key: 'landing.enlacesDeVenta' } });
  let lista = [];
  try { lista = JSON.parse(typeof fila?.value === 'string' ? fila.value : JSON.stringify(fila?.value ?? [])); } catch {}
  const ya = lista.some((e) => { try { return new URL(e.url).searchParams.get('off') === oferta; } catch { return false; } });
  if (ya) console.log('  1. la oferta ya está en los enlaces de venta');
  else {
    const nueva = {
      id: 'mensualidad-basica-25-servicios',
      nombre: 'Mensualidad básica (oferta en Servicios adicionales)',
      tipo: 'NORMAL',
      periodicidad: 'MENSUAL',
      precioUsd: 25,
      url: `https://pay.hotmart.com/U102596072A?off=${oferta}`,
      activo: false,
    };
    console.log('  1. agrego enlace de venta INACTIVO:', JSON.stringify(nueva));
    if (aplicar) {
      const valor = JSON.stringify([...lista, nueva]);
      await prisma.setting.upsert({ where: { key: 'landing.enlacesDeVenta' }, update: { value: valor }, create: { key: 'landing.enlacesDeVenta', value: valor } });
    }
  }

  // 2. Pago pendiente de activar.
  const pend = await prisma.pendingHotmartPayment.findFirst({ where: { email, transactionId: tx } });
  if (pend) console.log(`  2. ya existe el pago pendiente (consumido: ${pend.consumedAt ? 'sí' : 'no'})`);
  else {
    console.log('  2. creo el pago pendiente de activar (sin avisar al comprador)');
    if (aplicar) {
      await prisma.pendingHotmartPayment.create({
        data: {
          email,
          transactionId: tx,
          subscriberCode: d.subscription?.subscriber?.code ?? null,
          event: payload.event || 'PURCHASE_APPROVED',
          rawPayload: payload,
          whiteLabelId: null,
        },
      });
    }
  }

  // 3. La compra de créditos sin asignar.
  const cp = await prisma.hotmartCreditPurchase.findUnique({ where: { transactionId: tx }, select: { id: true, status: true } });
  if (cp && cp.status === 'UNASSIGNED') {
    console.log('  3. la compra de créditos UNASSIGNED pasa a IGNORED');
    if (aplicar) await prisma.hotmartCreditPurchase.update({ where: { id: cp.id }, data: { status: 'IGNORED' } });
  } else console.log(`  3. compra de créditos: ${cp ? cp.status : 'no existe'} — sin cambios`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
