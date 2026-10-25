// Busca un correo en el texto crudo de webhooks, pagos pendientes y negocios (por si quedó con mayúsculas o en otro campo).
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const q = '%' + (process.argv[2] || '').toLowerCase() + '%';
  const ev = await prisma.$queryRawUnsafe(`SELECT "processedAt", "eventType", "tenantId", left(payload::text, 0) AS x FROM "HotmartWebhookEvent" WHERE lower(payload::text) LIKE $1 ORDER BY "processedAt"`, q);
  console.log('webhooks:', ev.length); for (const e of ev) console.log(' ', e.processedAt.toISOString(), e.eventType, e.tenantId);
  const pe = await prisma.$queryRawUnsafe(`SELECT "createdAt", email, event, "consumedAt" FROM "PendingHotmartPayment" WHERE lower("rawPayload"::text) LIKE $1 OR lower(email) LIKE $1`, q);
  console.log('pendientes:', pe.length, JSON.stringify(pe));
  const te = await prisma.$queryRawUnsafe(`SELECT id, name, slug, status, "createdAt" FROM "Tenant" WHERE lower(email) LIKE $1 OR lower(name) LIKE '%27 grados%' OR lower(name) LIKE '%27grados%' OR lower(slug) LIKE '%27-grados%' OR lower(slug) LIKE '%27grados%'`, q);
  console.log('negocios:', JSON.stringify(te));
  const ul = await prisma.$queryRawUnsafe(`SELECT id, email, role, "tenantId", "createdAt" FROM "User" WHERE lower(email) LIKE $1`, q);
  console.log('usuarios:', JSON.stringify(ul));
  const ml = await prisma.$queryRawUnsafe(`SELECT "createdAt", channel, status, feature, "toPhone", left(preview, 120) p FROM "MessageLog" WHERE lower(coalesce(preview,'')) LIKE $1 OR lower(coalesce("toEmail",'')) LIKE $1 OR lower(coalesce(preview,'')) LIKE '%27 grados%' ORDER BY "createdAt"`, q);
  console.log('mensajes:', ml.length); for (const m of ml) console.log(' ', m.createdAt.toISOString(), m.channel, m.status, m.feature, m.toPhone, '|', (m.p || '').replace(/\s+/g, ' '));
  const ingr = await prisma.$queryRawUnsafe(`SELECT * FROM "IncomeRecord" WHERE lower(row_to_json("IncomeRecord")::text) LIKE $1 LIMIT 5`, q).catch((e) => 'err ' + e.message.slice(0, 80));
  console.log('ingresos:', JSON.stringify(ingr).slice(0, 600));
}
main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
