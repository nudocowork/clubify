/** SOLO LECTURA: de dónde salieron los mensajes que recibió ese cliente. */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { name: { contains: 'Extreme', mode: 'insensitive' } },
      select: { id: true, name: true, growBusinessLocationId: true },
    });
    if (!t) return console.log('no encuentro el negocio');
    console.log(`${t.name} · GHL: ${t.growBusinessLocationId ? 'conectado' : 'no'}`);

    const reglas = await p.automationRule.findMany({
      where: { tenantId: t.id },
      select: { name: true, isActive: true, trigger: true, actions: true },
    });
    console.log(`\nreglas: ${reglas.length}`);
    for (const r of reglas) {
      const canales = (Array.isArray(r.actions) ? r.actions : [])
        .map((a) => a?.type)
        .join(', ');
      console.log(
        `  ${r.isActive ? 'ON ' : 'off'} ${r.name} · ${(r.trigger || {}).type} · ${canales}`,
      );
    }

    // Lo que SALIÓ de verdad por SMS/WhatsApp desde nuestro sistema.
    const enviados = await p.messageLog.findMany({
      where: { tenantId: t.id },
      select: { channel: true, createdAt: true, status: true, preview: true, feature: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    console.log(`\núltimos mensajes registrados: ${enviados.length}`);
    for (const m of enviados) {
      console.log(
        `  ${m.createdAt.toISOString().slice(0, 16)} · ${m.channel} · ${m.status}`,
      );
      console.log(`     ${(m.body || '').slice(0, 90)}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
