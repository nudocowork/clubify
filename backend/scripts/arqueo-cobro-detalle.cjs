/**
 * SOLO LECTURA: el ciclo de cobro de un negocio, en detalle.
 *
 * `preReminder7dSentFor` guarda PARA QUÉ fecha de cobro se mandó el aviso. Si
 * esa fecha es POSTERIOR a `currentPeriodEnd`, el próximo cobro se movió hacia
 * ATRÁS después de avisar — y entonces el negocio aparece vencido sin haber
 * hecho nada.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2] || 'Quipao';

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { name: { contains: NOMBRE, mode: 'insensitive' } },
      select: {
        id: true,
        name: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        preReminder7dSentFor: true,

        hotmartSubscriberCode: true,
        createdAt: true,
      },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);
    const d = (x) => (x ? x.toISOString().slice(0, 10) : '—');

    console.log(`${t.name}`);
    console.log(`  alta:              ${d(t.createdAt)}`);
    console.log(`  periodicidad:      ${t.planPeriodicity ?? '—'}`);
    console.log(`  último cobro:      ${d(t.lastChargeAt)}`);
    console.log(`  próximo cobro:     ${d(t.currentPeriodEnd)}`);
    console.log(`  aviso 7d para:     ${d(t.preReminder7dSentFor)}`);

    console.log(`  suscripción HM:    ${t.hotmartSubscriberCode ?? '—'}`);

    if (t.preReminder7dSentFor && t.currentPeriodEnd) {
      const dif = Math.round(
        (t.preReminder7dSentFor.getTime() - t.currentPeriodEnd.getTime()) / 86400000,
      );
      if (dif !== 0) {
        console.log(
          `\n  ⚠ el aviso se mandó para una fecha ${dif} días DISTINTA de la` +
            ' actual: el próximo cobro se movió después de avisar',
        );
      }
    }

    const ev = await p.event.findMany({
      where: {
        tenantId: t.id,
        type: { in: ['billing.charged', 'billing.period_updated', 'tenant.suspended'] },
      },
      select: { type: true, createdAt: true, payload: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    console.log(`\n  eventos de cobro: ${ev.length}`);
    for (const e of ev) {
      console.log(`   ${e.createdAt.toISOString().slice(0, 16)} · ${e.type}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
