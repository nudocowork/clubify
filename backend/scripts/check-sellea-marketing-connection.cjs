// Verifica el módulo de email marketing END-TO-END en prod: firma un JWT de un
// admin de Sellea y llama GET /api/admin/marketing/connection (getConnectionInfo).
// No envía nada. Usage: railway run --service backend node scripts/check-sellea-marketing-connection.cjs
const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');

const SELLEA_WL = '5c13ca30-97f0-48e2-99a9-a168cada7714';

(async () => {
  const prisma = new PrismaClient();
  const admin =
    (await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', whiteLabelId: SELLEA_WL }, select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true } })) ||
    (await prisma.user.findFirst({ where: { role: 'PLATFORM_OWNER', whiteLabelId: SELLEA_WL }, select: { id: true, email: true, role: true, tenantId: true, whiteLabelId: true } }));
  if (!admin) { console.log('No hay admin (SUPER_ADMIN/PLATFORM_OWNER) para Sellea.'); await prisma.$disconnect(); return; }
  console.log(`admin=${admin.email} role=${admin.role} wl=${admin.whiteLabelId}`);

  const token = jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role, tenantId: admin.tenantId, whiteLabelId: admin.whiteLabelId },
    process.env.JWT_SECRET, { expiresIn: '5m' },
  );
  const r = await fetch('https://api.soyclubify.com/api/admin/marketing/connection', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`\nGET /admin/marketing/connection → HTTP ${r.status}`);
  console.log(await r.text());
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
