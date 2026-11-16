// SOLO LECTURA. Bienvenida de un negocio: reglas/flujos PASS_CREATED, sus
// ejecuciones y, por cada pase nuevo de los últimos días, si se instaló en
// Apple/Google y si el push de bienvenida llegó.
//   node scripts/diag-bienvenida-negocio.cjs burrata [dias=14]
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16).replace('T', ' ') : '—');
const [busca, diasArg] = process.argv.slice(2);
const dias = Number(diasArg || 14);
(async () => {
  const ts = await p.tenant.findMany({ where: { deletedAt: null, OR: [{ brandName: { contains: busca, mode: 'insensitive' } }, { slug: { contains: busca, mode: 'insensitive' } }] }, select: { id: true, brandName: true, slug: true, status: true, whiteLabelId: true } });
  console.log('NEGOCIOS', ts.map((t) => `${t.brandName} (${t.slug}) ${t.status} ${t.id}`));
  const desde = new Date(Date.now() - dias * 864e5);
  for (const t of ts) {
    console.log(`\n===== ${t.brandName}`);
    const reglas = await p.automationRule.findMany({ where: { tenantId: t.id } });
    for (const r of reglas) {
      const tipo = r.trigger?.type;
      console.log(`REGLA ${r.id} «${r.name}» activa=${r.isActive} disparador=${tipo} acciones=${JSON.stringify(r.actions).slice(0, 400)} stats=${JSON.stringify(r.stats)}`);
      if (tipo === 'PASS_CREATED') {
        const runs = await p.automationRun.findMany({ where: { ruleId: r.id, executedAt: { gte: desde } }, orderBy: { executedAt: "desc" }, take: 40 });
        const cuenta = runs.reduce((a, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), {});
        console.log(`  ejecuciones ${dias} d: ${JSON.stringify(cuenta)}`);
        for (const x of runs.filter((x) => x.status !== 'SUCCESS').slice(0, 10)) console.log(`   ${d(x.executedAt)} ${x.status} ${x.error ?? ''}`);
      }
    }
    const flujos = await p.automationWorkflow.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, isActive: true, triggerType: true, steps: true } });
    for (const w of flujos) console.log(`FLUJO «${w.name}» activo=${w.isActive} disparador=${w.triggerType} pasos=${JSON.stringify(w.steps).slice(0, 300)}`);
    const pases = await p.pass.findMany({
      where: { tenantId: t.id, issuedAt: { gte: desde } },
      orderBy: { issuedAt: 'desc' },
      take: 30,
      include: { customer: { select: { id: true, fullName: true } } },
    });
    console.log(`\nPASES NUEVOS ${dias} d: ${pases.length}`);
    const campos = ["walletPlatform", "walletInstalledAt", "googleObjectId", "status"];
    console.log('  campos de instalación en Pass:', campos.join(', ') || 'ninguno');
    for (const ps of pases) {
      const notifs = await p.notification.findMany({ where: { tenantId: t.id, customerId: ps.customerId, triggerType: 'AUTOMATION', createdAt: { gte: new Date(ps.issuedAt.getTime() - 60000), lte: new Date(ps.issuedAt.getTime() + 3600000) } }, select: { title: true, createdAt: true, stats: true } });
      const inst = campos.map((k) => `${k}=${ps[k] instanceof Date ? d(ps[k]) : JSON.stringify(ps[k])}`).join(' ');
      console.log(`  ${d(ps.issuedAt)} ${ps.customer?.fullName ?? '—'} status=${ps.status} ${inst}`);
      for (const n of notifs) console.log(`     push «${n.title}» ${d(n.createdAt)} stats=${JSON.stringify(n.stats)}`);
      if (!notifs.length) console.log('     SIN notificación de bienvenida');
    }
    const regs = await p.$queryRawUnsafe(`SELECT to_regclass('public."AppleDeviceRegistration"') AS a, to_regclass('public."PassRegistration"') AS b`).catch(() => null);
    console.log('\ntablas de registro Apple:', JSON.stringify(regs));
  }
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
