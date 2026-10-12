/**
 * SOLO LECTURA. «El cliente tiene N sellos pero en su wallet y su tarjeta no se
 * ven» (Konys, José Carlos, 2026-10-12). Muestra, para los clientes de un
 * negocio que coinciden con un nombre, TODOS sus pases y lo que hace falta para
 * saber dónde está el problema:
 *
 *   - ¿Hay más de un cliente o más de un pase? (los sellos en uno y la tarjeta
 *     instalada en otro: entonces tampoco se ven en la tarjeta web).
 *   - Por pase: tarjeta, tipo, sellos, si existe objeto de Google, si hay
 *     registro de iPhone (WalletDevice), última plataforma pulsada y los
 *     últimos movimientos de sellos (quién, cuándo, a qué pase).
 *
 *   railway run --service Postgres-Nq8w node scripts/diag-sellos-no-se-ven.cjs --negocio konys --nombre "jose carlos"
 */
const { PrismaClient } = require('@prisma/client');
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const slug = arg('negocio');
const nombre = (arg('nombre') || '').trim();
if (!slug || !nombre) {
  console.error('Uso: --negocio <slug> --nombre "<parte del nombre>"');
  process.exit(1);
}
const f = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  const t = await p.tenant.findFirst({
    where: { slug: { contains: slug, mode: 'insensitive' }, deletedAt: null },
    select: { id: true, brandName: true, slug: true },
  });
  if (!t) throw new Error(`No hay negocio con slug parecido a «${slug}».`);
  console.log(`${t.brandName} (${t.slug})`);

  // Por cada palabra del nombre, sin tildes ni mayúsculas.
  const palabras = nombre.split(/\s+/).filter(Boolean);
  const clientes = await p.customer.findMany({
    where: {
      tenantId: t.id,
      AND: palabras.map((w) => ({ fullName: { contains: w, mode: 'insensitive' } })),
    },
    select: { id: true, fullName: true, phone: true, email: true, createdAt: true },
  });
  console.log(`\nClientes que coinciden con «${nombre}»: ${clientes.length}`);
  if (clientes.length > 1) console.log('  ⚠ Hay MÁS DE UNO: puede que los sellos estén en uno y la tarjeta instalada sea del otro.');

  for (const c of clientes) {
    console.log(`\n● ${c.fullName} · tel ${c.phone ?? '—'} · ${c.email ?? 'sin correo'} · alta ${f(c.createdAt)} · id ${c.id}`);
    const pases = await p.pass.findMany({
      where: { customerId: c.id },
      select: {
        id: true, status: true, stampsCount: true, visitsCount: true, issuedAt: true, revokedAt: true,
        googleObjectId: true, applePassUrl: true, walletPlatform: true, walletInstalledAt: true,
        lastActivityAt: true, serialNumber: true,
        card: { select: { name: true, type: true, stampsRequired: true } },
        _count: { select: { walletDevices: true } },
      },
      orderBy: { issuedAt: 'asc' },
    });
    if (!pases.length) console.log('  (sin pases)');
    if (pases.length > 1) console.log(`  ⚠ Tiene ${pases.length} pases: revisar cuál tiene instalado.`);
    for (const ps of pases) {
      console.log(`  ▸ pase ${ps.id} · ${ps.card?.name ?? '—'} (${ps.card?.type ?? '—'}) · ${ps.status}${ps.revokedAt ? ` revocado ${f(ps.revokedAt)}` : ''}`);
      console.log(`    sellos ${ps.stampsCount}/${ps.card?.stampsRequired ?? '?'} · visitas ${ps.visitsCount} · emitido ${f(ps.issuedAt)} · última actividad ${f(ps.lastActivityAt)}`);
      console.log(`    Google: ${ps.googleObjectId ? `objeto ${ps.googleObjectId}` : 'SIN objeto (si es Android, nunca terminó de guardar o es un pase viejo)'}`);
      console.log(`    iPhone: ${ps._count.walletDevices} registro(s) de dispositivo${ps._count.walletDevices === 0 ? ' (si lo tiene en Apple Wallet, el teléfono NO recibe actualizaciones)' : ''}`);
      console.log(`    último botón pulsado: ${ps.walletPlatform ?? '—'} el ${f(ps.walletInstalledAt)} (no prueba dónde está instalada)`);
      const mov = await p.stamp.findMany({
        where: { passId: ps.id },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { action: true, amount: true, createdAt: true, note: true, giftReason: true, orderId: true, operator: { select: { fullName: true } } },
      });
      for (const m of mov) {
        console.log(`      ${f(m.createdAt)} ${m.action} ${m.amount ?? ''} ${m.operator?.fullName ?? (m.orderId ? 'auto por pedido' : 'sistema')}${m.note ? ` · ${m.note}` : ''}${m.giftReason ? ` · ${m.giftReason}` : ''}`);
      }
    }
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
