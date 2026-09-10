/**
 * Cobra los negocios que quedaron ACTIVOS sin descontarle el crédito a su marca.
 *
 * EL AGUJERO (arreglado en `onboarding-sync.service.ts` el 2026-09-10)
 * -------------------------------------------------------------------
 * Las tres acciones del panel («marcar activo», «marcar pagado», «pago manual»)
 * descontaban el crédito. **El Onboarding no**: `activate()` ponía el negocio
 * en ACTIVE y ya. Y esa es justamente la puerta por la que las marcas dan de
 * alta a sus clientes. Smart Solutions entró así el 2026-09-10.
 *
 * El arreglo cubre de aquí en adelante. Esto cobra lo que ya pasó.
 *
 *   railway run node scripts/cobrar-activaciones-sin-credito.cjs            (ensayo)
 *   railway run node scripts/cobrar-activaciones-sin-credito.cjs --cobrar
 *   railway run node scripts/cobrar-activaciones-sin-credito.cjs --cobrar --negocio smart-solutions
 *
 * IDEMPOTENTE: un negocio que ya tiene un movimiento de crédito NO se vuelve a
 * cobrar. Correrlo dos veces no cobra dos veces.
 *
 * Solo mira marcas con créditos limitados y distintas de Clubify (que va por
 * Hotmart). Los InfoLink FREE no cuestan nada y quedan fuera.
 */
const { PrismaClient } = require('@prisma/client');

const COBRAR = process.argv.includes('--cobrar');
const iNeg = process.argv.indexOf('--negocio');
const SOLO = iNeg > -1 ? process.argv[iNeg + 1] : null;

/** Espejo de `cycleCreditCostForTenant`. Se copia en vez de importarse porque
 *  el TypeScript compilado no siempre está a mano al correr un script suelto,
 *  y una discrepancia aquí se vería como un cobro mal hecho. Si cambian los
 *  precios en `common/business-types.ts`, cambiar también aquí. */
const COSTE_POR_TIPO = { FULL: 1, INFOLINK: 0.1 };
const MESES = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };

function costeDelCiclo(tipo, tier, periodicidad) {
  const t = String(tipo ?? 'FULL').toUpperCase();
  if (t === 'INFOLINK' && tier === 'FREE') return 0;
  const base = COSTE_POR_TIPO[t] ?? COSTE_POR_TIPO.FULL;
  const meses = MESES[String(periodicidad ?? 'MENSUAL').toUpperCase()] ?? 1;
  return Math.round(base * meses * 100) / 100;
}

(async () => {
  const p = new PrismaClient();
  try {
    const marcas = await p.whiteLabel.findMany({
      where: { slug: { not: 'clubify' }, creditsUnlimited: false },
      select: { id: true, slug: true, name: true, creditsAvailable: true, creditsUsed: true },
    });

    const pendientes = [];
    for (const wl of marcas) {
      const activos = await p.tenant.findMany({
        where: { whiteLabelId: wl.id, status: 'ACTIVE' },
        select: {
          id: true, slug: true, brandName: true,
          businessType: true, infolinkTier: true, planPeriodicity: true, createdAt: true,
        },
      });
      if (!activos.length) continue;

      // La marca de idempotencia: un movimiento de crédito de ESTE negocio.
      const yaCobrados = new Set(
        (
          await p.creditTransaction.findMany({
            where: { whiteLabelId: wl.id, tenantId: { in: activos.map((a) => a.id) } },
            select: { tenantId: true },
          })
        ).map((x) => x.tenantId),
      );

      for (const t of activos) {
        if (yaCobrados.has(t.id)) continue;
        const coste = costeDelCiclo(t.businessType, t.infolinkTier, t.planPeriodicity);
        if (coste <= 0) continue;
        if (SOLO && t.slug !== SOLO) continue;
        pendientes.push({ wl, t, coste });
      }
    }

    if (!pendientes.length) {
      console.log('No hay negocios activos sin cobrar. Nada que hacer.');
      return;
    }

    console.log(`Negocios ACTIVOS sin cobrar: ${pendientes.length}\n`);
    for (const { wl, t, coste } of pendientes) {
      console.log(
        `  ${wl.slug.padEnd(10)} ${t.slug.padEnd(24)} ${String(t.businessType).padEnd(9)} ` +
          `${t.createdAt.toISOString().slice(0, 10)}  coste=${coste}  ` +
          `marca tiene ${wl.creditsAvailable}`,
      );
    }

    if (!COBRAR) {
      console.log('\nENSAYO. Nada cobrado. Repite con --cobrar.');
      return;
    }

    console.log('');
    for (const { wl, t, coste } of pendientes) {
      // Guarda en el WHERE, igual que el motor: si el saldo bajó desde que lo
      // leímos, no se descuenta de más.
      const debito = await p.whiteLabel.updateMany({
        where: { id: wl.id, creditsAvailable: { gte: coste } },
        data: {
          creditsAvailable: { decrement: coste },
          creditsUsed: { increment: coste },
        },
      });
      if (debito.count === 0) {
        console.log(`  SIN SALDO  ${wl.slug} / ${t.slug} · necesita ${coste}`);
        continue;
      }
      await p.creditTransaction.create({
        data: {
          whiteLabelId: wl.id,
          type: 'CONSUME',
          amount: -coste,
          tenantId: t.id,
          note:
            `Activación (retroactivo · onboarding no cobraba) · ${t.brandName} · ${coste} créd`,
        },
      });
      const despues = await p.whiteLabel.findUnique({
        where: { id: wl.id },
        select: { creditsAvailable: true, creditsUsed: true },
      });
      console.log(
        `  COBRADO    ${wl.slug} / ${t.slug} · ${coste} créd · ` +
          `quedan ${despues.creditsAvailable}, usados ${despues.creditsUsed}`,
      );
    }
  } finally {
    await p.$disconnect();
  }
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
