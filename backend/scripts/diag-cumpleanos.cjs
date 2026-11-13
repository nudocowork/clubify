// SOLO LECTURA. Por qué a los clientes de un negocio no les llega el push de
// cumpleaños (Motilart, 2026-11-12: «varios clientes dicen que no les llegó»).
//
// Recorre la cadena entera, porque se corta en sitios distintos:
//  1. el negocio: zona horaria y el candado del cron (ultimoCronCumpleanos);
//  2. hay una regla de cumpleaños ACTIVA (o un flujo multipaso con ese disparador);
//  3. sus corridas: SUCCESS / SKIPPED (condiciones) / FAILED, con el error;
//  4. los cumpleañeros de los últimos 30 días: si tienen la fecha guardada, si
//     su tarjeta está INSTALADA en el celular (sin eso no hay push posible) y
//     qué dijo el envío (Notification.stats: targeted / delivered).
//
//   railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
//     node scripts/diag-cumpleanos.cjs motilart
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const busca = process.argv[2] || 'motilart';
const d = (v) => (v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '—');
const seguro = (q) => q.catch((e) => { console.log('   (no se pudo leer:', e.message.split('\n').pop(), ')'); return []; });

(async () => {
  const ts = await p.$queryRawUnsafe(
    `SELECT id, slug, name, "brandName", status, timezone, "ultimoCronCumpleanos"
       FROM "Tenant" WHERE "deletedAt" IS NULL AND (name ILIKE $1 OR "brandName" ILIKE $1 OR slug ILIKE $1)`,
    `%${busca}%`);
  if (!ts.length) console.log('Sin negocios para', busca);
  for (const t of ts) {
    console.log(`\n=== ${t.brandName ?? t.name} (${t.slug}) ${t.status} · zona ${t.timezone ?? 'SIN ZONA'} · último cron de cumpleaños ${t.ultimoCronCumpleanos ?? 'nunca'}`);

    // 2. Reglas y flujos
    const reglas = await seguro(p.$queryRawUnsafe(
      `SELECT id, name, "isActive", trigger, conditions, actions, stats, "createdAt" FROM "AutomationRule"
        WHERE "tenantId" = $1 ORDER BY "createdAt"`, t.id));
    const deCumple = reglas.filter((r) => r.trigger?.type === 'BIRTHDAY');
    console.log(`  reglas: ${reglas.length} en total, ${deCumple.length} de cumpleaños`);
    for (const r of deCumple) {
      console.log(`  REGLA ${r.id} «${r.name}» activa=${r.isActive} creada ${d(r.createdAt)} stats=${JSON.stringify(r.stats)}`);
      console.log(`     condiciones=${JSON.stringify(r.conditions)}`);
      console.log(`     acciones=${JSON.stringify(r.actions).slice(0, 400)}`);
    }
    const flujos = await seguro(p.$queryRawUnsafe(
      `SELECT id, name, "isActive", "triggerType", stats FROM "AutomationWorkflow" WHERE "tenantId" = $1`, t.id));
    for (const f of flujos.filter((f) => f.triggerType === 'BIRTHDAY')) console.log(`  FLUJO ${f.id} «${f.name}» activo=${f.isActive} stats=${JSON.stringify(f.stats)}`);

    // 3. Corridas de las reglas de cumpleaños (60 días)
    if (deCumple.length) {
      const runs = await seguro(p.$queryRawUnsafe(
        `SELECT "executedAt", status, error, "eventPayload"->>'customerName' cliente, "eventPayload"->>'customerId' cid
           FROM "AutomationRun" WHERE "ruleId" = ANY($1::text[]) AND "executedAt" >= now() - interval '60 days'
          ORDER BY "executedAt" DESC LIMIT 40`, deCumple.map((r) => r.id)));
      console.log(`  corridas en 60 días: ${runs.length}`);
      for (const r of runs) console.log(`    ${d(r.executedAt)} ${r.status} ${r.cliente ?? ''} ${r.error ? '· ERROR ' + r.error.slice(0, 160) : ''}`);
    }

    // 4. Cumpleañeros de los últimos 30 días y su tarjeta
    const clientes = await seguro(p.$queryRawUnsafe(
      `SELECT count(*)::int total, count(birthday)::int con_fecha FROM "Customer" WHERE "tenantId" = $1`, t.id));
    console.log(`  clientes: ${clientes[0]?.total} · con fecha de cumpleaños: ${clientes[0]?.con_fecha}`);
    const cumple = await seguro(p.$queryRawUnsafe(
      `SELECT c.id, c."fullName", to_char(c.birthday, 'MM-DD') dia
         FROM "Customer" c
        WHERE c."tenantId" = $1 AND c.birthday IS NOT NULL
          AND to_char(c.birthday, 'MM-DD') IN (
            SELECT to_char(g::date, 'MM-DD') FROM generate_series(now() - interval '30 days', now(), interval '1 day') g)
        ORDER BY dia DESC`, t.id));
    console.log(`  cumpleañeros de los últimos 30 días: ${cumple.length}`);
    for (const c of cumple) {
      const passes = await seguro(p.$queryRawUnsafe(
        `SELECT ps.status, ps."walletPlatform", ps."walletInstalledAt", ps."googleObjectId" IS NOT NULL google,
                (SELECT count(*)::int FROM "WalletDevice" w WHERE w."passId" = ps.id) apple_dispositivos
           FROM "Pass" ps WHERE ps."customerId" = $1`, c.id));
      const notifs = await seguro(p.$queryRawUnsafe(
        `SELECT "sentAt", title, stats FROM "Notification"
          WHERE "customerId" = $1 AND "triggerType" = 'AUTOMATION' AND "sentAt" >= now() - interval '35 days'
          ORDER BY "sentAt" DESC LIMIT 3`, c.id));
      const tarjetas = passes.map((x) => `${x.status}/${x.walletPlatform ?? 'sin plataforma'}/instalada ${x.walletInstalledAt ? d(x.walletInstalledAt) : 'NO'}/apple-disp ${x.apple_dispositivos}/google ${x.google ? 'objeto' : 'no'}`).join(' | ') || 'SIN TARJETA';
      console.log(`    ${c.dia} ${c.fullName} · tarjetas: ${tarjetas}`);
      for (const n of notifs) console.log(`        aviso ${d(n.sentAt)} «${(n.title ?? '').slice(0, 50)}» ${JSON.stringify(n.stats)}`);
      if (!notifs.length) console.log('        sin aviso de automatización en 35 días');
    }
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
