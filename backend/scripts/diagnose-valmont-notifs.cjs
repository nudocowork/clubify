// READ-ONLY. Historial de notificaciones de Valmont: ¿se han enviado? ¿fallan?
const { PrismaClient } = require('@prisma/client');
(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const t = await prisma.tenant.findFirst({ where: { slug: { contains: 'valmont', mode: 'insensitive' } }, select: { id: true } });

  const total = await prisma.notification.count({ where: { tenantId: t.id } });
  const sent = await prisma.notification.count({ where: { tenantId: t.id, sentAt: { not: null } } });
  const pending = await prisma.notification.count({ where: { tenantId: t.id, sentAt: null } });
  console.log(`Notificaciones Valmont: total=${total} | enviadas=${sent} | sin enviar=${pending}`);

  const byTrigger = await prisma.notification.groupBy({ by: ['triggerType'], where: { tenantId: t.id }, _count: true });
  console.log('Por tipo:', byTrigger.map((r) => `${r.triggerType}=${r._count}`).join(', ') || '—');

  const recent = await prisma.notification.findMany({
    where: { tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 10,
    select: { triggerType: true, createdAt: true, sentAt: true, customerId: true },
  });
  console.log('\nÚltimas 10:');
  recent.forEach((n) => console.log(`  ${new Date(n.createdAt).toISOString().slice(0,16).replace('T',' ')} | ${n.triggerType} | ${n.sentAt ? 'ENVIADA '+new Date(n.sentAt).toISOString().slice(0,10) : 'SIN ENVIAR ⏳'} | ${n.customerId ? 'individual' : 'broadcast'}`));

  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
