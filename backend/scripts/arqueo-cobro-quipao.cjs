/**
 * SOLO LECTURA: por qué a un negocio no le llegó la secuencia de cobro.
 *
 * El cron de recordatorios tiene seis puertas y basta con que una esté cerrada
 * para que no salga nada, sin error en ningún sitio. Este script las recorre
 * todas y dice cuál es.
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
        status: true,
        isCampaignHost: true,
        currentPeriodEnd: true,
        lastChargeAt: true,
        planPeriodicity: true,
        preReminder7dSentFor: true,
        billingAlertsEnabled: true,
        billingAlertsPhone: true,
        whatsappPhone: true,
        phone: true,
        whiteLabelId: true,
        whiteLabel: { select: { slug: true, paymentGateway: true } },
      },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);

    console.log(`${t.name}\n`);
    const ok = (b) => (b ? 'OK  ' : 'NO  ');

    console.log(`${ok(t.status === 'ACTIVE')}status = ${t.status}`);
    console.log(`${ok(!t.isCampaignHost)}no es host de campaña`);

    const marcaOk =
      !t.whiteLabelId ||
      t.whiteLabel?.slug === 'clubify' ||
      t.whiteLabel?.paymentGateway === 'STRIPE';
    console.log(
      `${ok(marcaOk)}marca elegible (marca: ${t.whiteLabel?.slug ?? 'sin marca'}` +
        `, pasarela: ${t.whiteLabel?.paymentGateway ?? '-'})`,
    );

    const dia = 86400000;
    const ahora = new Date();
    const dentro = t.currentPeriodEnd
      ? Math.round((t.currentPeriodEnd.getTime() - ahora.getTime()) / dia)
      : null;
    console.log(
      `${ok(dentro !== null && dentro >= 6 && dentro < 8)}` +
        `proximo cobro: ${t.currentPeriodEnd?.toISOString().slice(0, 10) ?? 'SIN FECHA'}` +
        (dentro === null ? '' : ` (dentro de ${dentro} dias; la ventana es 6-8)`),
    );

    const yaEnviado =
      t.preReminder7dSentFor &&
      t.currentPeriodEnd &&
      t.preReminder7dSentFor.getTime() === t.currentPeriodEnd.getTime();
    console.log(
      `${ok(!yaEnviado)}no marcado como ya enviado ` +
        `(${t.preReminder7dSentFor?.toISOString().slice(0, 10) ?? 'nunca'})`,
    );

    const tel = t.billingAlertsPhone || t.whatsappPhone || t.phone;
    console.log(`${ok(!!tel)}hay telefono en el negocio`);
    console.log(`${ok(t.billingAlertsEnabled)}avisos de cobro encendidos`);

    const dueno = await p.user.findFirst({
      where: { tenantId: t.id, role: 'TENANT_OWNER', isActive: true },
      select: { phone: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(
      `${ok(!!(dueno?.phone || tel))}destino final: ` +
        `${dueno?.phone ? 'movil del dueno' : tel ? 'telefono del negocio' : 'NINGUNO'}`,
    );

    const logs = await p.messageLog.findMany({
      where: { tenantId: t.id, feature: 'billing' },
      select: { createdAt: true, channel: true, status: true, templateId: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    });
    console.log(`\nmensajes de cobro registrados: ${logs.length}`);
    for (const m of logs) {
      console.log(
        `  ${m.createdAt.toISOString().slice(0, 16)} · ${m.channel} · ${m.templateId} · ${m.status}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})();
