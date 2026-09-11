/**
 * Devuelve el estado de mora a los negocios a los que el candado viejo se lo
 * borró.
 *
 * EL FALLO (arreglado en `dunning.ts → esMoraFantasma` el 2026-09-11)
 * ------------------------------------------------------------------
 * El candado anti-mora-fantasma decía: «hay fallo pero el ciclo sigue vigente
 * → contador viejo, se borra». A MYKOZ le llegó un `PURCHASE_DELAYED` REAL el
 * 2026-09-03 con la fecha de ciclo desincronizada hacia octubre, y el candado
 * le borró el fallo: figuró al día, **no recibió ni un aviso** y no se
 * suspendió, con su último cobro real en abril.
 *
 * El arreglo evita que vuelva a pasar. Esto recupera lo ya borrado, leyendo la
 * verdad de donde no se puede perder: los eventos de Hotmart.
 *
 *   railway run node scripts/restaurar-mora-borrada.cjs                 (ensayo)
 *   railway run node scripts/restaurar-mora-borrada.cjs --aplicar
 *   railway run node scripts/restaurar-mora-borrada.cjs --aplicar --desde-hoy
 *
 * `--desde-hoy` ancla la gracia en HOY en vez de en la fecha real del fallo.
 * Importa: con la fecha real, un negocio con el fallo de hace 8 días entra
 * directo en suspensión sin haber recibido nunca un aviso. Con `--desde-hoy`
 * recibe primero sus recordatorios y se suspende al agotar la gracia.
 *
 * NO manda nada por sí mismo: solo repone los campos. Quien avisa y suspende es
 * el cron de cobros, en su siguiente pasada.
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const DESDE_HOY = process.argv.includes('--desde-hoy');
const FALLIDOS = ['PURCHASE_DELAYED', 'PURCHASE_PROTEST'];

(async () => {
  const p = new PrismaClient();
  try {
    const eventos = await p.hotmartWebhookEvent.findMany({
      where: { eventType: { in: FALLIDOS }, tenantId: { not: null } },
      select: { tenantId: true, processedAt: true, eventType: true },
      orderBy: { processedAt: 'desc' },
    });
    // El más reciente por negocio.
    const ultimo = new Map();
    for (const e of eventos) {
      if (!ultimo.has(e.tenantId)) ultimo.set(e.tenantId, e);
    }
    if (!ultimo.size) {
      console.log('No hay eventos de cobro fallido. Nada que hacer.');
      return;
    }

    const tenants = await p.tenant.findMany({
      where: {
        id: { in: [...ultimo.keys()] },
        status: 'ACTIVE',
        failedPaymentCount: 0,
        canceledAt: null,
      },
      select: {
        id: true, slug: true, brandName: true,
        lastChargeAt: true, currentPeriodEnd: true, firstFailedAt: true,
      },
    });

    // Solo los que NO pagaron después del fallo: ésa es la regla que separa la
    // mora real del fantasma, la misma que `esMoraFantasma`.
    const rotos = tenants.filter((t) => {
      const ev = ultimo.get(t.id);
      if (!ev?.processedAt) return false;
      return !t.lastChargeAt || t.lastChargeAt.getTime() <= ev.processedAt.getTime();
    });

    console.log(`Negocios con cobro fallido y el contador en 0: ${rotos.length}\n`);
    const ahora = new Date();
    for (const t of rotos) {
      const ev = ultimo.get(t.id);
      const dias = Math.floor((ahora - ev.processedAt) / 86400000);
      console.log(
        `  ${String(t.slug).padEnd(22)} ${ev.eventType.padEnd(18)} ` +
          `fallo=${ev.processedAt.toISOString().slice(0, 10)} (hace ${dias}d)  ` +
          `ultimo cobro=${t.lastChargeAt ? t.lastChargeAt.toISOString().slice(0, 10) : 'NUNCA'}  ` +
          `fin de ciclo=${t.currentPeriodEnd ? t.currentPeriodEnd.toISOString().slice(0, 10) : '—'}`,
      );
    }

    if (!rotos.length) return;
    if (!APLICAR) {
      console.log(
        `\nENSAYO. Nada cambiado. Repite con --aplicar` +
          `${DESDE_HOY ? ' --desde-hoy' : ''}.`,
      );
      console.log(
        'Ojo: al reponerlo, el cron de cobros empezara a avisar y podra suspender.',
      );
      return;
    }

    for (const t of rotos) {
      const ev = ultimo.get(t.id);
      const ancla = DESDE_HOY ? ahora : ev.processedAt;
      await p.tenant.update({
        where: { id: t.id },
        data: {
          failedPaymentCount: 1,
          firstFailedAt: ancla,
          lastPaymentAttemptAt: ev.processedAt,
          // Se limpian los sellos de «ya avisé» para que los avisos que nunca
          // salieron puedan salir ahora. Sin esto el cron los daría por
          // enviados y el negocio seguiría sin enterarse.
          paymentFailureNoticeSentAt: null,
          pausePendingNoticeSentAt: null,
          graceNoticeSentAt: null,
        },
      });
      console.log(
        `  REPUESTO  ${t.slug}  gracia anclada en ${ancla.toISOString().slice(0, 10)}` +
          `${DESDE_HOY ? '  (desde hoy)' : '  (fecha real del fallo)'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
