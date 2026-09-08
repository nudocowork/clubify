/**
 * SOLO LECTURA: el rastro de auditoría de una suspensión.
 *
 * `auditLifecycle` escribe en AuditLog (resource='subscription'), no en Event.
 * Si el negocio recibió «cuenta pausada» tiene que haber ahí un
 * `subscription.suspended` con su hora. Si no lo hay, el mensaje salió por una
 * vía que NO suspende — y eso es el defecto.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2] || 'Quipao';
const f = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { brandName: { contains: NOMBRE, mode: 'insensitive' } },
      select: { id: true, brandName: true, whiteLabelId: true },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);
    console.log(`${t.brandName} · ${t.id}`);

    if (t.whiteLabelId) {
      const wl = await p.whiteLabel.findUnique({
        where: { id: t.whiteLabelId },
        select: { name: true, slug: true, paymentGateway: true },
      });
      console.log(`marca blanca: ${wl?.name} (${wl?.slug}) · pasarela ${wl?.paymentGateway}`);
      console.log(
        `  → ¿entra al cron de mora de Clubify?  ${
          wl?.slug === 'clubify' || wl?.paymentGateway === 'STRIPE' ? 'SÍ' : 'NO'
        }`,
      );
    }

    const audit = await p.auditLog.findMany({
      where: { tenantId: t.id },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { createdAt: true, action: true, resource: true, metadata: true },
    });
    console.log(`\nauditoría (${audit.length}):`);
    for (const a of audit) {
      console.log(
        `  ${f(a.createdAt)}  ${a.action.padEnd(34)} ${(a.resource ?? '').padEnd(14)} ` +
          JSON.stringify(a.metadata ?? {}),
      );
    }

    // Todos los negocios que recibieron «cuenta pausada» en los ultimos 15 dias:
    // cuantos siguen activos. Si el mensaje y el estado no casan, sale aqui.
    const desde = new Date(Date.now() - 15 * 24 * 3600 * 1000);
    const pausados = await p.messageLog.findMany({
      where: { templateId: 'account_paused', createdAt: { gte: desde } },
      select: { tenantId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`\n«cuenta pausada» enviados en 15 días: ${pausados.length}`);
    for (const m of pausados) {
      if (!m.tenantId) continue;
      const n = await p.tenant.findUnique({
        where: { id: m.tenantId },
        select: { brandName: true, status: true, suspendedAt: true, lastChargeAt: true },
      });
      if (!n) continue;
      const casa = n.status === 'SUSPENDED' || (n.lastChargeAt && n.lastChargeAt > m.createdAt);
      console.log(
        `  ${f(m.createdAt)}  ${(n.brandName ?? '').padEnd(26)} ahora ${n.status.padEnd(10)} ` +
          `pausado ${f(n.suspendedAt).padEnd(17)} últ. cobro ${f(n.lastChargeAt).padEnd(17)} ` +
          `${casa ? '' : '← EL MENSAJE NO CUADRA CON EL ESTADO'}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
