/**
 * SOLO LECTURA: 122 redenciones en 8 minutos, ¿reales o un bucle?
 *
 * Primor Barber tiene 122 filas `REDEEM` con la nota «Cupón redimido desde
 * panel», todas el 2026-09-06 entre las 20:50 y las 20:58. Si son 122 clientes
 * distintos es una operación en masa; si es el mismo pase repetido, es un bug.
 */
const { PrismaClient } = require('@prisma/client');

const NOMBRE = process.argv[2] || 'PRIMOR';
const f = (d) => (d ? new Date(d).toISOString().slice(11, 19) : '—');

(async () => {
  const p = new PrismaClient();
  try {
    const t = await p.tenant.findFirst({
      where: { brandName: { contains: NOMBRE, mode: 'insensitive' } },
      select: { id: true, brandName: true },
    });
    if (!t) return console.log(`no encuentro «${NOMBRE}»`);
    const tid = t.id;

    const cards = await p.card.findMany({
      where: { tenantId: tid },
      select: { id: true, name: true, type: true, isActive: true },
    });
    console.log(`${t.brandName} · tarjetas:`);
    for (const c of cards) {
      console.log(`  ${c.type.padEnd(12)} ${c.name}${c.isActive ? '' : ' (inactiva)'}`);
    }

    const reds = await p.stamp.findMany({
      where: { tenantId: tid, action: 'REDEEM' },
      select: {
        createdAt: true,
        passId: true,
        customerId: true,
        operatorId: true,
        note: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    console.log(`\nREDEEM: ${reds.length} filas`);
    console.log(`  pases distintos ......... ${new Set(reds.map((r) => r.passId)).size}`);
    console.log(`  clientes distintos ...... ${new Set(reds.map((r) => r.customerId)).size}`);
    console.log(`  operadores distintos .... ${new Set(reds.map((r) => r.operatorId)).size}`);
    if (reds.length) {
      console.log(`  de ${reds[0].createdAt.toISOString()} a ${reds[reds.length - 1].createdAt.toISOString()}`);
    }

    // ¿A qué tarjeta pertenecen los pases redimidos?
    const passIds = [...new Set(reds.map((r) => r.passId).filter(Boolean))];
    const pases = await p.pass.findMany({
      where: { id: { in: passIds } },
      select: { id: true, cardId: true },
    });
    const porCard = new Map();
    for (const x of pases) porCard.set(x.cardId, (porCard.get(x.cardId) ?? 0) + 1);
    console.log(`\n  pases redimidos por tarjeta:`);
    for (const [cardId, n] of porCard) {
      const c = cards.find((y) => y.id === cardId);
      console.log(`    ${(c?.name ?? cardId).padEnd(34)} ${c?.type ?? '?'}  ${n} pases`);
    }

    // Repetidos: el mismo pase redimido varias veces.
    const veces = new Map();
    for (const r of reds) veces.set(r.passId, (veces.get(r.passId) ?? 0) + 1);
    const repes = [...veces.entries()].filter(([, n]) => n > 1);
    console.log(`\n  pases redimidos MÁS DE UNA VEZ: ${repes.length}`);
    for (const [id, n] of repes.slice(0, 10)) console.log(`    ${id} → ${n} veces`);

    console.log(`\n  primeras 6 y últimas 6 por hora:`);
    for (const r of [...reds.slice(0, 6), ...reds.slice(-6)]) {
      console.log(`    ${f(r.createdAt)}  pase ${String(r.passId).slice(0, 8)}  ${r.note ?? ''}`);
    }
  } finally {
    await p.$disconnect();
  }
})();
