/**
 * SOLO LECTURA. «Le llegó un push a las 11 PM y el negocio no lo mandó»
 * (Aldehir — Hacienda Don Antonio, Marea Místika, Jamarea —, 2026-10-15).
 *
 * Para cada negocio que coincida con los nombres, muestra en HORA LOCAL del
 * negocio:
 *   - Los push enviados en los últimos N días (tabla Notification): quién los
 *     originó (MANUAL / SCHEDULED / AUTOMATION / GEO), título, si fue a un
 *     cliente o a todos, y cuándo estaba programado.
 *   - Los recurrentes activos (día, hora y zona configurada).
 *   - Las reglas y flujos de automatización activos que mandan push, con sus
 *     últimas ejecuciones.
 * Los envíos fuera de 8:00–21:00 se marcan con ⚠.
 *
 *   railway run --service backend --environment production node scripts/diag-push-nocturno.cjs --nombres "marea,jamarea,hacienda" [--dias 4]
 */
const { PrismaClient } = require('@prisma/client');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const nombres = (arg('nombres') || '').split(',').map((s) => s.trim()).filter(Boolean);
const dias = Number(arg('dias') || 4);
if (!nombres.length) {
  console.error('Uso: --nombres "marea,jamarea,hacienda" [--dias 4]');
  process.exit(1);
}

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

const enZona = (d, tz) =>
  d
    ? new Date(d).toLocaleString('es-CO', {
        timeZone: tz,
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
const horaLocal = (d, tz) =>
  Number(new Date(d).toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }));

(async () => {
  const desde = new Date(Date.now() - dias * 86400000);
  const tenants = await p.tenant.findMany({
    where: {
      deletedAt: null,
      OR: nombres.map((n) => ({ brandName: { contains: n, mode: 'insensitive' } })),
    },
    select: { id: true, brandName: true, slug: true, timezone: true },
  });
  if (!tenants.length) throw new Error('Ningún negocio coincide con esos nombres.');

  for (const t of tenants) {
    const tz = t.timezone || 'America/Bogota';
    console.log(`\n══════ ${t.brandName} (${t.slug}) · zona ${tz}`);

    const notifs = await p.notification.findMany({
      where: { tenantId: t.id, OR: [{ sentAt: { gte: desde } }, { createdAt: { gte: desde } }] },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        title: true, body: true, triggerType: true, customerId: true,
        scheduledAt: true, sentAt: true, createdAt: true, stats: true,
      },
    });
    console.log(`\n  Push de los últimos ${dias} días: ${notifs.length}`);
    for (const n of notifs) {
      const cuando = n.sentAt ?? n.createdAt;
      const h = horaLocal(cuando, tz);
      const raro = h < 8 || h >= 21 ? '⚠ ' : '  ';
      console.log(
        `  ${raro}${enZona(cuando, tz)} · ${n.triggerType}${n.customerId ? ' (1 cliente)' : ' (todos)'}` +
          `${n.scheduledAt ? ` · programado ${enZona(n.scheduledAt, tz)}` : ''} · «${n.title}» — ${String(n.body).slice(0, 70)}`,
      );
    }

    const rec = await p.recurringNotification.findMany({
      where: { tenantId: t.id },
      select: { title: true, daysOfWeek: true, timeOfDay: true, timezone: true, isActive: true, lastDispatchedAt: true, updatedAt: true },
    });
    console.log(`\n  Recurrentes: ${rec.length}`);
    for (const r of rec) {
      console.log(
        `    ${r.isActive ? 'ACTIVA ' : 'apagada'} «${r.title}» días [${r.daysOfWeek.join(',')}] a las ${r.timeOfDay} (${r.timezone})` +
          ` · último envío ${enZona(r.lastDispatchedAt, tz)} · editada ${enZona(r.updatedAt, tz)}`,
      );
    }

    const reglas = await p.automationRule.findMany({
      where: { tenantId: t.id },
      select: {
        id: true, name: true, isActive: true, trigger: true, actions: true,
        runs: { where: { executedAt: { gte: desde } }, orderBy: { executedAt: 'desc' }, take: 5, select: { executedAt: true, status: true } },
      },
    }).catch((e) => {
      console.log(`    (no pude leer AutomationRule: ${e.message.split('\n')[0]})`);
      return [];
    });
    console.log(`\n  Reglas de automatización: ${reglas.length}`);
    for (const r of reglas) {
      const acciones = JSON.stringify(r.actions ?? '').slice(0, 90);
      console.log(`    ${r.isActive ? 'ACTIVA ' : 'apagada'} «${r.name ?? '—'}» disparador ${JSON.stringify(r.trigger ?? '').slice(0, 60)} · ${acciones}`);
      for (const run of r.runs) console.log(`        ${horaLocal(run.executedAt, tz) < 8 || horaLocal(run.executedAt, tz) >= 21 ? '⚠' : ' '} ${enZona(run.executedAt, tz)} ${run.status}`);
    }

    const flujos = await p.automationWorkflow.findMany({
      where: { tenantId: t.id },
      select: { name: true, isActive: true, triggerType: true, steps: true },
    }).catch(() => []);
    console.log(`\n  Flujos multipaso: ${flujos.length}`);
    for (const f of flujos) {
      const pasos = Array.isArray(f.steps) ? f.steps.map((s) => s?.type).join(' → ') : '';
      console.log(`    ${f.isActive ? 'ACTIVO ' : 'apagado'} «${f.name}» disparador ${f.triggerType} · ${pasos}`);
    }
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
