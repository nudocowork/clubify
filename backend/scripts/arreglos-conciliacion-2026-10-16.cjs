/**
 * Arreglos que salieron de la conciliación Hotmart ↔ comisiones del
 * 15-sep al 15-oct (respuestas de Javier y Sara, 2026-10-16). Sin
 * `--aplicar` solo SIMULA y muestra el antes y el después.
 *
 *  1. Enchurrados TEX-MEX: la comisión de $15 del 08-oct quedó entera a nombre
 *     de Nicolás Quintero. Va mitad y mitad: $7,50 Nicolás y $7,50 Gabriel Ruiz
 *     (igual que Alquimia Café Bistro).
 *  2. La burguesía: pagó el 16-sep (trimestral). Próximo cobro al 16-dic, no al
 *     16-ene, y sin marca de pago fallido.
 *  3. Barbería Salón Fénix: es trimestral pagando, pero su plan quedó en
 *     «Sin plan». Pasa al plan de los demás negocios activos (Elite).
 *
 *   railway run --service backend --environment production node scripts/arreglos-conciliacion-2026-10-16.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const APLICAR = process.argv.includes('--aplicar');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

async function negocio(parte) {
  const ts = await p.tenant.findMany({
    where: { brandName: { contains: parte, mode: 'insensitive' }, deletedAt: null },
    select: {
      id: true, brandName: true, status: true, planPeriodicity: true, currentPeriodEnd: true,
      lastChargeAt: true, failedPaymentCount: true, planId: true, plan: { select: { name: true } },
    },
  });
  if (ts.length !== 1) throw new Error(`«${parte}»: ${ts.length} negocios coinciden (debe ser 1): ${ts.map((t) => t.brandName).join(', ')}`);
  return ts[0];
}

(async () => {
  console.log(APLICAR ? 'APLICANDO\n' : 'SIMULACIÓN (añade --aplicar para escribir)\n');

  // ── 1. Enchurrados ─────────────────────────────────────────────
  const ench = await negocio('enchurrados');
  const usos = await p.referralUse.findMany({
    where: { tenantId: ench.id },
    select: { id: true, referralCode: { select: { id: true, code: true, ownerName: true } } },
  });
  const gabriel = usos.find((u) => u.referralCode.code === '2UVNEPTM');
  if (!gabriel) throw new Error('Enchurrados: no encuentro el registro de Gabriel (2UVNEPTM).');
  const comisiones = await p.commission.findMany({
    where: { referralUseId: { in: usos.map((u) => u.id) }, status: { not: 'REJECTED' } },
    select: {
      id: true, amount: true, status: true, paymentStatus: true, amountPaid: true, recipientCodeId: true,
      referralUseId: true, periodKey: true, businessDate: true, availableAt: true, currency: true,
      baseAmountUsd: true, notes: true, recipientCode: { select: { ownerName: true, code: true } },
    },
  });
  console.log(`1) ${ench.brandName} — comisiones hoy:`);
  for (const c of comisiones) console.log(`   ${f(c.businessDate)} $${Number(c.amount)} ${c.status} → ${c.recipientCode?.ownerName} (${c.recipientCode?.code})`);
  const deNicolas = comisiones.filter((c) => c.recipientCode?.code === 'TAFMPWK5' && Number(c.amount) === 15);
  const yaGabriel = comisiones.some((c) => c.recipientCodeId === gabriel.referralCode.id);
  if (deNicolas.length !== 1 || yaGabriel) {
    console.log('   ⚠ No está como se esperaba (una de $15 a Nicolás y ninguna a Gabriel): no se toca.');
  } else if (Number(deNicolas[0].amountPaid ?? 0) > 0 || deNicolas[0].status === 'PAID') {
    console.log('   ⚠ La de Nicolás ya tiene pagos: no se toca, hay que ajustarlo a mano.');
  } else {
    const c = deNicolas[0];
    console.log('   → Nicolás pasa a $7,50 y se crea $7,50 para Gabriel Ruiz, misma fecha y mismo estado.');
    if (APLICAR) {
      const nota = 'Reparto 50/50 con Gabriel Ruiz (Javier, 2026-10-16).';
      await p.$transaction([
        p.commission.update({
          where: { id: c.id },
          data: { amount: 7.5, notes: [c.notes, nota].filter(Boolean).join(' · ') },
        }),
        p.commission.create({
          data: {
            referralUseId: gabriel.id, recipientCodeId: gabriel.referralCode.id, amount: 7.5,
            status: c.status, currency: c.currency, periodKey: c.periodKey, businessDate: c.businessDate,
            availableAt: c.availableAt, baseAmountUsd: c.baseAmountUsd, notes: nota,
          },
        }),
      ]);
      console.log('   ✓ hecho');
    }
  }

  // ── 2. La burguesía ────────────────────────────────────────────
  const burg = await negocio('la burguesia');
  const nuevoFin = new Date('2026-12-16T05:00:00.000Z');
  console.log(`\n2) ${burg.brandName} — hoy: último cobro ${f(burg.lastChargeAt)} · próximo cobro ${f(burg.currentPeriodEnd)} · pagos fallidos ${burg.failedPaymentCount} · ${burg.status}`);
  const ing = await p.incomeRecord.findMany({
    where: { tenantId: burg.id, saleDate: { gte: new Date('2026-09-01') } },
    select: { saleDate: true, gateway: true, grossUsd: true, status: true, externalTxId: true },
  });
  for (const i of ing) console.log(`   cobro ${f(i.saleDate)} ${i.gateway} $${Number(i.grossUsd)} ${i.status} (${i.externalTxId})`);
  console.log(`   → próximo cobro 2026-12-16, pagos fallidos 0${burg.status !== 'ACTIVE' ? ', estado ACTIVE' : ''}`);
  if (APLICAR) {
    await p.tenant.update({
      where: { id: burg.id },
      data: { currentPeriodEnd: nuevoFin, failedPaymentCount: 0, ...(burg.status !== 'ACTIVE' ? { status: 'ACTIVE' } : {}) },
    });
    console.log('   ✓ hecho');
  }

  // ── 3. Barbería Salón Fénix ────────────────────────────────────
  const barb = await negocio('barberia sal');
  const elite = await p.plan.findUnique({ where: { name: 'Elite' }, select: { id: true } });
  console.log(`\n3) ${barb.brandName} — plan hoy: ${barb.plan?.name ?? '—'} · ${barb.planPeriodicity ?? '—'} · próximo cobro ${f(barb.currentPeriodEnd)}`);
  if (!elite) {
    console.log('   ⚠ No existe el plan «Elite»: no se toca.');
  } else if (barb.planId === elite.id) {
    console.log('   ya está en Elite: nada que hacer.');
  } else {
    console.log(`   → plan Elite, periodicidad TRIMESTRAL`);
    if (APLICAR) {
      await p.tenant.update({ where: { id: barb.id }, data: { planId: elite.id, planPeriodicity: 'TRIMESTRAL' } });
      console.log('   ✓ hecho');
    }
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
