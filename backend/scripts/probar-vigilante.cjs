/**
 * SOLO LECTURA: qué diría hoy el vigilante, sin mandar nada.
 *
 * Un vigilante que avisa de más se ignora en una semana, así que antes de
 * encenderlo hay que ver el mensaje real contra los datos reales. Replica las
 * mismas cuatro comprobaciones que `vigilante.service.ts`.
 */
const { PrismaClient } = require('@prisma/client');
const DIA = 86400000;

(async () => {
  const p = new PrismaClient();
  const hallazgos = [];
  try {
    // 1 · Mora que nadie vio
    const fallos = await p.hotmartWebhookEvent.findMany({
      where: {
        eventType: { in: ['PURCHASE_DELAYED', 'PURCHASE_PROTEST'] },
        processedAt: { gte: new Date(Date.now() - 30 * DIA) },
        tenantId: { not: null },
      },
      select: { tenantId: true, processedAt: true },
      orderBy: { processedAt: 'desc' },
    });
    const ultimo = new Map();
    for (const f of fallos) if (!ultimo.has(f.tenantId)) ultimo.set(f.tenantId, f.processedAt);
    const sospechosos = await p.tenant.findMany({
      where: { id: { in: [...ultimo.keys()] }, status: 'ACTIVE', failedPaymentCount: 0 },
      select: { id: true, name: true, lastChargeAt: true },
    });
    const rotos = sospechosos.filter(
      (t) => !t.lastChargeAt || t.lastChargeAt < ultimo.get(t.id),
    );
    if (rotos.length) {
      hallazgos.push(`Mora invisible (${rotos.length}): ${rotos.map((t) => t.name).join(', ')}`);
    }

    // 2 · Fecha distinta de Hotmart
    const tenants = await p.tenant.findMany({
      where: {
        status: 'ACTIVE',
        hotmartSubscriberCode: { not: null },
        currentPeriodEnd: { not: null },
      },
      select: { id: true, name: true, currentPeriodEnd: true },
    });
    const ev = await p.hotmartWebhookEvent.findMany({
      where: {
        tenantId: { in: tenants.map((t) => t.id) },
        eventType: { in: ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE'] },
      },
      select: { tenantId: true, payload: true, processedAt: true },
      orderBy: { processedAt: 'desc' },
    });
    const fhm = new Map();
    for (const e of ev) {
      if (fhm.has(e.tenantId)) continue;
      const ms = e.payload?.data?.purchase?.date_next_charge;
      if (typeof ms === 'number') fhm.set(e.tenantId, new Date(ms));
    }
    const desviados = tenants.filter((t) => {
      const hm = fhm.get(t.id);
      return hm && Math.abs(hm - t.currentPeriodEnd) > 2 * DIA;
    });
    if (desviados.length) {
      hallazgos.push(
        `Fecha distinta de Hotmart (${desviados.length}): ` +
          desviados.slice(0, 5).map((t) => t.name).join(', '),
      );
    }

    // 3 · Pedidos sin aviso
    const desde = new Date(Date.now() - 36 * 3600 * 1000);
    const pedidos = await p.order.findMany({
      where: { createdAt: { gte: desde } },
      select: { id: true },
    });
    const avisados = await p.event.findMany({
      where: { type: 'order.owner_alert_sent', createdAt: { gte: desde } },
      select: { payload: true },
    });
    const ids = new Set(avisados.map((e) => e.payload?.orderId).filter(Boolean));
    const sin = pedidos.filter((o) => !ids.has(o.id));
    console.log(`(pedidos en 36h: ${pedidos.length} · sin aviso: ${sin.length})`);
    if (pedidos.length && sin.length >= Math.max(3, pedidos.length * 0.1)) {
      hallazgos.push(`Pedidos sin aviso (${sin.length} de ${pedidos.length})`);
    }

    // 4 · Negocios sin teléfono
    const mudos = await p.tenant.findMany({
      where: {
        status: 'ACTIVE',
        phone: null,
        whatsappPhone: null,
        whatsappOrdersPhone: null,
      },
      select: { id: true, name: true },
    });
    const conDueno = await p.user.findMany({
      where: {
        tenantId: { in: mudos.map((t) => t.id) },
        role: 'TENANT_OWNER',
        isActive: true,
        phone: { not: null },
      },
      select: { tenantId: true },
    });
    const cubiertos = new Set(conDueno.map((u) => u.tenantId));
    const huerfanos = mudos.filter((t) => !cubiertos.has(t.id));
    if (huerfanos.length) {
      hallazgos.push(
        `Sin ningun telefono (${huerfanos.length}): ${huerfanos.map((t) => t.name).join(', ')}`,
      );
    }

    console.log('\n───────── el mensaje que se mandaria hoy ─────────');
    if (!hallazgos.length) console.log('(ninguno: no se manda nada)');
    else {
      console.log(`Clubify - revision diaria: ${hallazgos.length} cosa(s) que mirar.\n`);
      for (const h of hallazgos) console.log(h);
    }
    console.log('──────────────────────────────────────────────────');
  } finally {
    await p.$disconnect();
  }
})();
