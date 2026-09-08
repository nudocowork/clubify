/**
 * SOLO LECTURA: por qué a un negocio le llegó «cuenta pausada» sin pausarse.
 *
 * En el cron de mora, el UPDATE a SUSPENDED va ANTES del SMS. Así que si el
 * mensaje salió y el negocio siguió activo, o alguien lo reactivó después, o
 * el mensaje salió por otra vía que no suspende.
 *
 * Imprime el estado del tenant, sus últimos mensajes de cobro y los eventos
 * de ciclo de vida, para poder ordenar la secuencia en el tiempo.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2] || 'Quipao';

const f = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { brandName: { contains: NOMBRE, mode: 'insensitive' } },
      select: {
        id: true,
        brandName: true,
        status: true,
        suspendedAt: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        failedPaymentCount: true,
        firstFailedAt: true,
        manualPayment: true,
        paymentFailureNoticeSentAt: true,
        pausePendingNoticeSentAt: true,
        graceNoticeSentAt: true,
        whiteLabelId: true,
        createdAt: true,
      },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);

    console.log(`${t.brandName}  ·  ${t.id}`);
    console.log(`  estado ahora ............ ${t.status}`);
    console.log(`  suspendedAt ............. ${f(t.suspendedAt)}`);
    console.log(`  currentPeriodEnd ........ ${f(t.currentPeriodEnd)}`);
    console.log(`  lastChargeAt ............ ${f(t.lastChargeAt)}`);
    console.log(`  periodicidad ............ ${t.planPeriodicity ?? '—'}`);
    console.log(`  cobros fallidos ......... ${t.failedPaymentCount} (1º: ${f(t.firstFailedAt)})`);
    console.log(`  paga por fuera .......... ${t.manualPayment ? 'sí' : 'no'}`);
    console.log(`  marca blanca ............ ${t.whiteLabelId ?? 'Clubify'}`);
    console.log(`  marcas de aviso:`);
    console.log(`     D+1 fallo ............ ${f(t.paymentFailureNoticeSentAt)}`);
    console.log(`     D+2 no procesado ..... ${f(t.pausePendingNoticeSentAt)}`);
    console.log(`     gracia ............... ${f(t.graceNoticeSentAt)}`);

    const msgs = await p.messageLog.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        createdAt: true,
        templateId: true,
        channel: true,
        status: true,
        toPhone: true,
        toEmail: true,
        feature: true,
      },
    });
    console.log(`\núltimos ${msgs.length} mensajes:`);
    for (const m of msgs) {
      console.log(
        `  ${f(m.createdAt)}  ${(m.channel ?? '?').padEnd(6)} ` +
          `${(m.templateId ?? '—').padEnd(28)} ${(m.status ?? '?').padEnd(9)} ` +
          `${(m.feature ?? '').padEnd(9)} ${m.toPhone ?? m.toEmail ?? ''}`,
      );
    }

    const evs = await p.event.findMany({
      where: { tenantId: t.id, type: { contains: 'subscription' } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { createdAt: true, type: true, payload: true },
    });
    console.log(`\neventos de ciclo de vida:`);
    for (const e of evs) {
      console.log(`  ${f(e.createdAt)}  ${e.type}  ${JSON.stringify(e.payload ?? {})}`);
    }

    const pagos = await p.manualPayment
      .findMany({
        where: { tenantId: t.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { createdAt: true, amount: true, paidAt: true, periodEnd: true },
      })
      .catch(() => []);
    if (pagos.length) {
      console.log(`\npagos por fuera:`);
      for (const g of pagos) {
        console.log(`  ${f(g.createdAt)}  ${g.amount}  pagado ${f(g.paidAt)}  hasta ${f(g.periodEnd)}`);
      }
    }
  } finally {
    await p.$disconnect();
  }
})();
