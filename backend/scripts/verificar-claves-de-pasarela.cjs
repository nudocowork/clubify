// ¿Las claves de pasarela que tienen guardadas las marcas SIRVEN?
//
// POR QUÉ EXISTE (2026-09-14): Sellea tenía en `secretKey` un Destination ID de
// webhook (`ed_…`) en vez de su `sk_live_…`. El panel la enseñaba enmascarada
// como si fuera correcta, los cobros seguían entrando (la firma del webhook usa
// OTRO secreto), y lo único que se rompía era todo lo que necesita PREGUNTARLE
// algo a Stripe — que falla con un `warn` que nadie lee. Consecuencia real: la
// conversión de prueba a plan pagado no consumía el crédito de la marca.
//
// Esto lo prueba de verdad: pide la cuenta a la pasarela con la clave guardada.
//
// Uso: railway run node scripts/verificar-claves-de-pasarela.cjs
//      (necesita `dist/` compilado — usa el descifrador del backend — y las
//       envs del SERVICIO de la app, no las de Postgres: la clave de cifrado
//       `SECRETS_ENC_KEY` vive ahí.)
const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');
const { decryptSecret } = require('../dist/common/crypto/secret-box');

/** Formato que debe tener cada clave. Mismo criterio que el panel al guardar. */
const FORMATOS = {
  secretKey: /^sk_(live|test)_/,
  publishableKey: /^pk_(live|test)_/,
  webhookSecret: /^whsec_/,
};

(async () => {
  const prisma = new PrismaClient();
  const marcas = await prisma.whiteLabel.findMany({
    select: { slug: true, name: true, status: true, paymentGateway: true, paymentConfig: true },
    orderBy: { slug: 'asc' },
  });

  let problemas = 0;
  for (const m of marcas) {
    const cfg = m.paymentConfig || {};
    console.log(`\n── ${m.name} (${m.slug}) · ${m.paymentGateway} · ${m.status}`);
    if (m.paymentGateway !== 'STRIPE') {
      console.log('   (sin comprobación automática para esta pasarela)');
      continue;
    }

    // 1. Formato de cada clave guardada.
    for (const [campo, re] of Object.entries(FORMATOS)) {
      const bruto = cfg[campo];
      if (!bruto) { console.log(`   ${campo}: FALTA`); problemas++; continue; }
      let plano;
      try { plano = decryptSecret(bruto); } catch (e) {
        console.log(`   ${campo}: no se puede descifrar (${e.message})`);
        problemas++;
        continue;
      }
      const ok = re.test(plano);
      console.log(
        `   ${campo}: ${ok ? 'formato ok' : 'FORMATO INVÁLIDO'} · ${plano.slice(0, 8)}…(${plano.length})`,
      );
      if (!ok) problemas++;
    }

    // 2. La prueba que importa: ¿la pasarela la acepta?
    let plano = null;
    try { plano = decryptSecret(cfg.secretKey || ''); } catch { /* ya reportado */ }
    if (!plano) continue;
    try {
      const cuenta = await new Stripe(plano).accounts.retrieve();
      console.log(`   conexión: OK · cuenta ${cuenta.id} (${cuenta.business_profile?.name ?? '—'})`);
    } catch (e) {
      console.log(`   conexión: FALLA ${e.statusCode ?? ''} · ${e.message}`);
      problemas++;
    }
  }

  console.log(
    problemas
      ? `\n${problemas} problema(s). Una clave mala NO corta los cobros: rompe en silencio ` +
        'todo lo que consulta a la pasarela (periodicidad del plan, prueba de 7 días, crédito de la marca).'
      : '\nTodas las marcas con pasarela responden.',
  );
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
