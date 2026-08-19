// Dispara un envío de prueba REAL del módulo de email marketing de Sellea:
// firma un JWT de un admin de Sellea y llama POST /api/admin/marketing/test-send.
// Usage: railway run --service backend node scripts/send-sellea-marketing-test.cjs <email>
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const SELLEA_WL = '5c13ca30-97f0-48e2-99a9-a168cada7714';
const TO = process.argv[2] || 'jhonarias888@gmail.com';

(async () => {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({
    where: { role: 'SUPER_ADMIN', whiteLabelId: SELLEA_WL },
    select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true },
  });
  if (!admin) { console.log('No hay SUPER_ADMIN de Sellea.'); await prisma.$disconnect(); return; }

  const token = jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role, tenantId: admin.tenantId, whiteLabelId: admin.whiteLabelId },
    process.env.JWT_SECRET, { expiresIn: '5m' },
  );
  const r = await fetch('https://api.soyclubify.com/api/admin/marketing/test-send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'email',
      to: TO,
      subject: 'Prueba de Email Marketing ✅ (Sellea)',
      body: '<p>¡Hola! 👋</p><p>Este es un <b>envío de prueba</b> del nuevo motor de Email Marketing de Sellea. Si te llegó, el envío por correo funciona de punta a punta.</p>',
    }),
  });
  console.log(`POST /admin/marketing/test-send (to=${TO}) → HTTP ${r.status}`);
  console.log(await r.text());
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
