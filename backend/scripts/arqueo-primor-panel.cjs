/**
 * SOLO LECTURA: cuadrar los números del panel de un negocio.
 *
 * Primor Barber ve «SELLOS (30D) 2» y «RECOMPENSAS (30D) 122». Con 2 sellos no
 * salen 122 recompensas. Este arqueo desglosa la tabla `Stamp` por acción y por
 * origen para ver qué se está contando como qué.
 *
 * También cuadra los pases: emitidos vs instalados vs plataforma, y saca por
 * nombre al cliente que no aparece en ninguna de las dos listas del panel.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2] || 'PRIMOR';
const f = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : '—');

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { brandName: { contains: NOMBRE, mode: 'insensitive' } },
      select: { id: true, brandName: true },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);
    console.log(`${t.brandName} · ${t.id}\n`);
    const tid = t.id;
    const since30 = new Date(Date.now() - 30 * 86400000);

    // ── SELLOS ────────────────────────────────────────────────────────
    const porAccion = await p.stamp.groupBy({
      by: ['action'],
      where: { tenantId: tid },
      _count: { _all: true },
    });
    console.log('Stamp POR ACCIÓN (histórico):');
    for (const g of porAccion) console.log(`  ${g.action.padEnd(12)} ${g._count._all}`);

    const porAccion30 = await p.stamp.groupBy({
      by: ['action'],
      where: { tenantId: tid, createdAt: { gte: since30 } },
      _count: { _all: true },
    });
    console.log('\nStamp POR ACCIÓN (últimos 30 días) — esto es lo que pinta el panel:');
    for (const g of porAccion30) console.log(`  ${g.action.padEnd(12)} ${g._count._all}`);

    const muestra = await p.stamp.findMany({
      where: { tenantId: tid, createdAt: { gte: since30 } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        createdAt: true,
        action: true,
        amount: true,
        note: true,
        source: true,
        passId: true,
      },
    }).catch(async () => p.stamp.findMany({
      where: { tenantId: tid, createdAt: { gte: since30 } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    }));
    console.log('\nlos 12 más recientes:');
    for (const s of muestra) {
      console.log(
        `  ${f(s.createdAt)}  ${String(s.action).padEnd(10)} ` +
          `${s.source ?? ''} ${s.note ?? ''}`,
      );
    }

    // ── PASES ─────────────────────────────────────────────────────────
    const [emitidos, instalados, apple, google, sinPlataforma, clientes] =
      await Promise.all([
        p.pass.count({ where: { tenantId: tid } }),
        p.pass.count({ where: { tenantId: tid, walletInstalledAt: { not: null } } }),
        p.pass.count({ where: { tenantId: tid, walletPlatform: 'APPLE' } }),
        p.pass.count({ where: { tenantId: tid, walletPlatform: 'GOOGLE' } }),
        p.pass.count({ where: { tenantId: tid, walletPlatform: null } }),
        p.customer.count({ where: { tenantId: tid } }),
      ]);
    console.log(`\nPASES`);
    console.log(`  clientes ................. ${clientes}`);
    console.log(`  pases emitidos ........... ${emitidos}`);
    console.log(`  instalados (walletInstalledAt) ${instalados}`);
    console.log(`  Apple ${apple} · Google ${google} · sin plataforma ${sinPlataforma}`);

    const sinInstalar = await p.pass.findMany({
      where: { tenantId: tid, walletInstalledAt: null },
      select: {
        id: true,
        issuedAt: true,
        walletPlatform: true,
        customerId: true,
      },
    });
    console.log(`\n  pases SIN instalar (${sinInstalar.length}):`);
    for (const x of sinInstalar) {
      const c = x.customerId
        ? await p.customer.findUnique({
            where: { id: x.customerId },
            select: { fullName: true, phone: true },
          })
        : null;
      console.log(
        `    ${f(x.issuedAt)}  ${c?.fullName ?? '(sin nombre)'} ` +
          `${c?.phone ?? ''}  plataforma=${x.walletPlatform ?? 'ninguna'}`,
      );
    }

    const sinPase = await p.customer.count({
      where: { tenantId: tid, passes: { none: {} } },
    });
    console.log(`\n  clientes SIN NINGÚN pase (lo que filtra «sin tarjeta»): ${sinPase}`);
    console.log(
      `  → el que no instaló SÍ tiene pase, así que no sale en esa lista. Ese es el hueco.`,
    );
  } finally {
    await p.$disconnect();
  }
})();
