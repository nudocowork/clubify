/**
 * SOLO LECTURA. Negocios vendidos por un EMBAJADOR (con influencer arriba) o
 * por un VENDEDOR, donde algún cobro quedó con el reparto mal: el de arriba
 * cobró y quien vendió no.
 *
 * Por qué existe: hasta el 2026-10-16 el webhook elegía «el registro más
 * reciente» del negocio, y en un negocio de embajador ese es el parent-use del
 * influencer (creado en el primer cobro para colgar su indirecta). Resultado:
 * el primer cobro repartía bien y las renovaciones le pagaban al influencer su
 * % completo, sin nada para el embajador (MOTILART, Enchurrados TEX-MEX). Y un
 * vendedor con registro SIGNED_UP caía al flujo sin vendedores.
 *
 * Este script NO corrige nada: lista los cobros sospechosos para revisarlos y
 * corregirlos después con permiso (regla: una comisión se rehace sobre el monto
 * con el que NACIÓ, y una ya pagada no se toca).
 *
 *   railway run --service backend --environment production node scripts/diag-reparto-embajador-influencer.cjs [--desde 2026-06-01] [--negocio <parte del nombre>]
 */
const { PrismaClient } = require('@prisma/client');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const desde = new Date(arg('desde') || '2026-06-01');
const filtroNombre = arg('negocio');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const n = (v) => (v == null ? null : Number(v));

(async () => {
  const indirectoRow = await p.setting.findUnique({ where: { key: 'referrals.indirectPercent' } });
  const indirecto = indirectoRow?.value ? Number(indirectoRow.value) : 5;

  // Registros de venta de un embajador con superior, o de un vendedor.
  const ventas = await p.referralUse.findMany({
    where: {
      tenantId: { not: null },
      OR: [
        { referralCode: { role: 'AMBASSADOR', parentCodeId: { not: null } } },
        { referralCode: { role: 'VENDOR' } },
      ],
      ...(filtroNombre
        ? { tenant: { brandName: { contains: filtroNombre, mode: 'insensitive' } } }
        : {}),
    },
    select: {
      id: true, tenantId: true, status: true, createdAt: true,
      tenant: { select: { brandName: true, subscriptionPriceUsd: true, commissionDistributionMode: true } },
      referralCode: {
        select: {
          id: true, code: true, ownerName: true, role: true, commissionPercent: true,
          parentCode: { select: { id: true, code: true, ownerName: true, commissionPercent: true } },
          parentEmbajadorCode: {
            select: {
              id: true, code: true, ownerName: true, role: true, commissionPercent: true,
              parentCode: { select: { id: true, code: true, ownerName: true } },
            },
          },
        },
      },
    },
  });

  let negociosMal = 0;
  let cobrosMal = 0;
  for (const v of ventas) {
    const c = v.referralCode;
    const vendedor = c.role === 'VENDOR' ? c : null;
    const embajador = vendedor ? c.parentEmbajadorCode : c;
    const influencer = vendedor
      ? c.parentEmbajadorCode?.role === 'INFLUENCER'
        ? null
        : c.parentEmbajadorCode?.parentCode ?? null
      : c.parentCode;
    if (!embajador) continue;

    const comisiones = await p.commission.findMany({
      where: {
        referralUse: { tenantId: v.tenantId },
        status: { not: 'REJECTED' },
        OR: [{ businessDate: { gte: desde } }, { businessDate: null, createdAt: { gte: desde } }],
        recipientCodeId: { in: [c.id, embajador.id, influencer?.id].filter(Boolean) },
        // Implementación y upgrade tienen su propio reparto: fuera.
        NOT: [{ periodKey: { startsWith: 'IMPL-' } }, { periodKey: { startsWith: 'UPG-' } }],
      },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, amount: true, status: true, amountPaid: true, recipientCodeId: true,
        referralUseId: true, businessDate: true, createdAt: true, externalTxId: true,
        hotmartTransactionId: true, baseAmountUsd: true, appliedPercent: true, periodKey: true,
      },
    });
    if (!comisiones.length) continue;

    // Un cobro = su transacción, o su día si no la trae.
    const cobros = new Map();
    for (const x of comisiones) {
      const clave = x.hotmartTransactionId || x.externalTxId || f(x.businessDate ?? x.createdAt);
      if (!cobros.has(clave)) cobros.set(clave, []);
      cobros.get(clave).push(x);
    }

    const hallazgos = [];
    for (const [clave, filas] of cobros) {
      const de = (id) => filas.filter((x) => x.recipientCodeId === id);
      const quienVendio = de(c.id);
      const arriba = vendedor ? de(embajador.id) : de(influencer?.id);
      if (quienVendio.length || !arriba.length) continue; // bien, o nada que comparar
      const base = n(arriba[0].baseAmountUsd) ?? n(v.tenant?.subscriptionPriceUsd);
      const pct = base ? Math.round((Number(arriba[0].amount) / base) * 10000) / 100 : null;
      hallazgos.push(
        `    ${f(arriba[0].businessDate ?? arriba[0].createdAt)} [${clave}] $${Number(arriba[0].amount)}` +
          `${pct != null ? ` (${pct} % de $${base})` : ''} → ${vendedor ? embajador.ownerName : influencer?.ownerName}` +
          ` · ${arriba[0].status}${Number(arriba[0].amountPaid) > 0 ? ` · PAGADO $${Number(arriba[0].amountPaid)}` : ''}` +
          ` · ${c.ownerName}: $0` +
          `${!vendedor && pct != null && pct > indirecto + 0.01 ? ` · el influencer cobró MÁS del ${indirecto} % indirecto` : ''}` +
          `${arriba[0].referralUseId !== v.id ? ' · colgada del registro del de arriba' : ''}`,
      );
    }
    if (!hallazgos.length) continue;
    negociosMal += 1;
    cobrosMal += hallazgos.length;
    console.log(
      `\n══ ${v.tenant?.brandName} · vendió ${c.ownerName} (${c.code}, ${c.role}, ${Number(c.commissionPercent)} %, registro ${v.status} del ${f(v.createdAt)})` +
        (vendedor
          ? ` · embajador ${embajador.ownerName} (${embajador.code}, ${embajador.role}) · modo ${v.tenant?.commissionDistributionMode}`
          : ` · influencer ${influencer?.ownerName} (${influencer?.code}, ${Number(influencer?.commissionPercent)} %)`),
    );
    for (const h of hallazgos) console.log(h);
  }
  console.log(`\nTotal: ${negociosMal} negocio(s), ${cobrosMal} cobro(s) con el reparto mal desde ${f(desde)}. No se modificó nada.`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
