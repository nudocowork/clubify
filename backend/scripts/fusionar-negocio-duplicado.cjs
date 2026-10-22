/**
 * Un cliente RENOVÓ en Hotmart con OTRO correo y el sistema, al no reconocerlo,
 * creó un negocio nuevo y vacío; el negocio real quedó SUSPENDIDO «por falta
 * de pago». Esto mueve la renovación al negocio real, lo activa, le pone el
 * correo con el que ahora paga y retira el duplicado.
 *
 * Caso Restaurante Ricuras (2026-10-22): real = Ricuraspaisasi@gmail.com
 * (7 clientes, 58 pases, suspendido); duplicado = dmoreno758@unab.edu.co
 * (0 clientes, activo, con la renovación trimestral).
 *
 * POR QUÉ ASÍ: el aviso de pago de Hotmart busca el negocio primero por su
 * `hotmartSubscriberCode` y después por el correo del USUARIO dueño
 * (`User.email`, rol TENANT_OWNER). Si la próxima renovación llega con el
 * código y el correo nuevos, tienen que estar en el negocio real; si no, se
 * volvería a crear otro duplicado. Por eso se mueven el código, los avisos,
 * los ingresos y el usuario dueño del duplicado al negocio real.
 *
 * Sin `--aplicar` solo SIMULA. Se niega si el duplicado tiene clientes o
 * pases (entonces no es «vacío» y hay que mirarlo a mano).
 *
 *   railway run --service backend --environment production node scripts/fusionar-negocio-duplicado.cjs \
 *     --real ricuraspaisasi@gmail.com --duplicado dmoreno758@unab.edu.co [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const APLICAR = process.argv.includes('--aplicar');
const correoReal = (arg('real') || '').trim().toLowerCase();
const correoDup = (arg('duplicado') || '').trim().toLowerCase();
if (!correoReal || !correoDup || correoReal === correoDup) {
  console.error('Uso: --real <correo del negocio real> --duplicado <correo del negocio duplicado> [--aplicar]');
  process.exit(1);
}

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const f = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const SELECT = {
  id: true, slug: true, brandName: true, email: true, status: true, deletedAt: true, whiteLabelId: true,
  planPeriodicity: true, subscriptionPriceUsd: true, manualPayment: true,
  hotmartSubscriberCode: true, hotmartTransactionId: true,
  purchasedAt: true, lastChargeAt: true, currentPeriodEnd: true,
  suspendedAt: true, canceledAt: true, failedPaymentCount: true,
  trialEndsAt: true,
};

async function negocioPorCorreo(correo, etiqueta) {
  const ts = await p.tenant.findMany({
    where: { email: { equals: correo, mode: 'insensitive' }, deletedAt: null },
    select: SELECT,
  });
  if (ts.length !== 1) {
    throw new Error(`${etiqueta}: ${ts.length} negocios con el correo ${correo} (debe ser 1): ${ts.map((t) => `${t.brandName} [${t.slug}]`).join(', ')}`);
  }
  return ts[0];
}

async function radiografia(t) {
  const [usuarios, clientes, pases, ingresos, usos, avisos, manuales] = await Promise.all([
    p.user.findMany({ where: { tenantId: t.id }, select: { id: true, email: true, role: true, isActive: true } }),
    p.customer.count({ where: { tenantId: t.id } }),
    p.pass.count({ where: { tenantId: t.id } }),
    p.incomeRecord.findMany({
      where: { tenantId: t.id },
      orderBy: { saleDate: 'asc' },
      select: { id: true, saleDate: true, gateway: true, grossUsd: true, status: true, externalTxId: true },
    }),
    p.referralUse.findMany({
      where: { tenantId: t.id },
      select: {
        id: true, status: true, referralCodeId: true,
        referralCode: { select: { code: true, ownerName: true } },
        commissions: { select: { id: true, amount: true, status: true, periodKey: true, businessDate: true, recipientCodeId: true } },
      },
    }),
    p.hotmartWebhookEvent.count({ where: { tenantId: t.id } }),
    p.manualPayment.count({ where: { tenantId: t.id } }),
  ]);
  return { usuarios, clientes, pases, ingresos, usos, avisos, manuales };
}

function pintar(titulo, t, r) {
  console.log(`\n${titulo}: ${t.brandName} [${t.slug}] · ${t.email}`);
  console.log(`  estado ${t.status}${t.suspendedAt ? ` (suspendido ${f(t.suspendedAt)})` : ''} · plan ${t.planPeriodicity ?? '—'} $${t.subscriptionPriceUsd ?? '—'} · pago manual ${t.manualPayment}`);
  console.log(`  Hotmart: suscriptor ${t.hotmartSubscriberCode ?? '—'} · tx ${t.hotmartTransactionId ?? '—'}`);
  console.log(`  comprado ${f(t.purchasedAt)} · último cobro ${f(t.lastChargeAt)} · vence ${f(t.currentPeriodEnd)} · pagos fallidos ${t.failedPaymentCount}`);
  console.log(`  clientes ${r.clientes} · pases ${r.pases} · avisos Hotmart ${r.avisos} · pagos manuales ${r.manuales}`);
  console.log(`  usuarios: ${r.usuarios.map((u) => `${u.email} (${u.role}${u.isActive ? '' : ', inactivo'})`).join(', ') || 'ninguno'}`);
  console.log(`  ingresos: ${r.ingresos.map((i) => `${f(i.saleDate)} ${i.gateway} $${Number(i.grossUsd)} ${i.status} ${i.externalTxId}`).join(' | ') || 'ninguno'}`);
  for (const u of r.usos) {
    console.log(`  referido: ${u.referralCode?.ownerName} (${u.referralCode?.code}, ${u.status}) · comisiones: ${u.commissions.map((c) => `${f(c.businessDate)} $${Number(c.amount)} ${c.status} [${c.periodKey ?? '—'}]`).join(' | ') || 'ninguna'}`);
  }
  if (!r.usos.length) console.log('  referido: ninguno');
}

(async () => {
  console.log(APLICAR ? 'APLICANDO\n' : 'SIMULACIÓN (añade --aplicar para escribir)\n');
  const real = await negocioPorCorreo(correoReal, 'Negocio real');
  const dup = await negocioPorCorreo(correoDup, 'Negocio duplicado');
  if (real.id === dup.id) throw new Error('Son el mismo negocio.');
  const rReal = await radiografia(real);
  const rDup = await radiografia(dup);
  pintar('NEGOCIO REAL', real, rReal);
  pintar('DUPLICADO', dup, rDup);

  // ── Candados ─────────────────────────────────────────────────────────────
  const frenos = [];
  if (rDup.clientes > 0 || rDup.pases > 0) frenos.push(`el duplicado tiene ${rDup.clientes} clientes y ${rDup.pases} pases: no está vacío`);
  if (real.whiteLabelId !== dup.whiteLabelId) frenos.push('los dos negocios son de marcas distintas');
  if (!dup.hotmartSubscriberCode && rDup.ingresos.length === 0) frenos.push('el duplicado no tiene ni código de Hotmart ni ingresos: no hay renovación que mover');
  const dueñosDup = rDup.usuarios.filter((u) => u.role === 'TENANT_OWNER');
  const correosReal = new Set(rReal.usuarios.map((u) => u.email.toLowerCase()));
  for (const u of dueñosDup) {
    if (correosReal.has(u.email.toLowerCase())) frenos.push(`el usuario ${u.email} ya existe en el negocio real`);
  }
  if (frenos.length) {
    console.log('\n✗ NO SE APLICA:');
    for (const x of frenos) console.log(`  - ${x}`);
    return p.$disconnect();
  }

  // ── Plan ─────────────────────────────────────────────────────────────────
  const ahora = new Date();
  const vence = dup.currentPeriodEnd && dup.currentPeriodEnd > ahora ? dup.currentPeriodEnd : real.currentPeriodEnd;
  const ultimoCobro =
    dup.lastChargeAt && (!real.lastChargeAt || dup.lastChargeAt > real.lastChargeAt) ? dup.lastChargeAt : real.lastChargeAt;
  const moverReferido = rDup.usos.length > 0 && rReal.usos.length === 0;
  // Mismo vendedor en los dos (pasa cuando el duplicado nació por el enlace o
  // el código del mismo afiliado): sus comisiones se juntan bajo el registro
  // del negocio real y el registro del duplicado se borra. Si chocaran en el
  // mismo período para el mismo beneficiario, se frena: eso sería una
  // comisión doble y hay que mirarla a mano.
  const usoReal = rReal.usos[0] ?? null;
  const usoDup = rDup.usos[0] ?? null;
  const unirReferido = !!(usoReal && usoDup && usoReal.referralCodeId === usoDup.referralCodeId);
  if (unirReferido) {
    const claves = new Set(usoReal.commissions.map((c) => `${c.recipientCodeId}|${c.periodKey}`));
    const choque = usoDup.commissions.filter((c) => claves.has(`${c.recipientCodeId}|${c.periodKey}`));
    if (choque.length) frenos.push(`comisión doble para el mismo período en los dos negocios: ${choque.map((c) => `${f(c.businessDate)} $${Number(c.amount)} [${c.periodKey}]`).join(', ')}`);
  }
  // El mismo pago registrado dos veces: a mano en el real (cuando el de
  // Hotmart «no tenía negocio») y por Hotmart en el duplicado, con 3 días y
  // un 10 % de diferencia como mucho. El manual se anula; el de Hotmart manda
  // (es el que concilia el conciliador nocturno). Precedente: Drive Pizza.
  const manualesDuplicados = rReal.ingresos.filter((m) =>
    m.gateway === 'MANUAL' && m.status === 'PAGADO' &&
    rDup.ingresos.some((h) =>
      h.gateway === 'HOTMART' && h.status === 'PAGADO' &&
      Math.abs(new Date(h.saleDate) - new Date(m.saleDate)) <= 3 * 86400000 &&
      Math.abs(Number(h.grossUsd) - Number(m.grossUsd)) <= 0.1 * Number(h.grossUsd),
    ),
  );
  // La PRIMERA compra en Hotmart (orden numérico: `.sort()` a secas ordenaba
  // las fechas como texto y ponía octubre antes que julio).
  const fechasHotmart = rDup.ingresos.filter((i) => i.gateway === 'HOTMART').map((i) => new Date(i.saleDate).getTime()).sort((x, y) => x - y);
  const compradoEn = real.purchasedAt ?? (fechasHotmart.length ? new Date(fechasHotmart[0]) : null);
  if (frenos.length) {
    console.log('\n✗ NO SE APLICA:');
    for (const x of frenos) console.log(`  - ${x}`);
    return p.$disconnect();
  }

  console.log(`\n${APLICAR ? 'APLICO' : 'Simulo'}:`);
  console.log(`  1. ${real.brandName}: ${real.status} → ACTIVE, sin suspensión ni cancelación, pagos fallidos 0`);
  console.log(`     correo ${real.email} → ${dup.email}`);
  console.log(`     Hotmart: suscriptor ${real.hotmartSubscriberCode ?? '—'} → ${dup.hotmartSubscriberCode ?? real.hotmartSubscriberCode ?? '—'} · tx → ${dup.hotmartTransactionId ?? real.hotmartTransactionId ?? '—'}`);
  console.log(`     último cobro → ${f(ultimoCobro)} · vence → ${f(vence)} · plan → ${dup.planPeriodicity ?? real.planPeriodicity ?? '—'} · pago manual → ${dup.hotmartSubscriberCode ? 'false' : String(real.manualPayment)}`);
  if (!vence || vence <= ahora) console.log('     ⚠ no hay un vencimiento futuro: revisar a mano el próximo cobro');
  console.log(`  2. Muevo al real: ${rDup.ingresos.length} ingreso(s), ${rDup.avisos} aviso(s) de Hotmart, ${rDup.manuales} pago(s) manual(es)`);
  console.log(`     referido: ${moverReferido ? `se mueve ${rDup.usos.map((u) => u.referralCode?.ownerName).join(', ')}` : unirReferido ? `mismo vendedor (${usoReal.referralCode?.ownerName}): ${usoDup.commissions.length} comisión(es) del duplicado pasan al registro del real, que queda ${usoDup.status === 'PAYING' ? 'PAYING' : usoReal.status}` : rDup.usos.length ? 'vendedores distintos: el del duplicado se queda y se retira con él (revisar comisiones)' : 'ninguno'}`);
  console.log(`     pagos registrados dos veces: ${manualesDuplicados.length ? manualesDuplicados.map((m) => `manual ${f(m.saleDate)} $${Number(m.grossUsd)} → CANCELADO (lo cubre el de Hotmart)`).join(', ') : 'ninguno'}`);
  console.log(`     comprado → ${f(compradoEn)}`);
  console.log(`  3. Usuarios del duplicado pasan al real: ${rDup.usuarios.map((u) => `${u.email} (${u.role})`).join(', ') || 'ninguno'}`);
  console.log(`  4. ${dup.brandName} [${dup.slug}]: se retira (eliminado, SUSPENDED, sin código de Hotmart, correo renombrado)`);

  if (!APLICAR) {
    console.log('\n(simulación: añade --aplicar para escribir)');
    return p.$disconnect();
  }

  const nota = `Fusionado con el negocio real ${real.slug} el ${f(ahora)} (renovación hecha con otro correo). fusionar-negocio-duplicado.cjs`;
  await p.$transaction(async (tx) => {
    // Con guarda: si alguien tocó el estado mientras tanto, no se pisa nada.
    const n = await tx.tenant.updateMany({
      where: { id: real.id, status: real.status, deletedAt: null },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        canceledAt: null,
        failedPaymentCount: 0,
        email: dup.email,
        hotmartSubscriberCode: dup.hotmartSubscriberCode ?? real.hotmartSubscriberCode,
        hotmartTransactionId: dup.hotmartTransactionId ?? real.hotmartTransactionId,
        lastChargeAt: ultimoCobro,
        currentPeriodEnd: vence,
        planPeriodicity: dup.planPeriodicity ?? real.planPeriodicity,
        subscriptionPriceUsd: dup.subscriptionPriceUsd ?? real.subscriptionPriceUsd,
        ...(dup.hotmartSubscriberCode ? { manualPayment: false } : {}),
        ...(compradoEn && !real.purchasedAt ? { purchasedAt: compradoEn } : {}),
      },
    });
    if (n.count !== 1) throw new Error('El negocio real cambió mientras tanto: no se aplicó nada.');

    await tx.incomeRecord.updateMany({ where: { tenantId: dup.id }, data: { tenantId: real.id } });
    await tx.hotmartWebhookEvent.updateMany({ where: { tenantId: dup.id }, data: { tenantId: real.id } });
    await tx.manualPayment.updateMany({ where: { tenantId: dup.id }, data: { tenantId: real.id } });
    if (moverReferido) {
      await tx.referralUse.updateMany({ where: { tenantId: dup.id }, data: { tenantId: real.id } });
    } else if (unirReferido) {
      await tx.commission.updateMany({ where: { referralUseId: usoDup.id }, data: { referralUseId: usoReal.id } });
      if (usoDup.status === 'PAYING') {
        await tx.referralUse.update({ where: { id: usoReal.id }, data: { status: 'PAYING' } });
      }
      await tx.referralUse.delete({ where: { id: usoDup.id } });
    }
    for (const m of manualesDuplicados) {
      await tx.incomeRecord.update({
        where: { id: m.id },
        data: { status: 'CANCELADO', note: `Mismo pago que el de Hotmart del duplicado (fusión ${f(ahora)}). ${nota}`.slice(0, 1000) },
      });
    }
    await tx.user.updateMany({ where: { tenantId: dup.id }, data: { tenantId: real.id } });

    const m = await tx.tenant.updateMany({
      where: { id: dup.id, deletedAt: null },
      data: {
        deletedAt: ahora,
        status: 'SUSPENDED',
        hotmartSubscriberCode: null,
        hotmartTransactionId: null,
        // El correo se renombra para que ningún proceso vuelva a casar el
        // duplicado por correo; el original queda en la nota del slug.
        email: `duplicado.${dup.id.slice(0, 8)}@retirado.invalid`,
        slug: `${dup.slug}-retirado-${f(ahora)}`,
        brandName: `${dup.brandName} (duplicado retirado)`,
      },
    });
    if (m.count !== 1) throw new Error('El duplicado cambió mientras tanto.');
    // Sin .catch: dentro de la transacción un fallo silenciado dejaría la
    // transacción abortada y el commit la desharía entera sin avisar.
    await tx.auditLog.create({
      data: {
        tenantId: real.id,
        action: 'tenant.fusion_duplicado',
        resource: 'tenant',
        metadata: { duplicado: dup.id, slugDuplicado: dup.slug, correoAnterior: real.email, nota },
      },
    });
  });
  console.log(`\n✓ ${real.brandName} activo con ${dup.email}; duplicado retirado. Verifica en el panel: estado, vencimiento y Contabilidad.`);
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
