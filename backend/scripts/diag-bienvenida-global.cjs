// SOLO LECTURA. ¿Llega el push de bienvenida en algún negocio? Cruza cada
// ejecución de una regla PASS_CREATED (30 días) con su Notification y mira
// `delivered`, y cuánto tarda el registro del iPhone (WalletDevice) tras crear el pase.
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
(async () => {
  const desde = new Date(Date.now() - 30 * 864e5);
  const reglas = await p.automationRule.findMany({ where: { isActive: true }, select: { id: true, tenantId: true, trigger: true, actions: true } });
  const bienv = reglas.filter((r) => r.trigger?.type === 'PASS_CREATED' && (r.actions || []).some((a) => a.type === 'SEND_PUSH'));
  console.log(`Reglas de bienvenida activas con push: ${bienv.length}`);
  let tot = 0, ok = 0, cero = 0;
  const porNegocio = {};
  for (const r of bienv) {
    const runs = await p.automationRun.findMany({ where: { ruleId: r.id, executedAt: { gte: desde }, status: 'SUCCESS' }, select: { eventPayload: true, executedAt: true } });
    for (const x of runs) {
      const cid = x.eventPayload?.customerId; if (!cid) continue;
      const n = await p.notification.findFirst({ where: { tenantId: r.tenantId, customerId: cid, triggerType: 'AUTOMATION', createdAt: { gte: new Date(x.executedAt.getTime() - 120000), lte: new Date(x.executedAt.getTime() + 120000) } }, select: { stats: true } });
      if (!n) continue;
      tot++; const dlv = Number(n.stats?.delivered ?? 0); if (dlv > 0) ok++; else cero++;
      porNegocio[r.tenantId] = porNegocio[r.tenantId] || { ok: 0, cero: 0 }; porNegocio[r.tenantId][dlv > 0 ? 'ok' : 'cero']++;
    }
  }
  console.log(`Bienvenidas 30 d: ${tot} · entregadas ${ok} · sin entregar ${cero}`);
  const nombres = await p.tenant.findMany({ where: { id: { in: Object.keys(porNegocio) } }, select: { id: true, brandName: true } });
  for (const t of nombres) console.log(`  ${t.brandName}: ok ${porNegocio[t.id].ok} · sin entregar ${porNegocio[t.id].cero}`);
  // Latencia del registro de Apple tras crear el pase
  const devs = await p.walletDevice.findMany({ where: { createdAt: { gte: desde }, platform: 'APPLE' }, select: { createdAt: true, pass: { select: { issuedAt: true } } }, take: 500 });
  const lat = devs.map((x) => (x.createdAt - x.pass.issuedAt) / 1000).filter((s) => s >= 0 && s < 86400).sort((a, b) => a - b);
  const q = (f) => lat[Math.floor(f * (lat.length - 1))];
  console.log(`Registro de iPhone tras emitir el pase (s), n=${lat.length}: p10 ${q(0.1)} · mediana ${q(0.5)} · p90 ${q(0.9)}`);
})().catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; }).finally(() => p.$disconnect());
