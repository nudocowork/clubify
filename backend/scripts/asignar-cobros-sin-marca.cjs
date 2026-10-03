/**
 * Los cobros de Hotmart que entraron al libro SIN negocio NI marca (Javier,
 * 2026-10-03: «siempre es un monto grande, no puede estar en el aire»).
 * Cada uno se identificó a mano por el comprador de Hotmart:
 *
 *  - HP2339903546 ($156,72, 8-jul): Kimberlyn Gómez = Fusion sushi (mismo
 *    teléfono, Chile). El equipo creó el negocio con otro correo y sin el
 *    código de Hotmart: su renovación no se habría reconocido. Se le pone el
 *    código real y el próximo cobro contado desde la COMPRA (Sara: la fecha
 *    que manda es la de compra, no la de registro): 8-oct, no 13-nov.
 *  - «Servicios adicionales» (~$20): al negocio de su dueño cuando lo tiene.
 *  - El resto (sin negocio): ingreso de Clubify sin negocio, para que se vea.
 *
 * Idempotente (solo toca filas aún sin marca). Simula por defecto.
 *
 *   railway run --service Postgres-Nq8w node scripts/asignar-cobros-sin-marca.cjs [--aplicar]
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const APLICAR = process.argv.includes('--aplicar');

/** tx → negocio (por nombre exacto) o null = de Clubify, sin negocio. */
const DESTINO = {
  HP2339903546: { negocio: 'Fusion sushi', primerPago: true },
  HP2420873938: { negocio: 'Chillin Sports & Wings' },
  HP4216110662: { negocio: 'Segundo Piso' },
  HP2285994519: { negocio: 'BLIC' },
  HP2182632665: { negocio: 'Paicoat' },
  HP4008664774: null, // Alejandro Montoya: no tiene negocio
  HP2721330536: null, // Mauren Castillo: no tiene negocio
  HP0243420764: null, // David Moreno: pagó el trimestral y NO tiene negocio (contactarlo)
  HP0667367408: null, // Angelica Barrantes: reembolsado
};

(async () => {
  const clubify = (await p.whiteLabel.findFirst({ where: { slug: 'clubify' }, select: { id: true } }))?.id;
  if (!clubify) throw new Error('No existe la marca Clubify');
  for (const [tx, d] of Object.entries(DESTINO)) {
    const fila = await p.incomeRecord.findFirst({
      where: { externalTxId: tx, whiteLabelId: null, tenantId: null },
      select: { id: true, grossUsd: true, saleDate: true },
    });
    if (!fila) {
      console.log(`${tx}: ya estaba asignado, nada que hacer`);
      continue;
    }
    if (!d) {
      console.log(`${APLICAR ? 'APLICO' : 'simulo'} ${tx} $${fila.grossUsd} → ingreso de Clubify sin negocio`);
      if (APLICAR) await p.incomeRecord.update({ where: { id: fila.id }, data: { whiteLabelId: clubify } });
      continue;
    }
    const t = await p.tenant.findFirst({
      where: { brandName: d.negocio, deletedAt: null },
      select: { id: true, brandName: true, whiteLabelId: true, hotmartSubscriberCode: true, currentPeriodEnd: true, planPeriodicity: true },
    });
    if (!t) {
      console.log(`${tx}: NO encuentro el negocio «${d.negocio}» — no lo toco`);
      continue;
    }
    const data = { tenantId: t.id, whiteLabelId: t.whiteLabelId ?? clubify, brandName: t.brandName };
    if (d.primerPago) Object.assign(data, { category: 'NUEVA', isFirstPayment: true });
    console.log(`${APLICAR ? 'APLICO' : 'simulo'} ${tx} $${fila.grossUsd} → ${t.brandName}`);
    if (APLICAR) await p.incomeRecord.update({ where: { id: fila.id }, data });

    if (d.primerPago) {
      // El código de suscripción real y el ciclo contado desde la compra.
      const ev = (
        await p.$queryRawUnsafe(
          `SELECT COALESCE(payload->'data'->'subscription'->'subscriber'->>'code', payload->'data'->'subscriber'->>'code') sub,
                  (payload->'data'->'purchase'->>'approved_date')::bigint aprobado
             FROM "HotmartWebhookEvent"
            WHERE payload->'data'->'purchase'->>'transaction' = $1 AND "eventType" = 'PURCHASE_APPROVED' LIMIT 1`,
          tx,
        )
      )[0];
      if (!ev?.sub || !ev?.aprobado) {
        console.log(`   sin código o fecha de compra en Hotmart — no toco el negocio`);
        continue;
      }
      const compra = new Date(Number(ev.aprobado));
      const meses = { MENSUAL: 1, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 }[t.planPeriodicity ?? 'MENSUAL'] ?? 1;
      const fin = new Date(compra);
      fin.setUTCMonth(fin.getUTCMonth() + meses);
      console.log(
        `   negocio: código ${t.hotmartSubscriberCode} → ${ev.sub} · próximo cobro ${t.currentPeriodEnd?.toISOString().slice(0, 10)} → ${fin.toISOString().slice(0, 10)} (compra ${compra.toISOString().slice(0, 10)} + ${meses} meses)`,
      );
      if (APLICAR) {
        await p.tenant.update({
          where: { id: t.id },
          data: { hotmartSubscriberCode: ev.sub, currentPeriodEnd: fin, lastChargeAt: compra },
        });
      }
    }
  }
  if (!APLICAR) console.log('(simulación: --aplicar para escribir)');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
