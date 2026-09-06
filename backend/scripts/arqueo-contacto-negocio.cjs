/** SOLO LECTURA: a qué número le llegan los avisos de cobro de un negocio. */
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
        phone: true,
        whatsappPhone: true,
        billingAlertsPhone: true,
        billingAlertsEnabled: true,
      },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);
    const d = await p.user.findFirst({
      where: { tenantId: t.id, role: 'TENANT_OWNER', isActive: true },
      select: { fullName: true, phone: true, email: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`${t.name}`);
    console.log(`  dueño:            ${d?.fullName ?? '—'} · ${d?.phone ?? 'sin móvil'}`);
    console.log(`  correo del dueño: ${d?.email ?? '—'}`);
    console.log(`  tel. de cobros:   ${t.billingAlertsPhone ?? '—'}`);
    console.log(`  WhatsApp negocio: ${t.whatsappPhone ?? '—'}`);
    console.log(`  tel. negocio:     ${t.phone ?? '—'}`);
    console.log(`  avisos de cobro:  ${t.billingAlertsEnabled ? 'encendidos' : 'APAGADOS'}`);
  } finally {
    await p.$disconnect();
  }
})();
