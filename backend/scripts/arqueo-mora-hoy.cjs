/**
 * SOLO LECTURA: quién está en mora ahora mismo y en qué día va.
 *
 * Sirve para comprobar que los avisos de los días de gracia (3, 4 y 5) van a
 * salir esta noche. Quipao no los recibió porque el arreglo se desplegó el
 * 2026-09-06 a las 17:11, después del cron de ese día: su ciclo entero cayó
 * en el hueco y pasó del aviso del día 2 a la suspensión sin nada en medio.
 */
const { PrismaClient } = require('@prisma/client');

const f = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');
const dias = (a, b) => Math.floor((b - a) / 86400000);

(async () => {
  const p = new PrismaClient();
  const now = new Date();
  try {
    const candidatos = await p.tenant.findMany({
      where: {
        status: 'ACTIVE',
        isCampaignHost: false,
        AND: [
          {
            OR: [
              { whiteLabelId: null },
              { whiteLabel: { slug: 'clubify' } },
              { whiteLabel: { paymentGateway: 'STRIPE' } },
            ],
          },
          {
            OR: [
              { failedPaymentCount: { gt: 0 } },
              { currentPeriodEnd: { lt: now } },
            ],
          },
        ],
      },
      select: {
        brandName: true,
        failedPaymentCount: true,
        firstFailedAt: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        manualPayment: true,
        paymentFailureNoticeSentAt: true,
        pausePendingNoticeSentAt: true,
        graceNoticeSentAt: true,
      },
    });

    console.log(`negocios que el cron mirará esta noche: ${candidatos.length}\n`);
    for (const t of candidatos) {
      const ancla = t.firstFailedAt ?? t.currentPeriodEnd;
      const d = ancla ? dias(new Date(ancla).getTime(), now.getTime()) : null;
      const etapa =
        d === null ? '?' : d <= 0 ? 'aún no' : d === 1 ? 'D+1 recordatorio'
        : d === 2 ? 'D+2 no procesado' : d < 5 ? `D+${d} GRACIA`
        : d === 5 ? 'D+5 última llamada' : `D+${d} SUSPENDE`;
      console.log(
        `  ${(t.brandName ?? '').padEnd(28)} ${String(d).padStart(3)}d  ${etapa.padEnd(20)} ` +
          `fallos ${t.failedPaymentCount}  vence ${f(t.currentPeriodEnd)}  ` +
          `avisado gracia ${f(t.graceNoticeSentAt)}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
