/**
 * SOLO LECTURA: por qué mayo sale vacío en Contabilidad.
 *
 * Compara tres cosas mes a mes:
 *   · IncomeRecord     — lo que muestra el módulo.
 *   · HotmartWebhookEvent — el crudo del que se puede reconstruir.
 *   · Tenant.lastChargeAt / createdAt — la señal de que hubo cobro aunque no
 *     quede el payload.
 *
 * Si el crudo empieza en junio, mayo no se puede reconstruir desde la base:
 * hay que traerlo del informe de Hotmart.
 */
const { PrismaClient } = require('@prisma/client');

const mes = (d) => new Date(d).toISOString().slice(0, 7);
const suma = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

(async () => {
  const p = new PrismaClient();
  try {
    const evs = await p.hotmartWebhookEvent.findMany({
      select: { eventType: true, processedAt: true },
      orderBy: { processedAt: 'asc' },
    });
    console.log(`HotmartWebhookEvent: ${evs.length} filas`);
    if (evs.length) {
      console.log(
        `  el primero es del ${evs[0].processedAt.toISOString().slice(0, 10)}` +
          `  ·  el último del ${evs[evs.length - 1].processedAt.toISOString().slice(0, 10)}`,
      );
    }
    const porMesEv = new Map();
    const aprobadosMes = new Map();
    for (const e of evs) {
      suma(porMesEv, mes(e.processedAt));
      if (/PURCHASE_APPROVED|PURCHASE_COMPLETE/.test(e.eventType)) {
        suma(aprobadosMes, mes(e.processedAt));
      }
    }

    const ing = await p.incomeRecord.findMany({
      select: { saleDate: true, createdAt: true, grossUsd: true },
    });
    const porMesIng = new Map();
    const creadosMes = new Map();
    const brutoMes = new Map();
    for (const r of ing) {
      suma(porMesIng, mes(r.saleDate));
      suma(creadosMes, mes(r.createdAt));
      brutoMes.set(
        mes(r.saleDate),
        (brutoMes.get(mes(r.saleDate)) ?? 0) + Number(r.grossUsd),
      );
    }

    const meses = [...new Set([...porMesEv.keys(), ...porMesIng.keys()])].sort();
    console.log('\n  mes       webhooks  aprobados   IncomeRecord   bruto USD');
    for (const m of meses) {
      console.log(
        `  ${m}   ${String(porMesEv.get(m) ?? 0).padStart(8)}` +
          `${String(aprobadosMes.get(m) ?? 0).padStart(11)}` +
          `${String(porMesIng.get(m) ?? 0).padStart(15)}` +
          `${(brutoMes.get(m) ?? 0).toFixed(2).padStart(12)}`,
      );
    }

    console.log('\ncuándo se CREARON las filas de IncomeRecord (¿hubo volcado?):');
    for (const m of [...creadosMes.keys()].sort()) {
      console.log(`  ${m}   ${creadosMes.get(m)}`);
    }

    // ¿Hubo negocios cobrando en mayo? Si los hay, mayo existió y falta.
    const desde = new Date('2026-05-01T00:00:00Z');
    const hasta = new Date('2026-06-01T00:00:00Z');
    const altasMayo = await p.tenant.count({
      where: { createdAt: { gte: desde, lt: hasta } },
    });
    const activosAntesDeJunio = await p.tenant.count({
      where: { createdAt: { lt: hasta }, hotmartSubscriberCode: { not: null } },
    });
    console.log(`\nnegocios dados de alta en mayo: ${altasMayo}`);
    console.log(`negocios con código Hotmart creados antes de junio: ${activosAntesDeJunio}`);
    console.log('  → si son muchos, en mayo SÍ hubo cobros y el crudo simplemente no se guardaba.');
  } finally {
    await p.$disconnect();
  }
})();
