/**
 * SOLO LECTURA: quién se ha des-suspendido solo, sin pagar.
 *
 * `POST /billing/reactivate` lo puede llamar el DUEÑO del negocio (@Roles
 * TENANT_OWNER) y `/api/billing` está en la lista blanca del guard de
 * suspensión — así que una cuenta pausada por no pagar puede llamarlo. Lo que
 * hace: status SUSPENDED → TRIAL, `suspendedAt` a null y **3 días de regalo**.
 * Sin cobro de por medio y sin dejar rastro en auditoría.
 *
 * Como no se audita, se busca por la huella: negocios que tienen un
 * `subscription.suspended` en su historial y hoy NO están suspendidos ni
 * tienen un cobro posterior que lo explique.
 */
const { PrismaClient } = require('@prisma/client');

const f = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

(async () => {
  const p = new PrismaClient();
  try {
    const suspensiones = await p.auditLog.findMany({
      where: { action: 'subscription.suspended' },
      select: { tenantId: true, createdAt: true, metadata: true },
      orderBy: { createdAt: 'desc' },
    });
    console.log(`suspensiones registradas: ${suspensiones.length}`);

    // Una fila por negocio: la última suspensión.
    const ultima = new Map();
    for (const s of suspensiones) {
      if (s.tenantId && !ultima.has(s.tenantId)) ultima.set(s.tenantId, s);
    }
    console.log(`negocios distintos suspendidos alguna vez: ${ultima.size}\n`);

    console.log('negocio                        suspendido        estado hoy   últ. cobro        veredicto');
    for (const [id, s] of ultima) {
      const t = await p.tenant.findUnique({
        where: { id },
        select: {
          brandName: true,
          status: true,
          suspendedAt: true,
          lastChargeAt: true,
          trialEndsAt: true,
          trialStartedAt: true,
        },
      });
      if (!t) continue;

      const pagoDespues = t.lastChargeAt && t.lastChargeAt > s.createdAt;
      let veredicto;
      if (t.status === 'SUSPENDED') veredicto = 'sigue pausado';
      else if (pagoDespues) veredicto = 'pagó → correcto';
      else if (t.status === 'TRIAL') veredicto = '← SE REACTIVÓ SOLO, SIN PAGAR';
      else veredicto = '← activo sin cobro posterior: revisar';

      console.log(
        `${(t.brandName ?? '').slice(0, 28).padEnd(30)} ${f(s.createdAt)}  ` +
          `${t.status.padEnd(12)} ${f(t.lastChargeAt).padEnd(17)} ${veredicto}`,
      );
    }

    // Cuántas veces se ha suspendido el mismo negocio: el bucle de 3 en 3 días
    // deja esta huella.
    const veces = new Map();
    for (const s of suspensiones) {
      if (s.tenantId) veces.set(s.tenantId, (veces.get(s.tenantId) ?? 0) + 1);
    }
    const repetidores = [...veces.entries()].filter(([, n]) => n > 1);
    console.log(`\nnegocios suspendidos MÁS DE UNA VEZ: ${repetidores.length}`);
    for (const [id, n] of repetidores.sort((a, b) => b[1] - a[1])) {
      const t = await p.tenant.findUnique({
        where: { id },
        select: { brandName: true, status: true },
      });
      console.log(`  ${(t?.brandName ?? id).padEnd(30)} ${n} veces · hoy ${t?.status}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
