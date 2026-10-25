// Qué pasó con un comprador de Hotmart: pago pendiente, negocio, usuario, avisos y mensajes enviados.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const co = (d) => (d ? new Date(new Date(d).getTime() - 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' COL' : '—');
async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const pend = await prisma.pendingHotmartPayment.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, orderBy: { createdAt: 'asc' } });
  console.log(`\n== Pagos pendientes (${pend.length})`);
  for (const p of pend) {
    const r = p.rawPayload || {}; const d = r.data || r;
    const buyer = d.buyer || {}; const pur = d.purchase || {}; const sub = d.subscription || {};
    console.log(`  ${co(p.createdAt)} ${p.event} tx=${p.transactionId} sub=${p.subscriberCode} consumido=${co(p.consumedAt)} recuperación=${co(p.recoveryNotifiedAt)} equipo=${co(p.teamReminderSentAt)} rec1=${co(p.buyerReminder1At)} rec2=${co(p.buyerReminder2At)} rec3=${co(p.buyerReminder3At)}`);
    console.log(`    comprador: ${buyer.name} · tel=${buyer.checkout_phone || buyer.phone || '—'} · ${buyer.address?.country || ''} · oferta=${pur.offer?.code} · ${pur.price?.value} ${pur.price?.currency_value} · plan=${sub.plan?.name}`);
  }
  const users = await prisma.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, role: true, tenantId: true, createdAt: true, lastLoginAt: true } }).catch(async () => prisma.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, role: true, tenantId: true, createdAt: true } }));
  console.log(`\n== Usuarios (${users.length})`); for (const u of users) console.log('  ', JSON.stringify(u));
  const tenants = await prisma.tenant.findMany({ where: { OR: [{ email: { equals: email, mode: 'insensitive' } }, { id: { in: users.map((u) => u.tenantId).filter(Boolean) } }] }, select: { id: true, name: true, slug: true, status: true, createdAt: true, planPeriodicity: true, subscriptionPriceUsd: true, hotmartSubscriberCode: true, lastChargeAt: true, phone: true } });
  console.log(`\n== Negocios (${tenants.length})`); for (const t of tenants) console.log('  ', JSON.stringify(t));
  const msgs = await prisma.messageLog.findMany({ where: { OR: [{ toEmail: { equals: email, mode: 'insensitive' } }, { preview: { contains: email, mode: 'insensitive' } }, ...(tenants.length ? [{ tenantId: { in: tenants.map((t) => t.id) } }] : [])] }, orderBy: { createdAt: 'asc' }, take: 40, select: { createdAt: true, channel: true, status: true, toPhone: true, toEmail: true, feature: true, preview: true } });
  console.log(`\n== Mensajes (${msgs.length})`); for (const m of msgs) console.log(`  ${co(m.createdAt)} ${m.channel} ${m.status} ${m.feature ?? ''} → ${m.toPhone ?? m.toEmail ?? ''} | ${(m.preview ?? '').replace(/\s+/g, ' ').slice(0, 110)}`);
  const ev = await prisma.hotmartWebhookEvent.findMany({ where: { payload: { string_contains: email } }, orderBy: { processedAt: 'asc' }, select: { processedAt: true, eventType: true, tenantId: true } }).catch(() => []);
  console.log(`\n== Webhooks (${ev.length})`); for (const e of ev) console.log(`  ${co(e.processedAt)} ${e.eventType} tenant=${e.tenantId ?? '—'}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
