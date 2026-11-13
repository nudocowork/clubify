// SOLO LECTURA. Por qué las notificaciones no les llegan a las tarjetas de
// alianza de un negocio (Altieri, 2026-11-13).
//
// Por cada alianza: su tarjeta, cuántos pases tiene y cuántos están de verdad
// en un celular (Apple con dispositivo registrado / Google con objeto). Luego
// los últimos envíos del negocio con su resultado (stats: targeted/delivered).
//
//   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
//     node scripts/diag-push-alianzas.cjs altieri
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const busca = process.argv[2] || 'altieri';
const d = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—');
const seguro = (q) => q.catch((e) => { console.log('   (no se pudo leer:', e.message.split('\n').pop(), ')'); return []; });

(async () => {
  const ts = await p.$queryRawUnsafe(
    `SELECT id, slug, "brandName", status FROM "Tenant"
      WHERE "deletedAt" IS NULL AND ("brandName" ILIKE $1 OR slug ILIKE $1 OR name ILIKE $1)`, `%${busca}%`);
  for (const t of ts) {
    console.log(`\n=== ${t.brandName} (${t.slug}) ${t.status}`);
    const cards = await seguro(p.$queryRawUnsafe(
      `SELECT c.id, c.name, c."convenioId", v.name AS empresa, v.status AS estado_alianza,
              count(ps.id)::int pases,
              count(ps.id) FILTER (WHERE ps.status = 'ACTIVE')::int activos,
              count(ps.id) FILTER (WHERE ps."googleObjectId" IS NOT NULL)::int google,
              count(ps.id) FILTER (WHERE EXISTS (SELECT 1 FROM "WalletDevice" w WHERE w."passId" = ps.id AND w.platform = 'APPLE'))::int apple,
              count(ps.id) FILTER (WHERE ps."walletInstalledAt" IS NOT NULL)::int instaladas
         FROM "Card" c
         LEFT JOIN "Convenio" v ON v.id = c."convenioId"
         LEFT JOIN "Pass" ps ON ps."cardId" = c.id
        WHERE c."tenantId" = $1
        GROUP BY c.id, c.name, c."convenioId", v.name, v.status
        ORDER BY (c."convenioId" IS NULL), c.name`, t.id));
    for (const c of cards) {
      console.log(`  ${c.convenioId ? 'ALIANZA' : 'tarjeta'} «${c.name}» ${c.empresa ? `(${c.empresa}, ${c.estado_alianza})` : ''} · pases ${c.pases} · activos ${c.activos} · instalados ${c.instaladas} · Apple ${c.apple} · Google ${c.google} · id ${c.id}`);
    }
    const notifs = await seguro(p.$queryRawUnsafe(
      `SELECT n."createdAt", n."sentAt", n."scheduledAt", n."triggerType", n."cardId", c.name AS tarjeta,
              c."convenioId" IS NOT NULL AS de_alianza, n."customerId" IS NOT NULL AS individual,
              left(n.title, 50) titulo, n.stats
         FROM "Notification" n LEFT JOIN "Card" c ON c.id = n."cardId"
        WHERE n."tenantId" = $1 AND n."customerId" IS NULL AND n."createdAt" >= now() - interval '45 days'
        ORDER BY n."createdAt" DESC LIMIT 25`, t.id));
    console.log(`  envíos masivos en 45 días: ${notifs.length}`);
    for (const n of notifs) {
      console.log(`    ${d(n.createdAt)} ${n.triggerType} → ${n.tarjeta ?? 'TODAS'}${n.de_alianza ? ' (alianza)' : ''} · enviado ${d(n.sentAt)}${n.scheduledAt ? ' · programado ' + d(n.scheduledAt) : ''} · «${n.titulo}» ${JSON.stringify(n.stats)}`);
    }
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
