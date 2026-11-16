// La Burguesía: devolver la fecha de cobro a la de Hotmart (16-nov). Sin
// --aplicar solo muestra.
//
// El 29-oct pagó tarde el cobro del 16-oct y Hotmart dijo «próximo cobro
// 16-nov». El cobrador la «sanó» al 16-dic creyendo que el pago no había
// movido la fecha (regla 2 de `billing/pago-con-fecha-vieja.ts`, arreglada en
// el mismo commit que este script). El 16-nov Hotmart intentó cobrar y falló:
// con el 16-dic, Clubify la tenía al día y la revisión diaria avisaba cada
// mañana. Correr SOLO después de desplegar el arreglo, o el cron la vuelve a
// mover.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const APLICAR = process.argv.includes('--aplicar');
const SUSCRIPCION = 'L5OJ250G';
const FECHA_HOTMART = new Date('2026-11-16T12:00:00.000Z');

(async () => {
  const t = await p.tenant.findFirst({
    where: { hotmartSubscriberCode: SUSCRIPCION },
    select: { id: true, name: true, currentPeriodEnd: true, failedPaymentCount: true, firstFailedAt: true, lastChargeAt: true },
  });
  if (!t) throw new Error(`no hay negocio con la suscripción ${SUSCRIPCION}`);
  console.log(`${t.name}: fecha de cobro ${t.currentPeriodEnd?.toISOString()} → ${FECHA_HOTMART.toISOString()} · fallos ${t.failedPaymentCount} · primer fallo ${t.firstFailedAt?.toISOString() ?? '—'}`);
  if (!APLICAR) return console.log('(ensayo: nada se escribe)');
  await p.tenant.update({ where: { id: t.id }, data: { currentPeriodEnd: FECHA_HOTMART } });
  await p.auditLog.create({
    data: {
      tenantId: t.id, action: 'billing.fecha_de_cobro_corregida', resource: 'Tenant',
      metadata: { antes: t.currentPeriodEnd?.toISOString() ?? null, ahora: FECHA_HOTMART.toISOString(), motivo: 'pago tardío «sanado» un mes de más; Hotmart dice 16-nov' },
    },
  });
  console.log('→ corregida');
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
