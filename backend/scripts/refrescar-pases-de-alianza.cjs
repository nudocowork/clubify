// Vuelve a pintar los pases de ALIANZA que ya están instalados.
//
// POR QUÉ (2026-09-14, Altieri): la cabecera del pase de una alianza enseñaba
// el logo del ALIADO —que ya ocupa el centro de la franja— y nunca el del
// negocio que emite la tarjeta. El arreglo está en el código (`resolveLogoUri`
// y la lista de candidatos de Apple), pero un pase YA GUARDADO no se entera
// solo: Apple re-descarga cuando le avisan, y en Google hay que PATCHear la
// clase. Esto es ese aviso.
//
// CÓMO. No arranca la aplicación: solo toca la base y **encola** el trabajo en
// Redis. Quien lo ejecuta es el backend DESPLEGADO, que es el que tiene el
// código nuevo — si esto lo procesara la máquina de turno, repintaría los pases
// con el `dist/` que tuviera en el disco. El envío es SILENCIOSO: al cliente no
// le llega notificación, solo se le actualiza la tarjeta.
//
// Ensayo por defecto; encola solo con --aplicar.
// Uso: cd backend && railway run node scripts/refrescar-pases-de-alianza.cjs [--aplicar] [--tenant <id|slug>]
const { PrismaClient } = require('@prisma/client');
const { Queue } = require('bullmq');

const APLICAR = process.argv.includes('--aplicar');
const iTenant = process.argv.indexOf('--tenant');
const TENANT = iTenant > -1 ? process.argv[iTenant + 1] : null;

/** Igual que `QueueService.parseRedisUrl`, para encolar donde encola la app. */
function conexionRedis(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

(async () => {
  const prisma = new PrismaClient();
  const negocio = TENANT
    ? await prisma.tenant.findFirst({
        where: { OR: [{ id: TENANT }, { slug: TENANT }] },
        select: { id: true, brandName: true },
      })
    : null;
  if (TENANT && !negocio) {
    console.error(`no encuentro el negocio "${TENANT}"`);
    process.exit(1);
  }

  const pases = await prisma.pass.findMany({
    where: {
      status: { not: 'REVOKED' },
      card: { convenioId: { not: null } },
      ...(negocio ? { tenantId: negocio.id } : {}),
    },
    select: {
      id: true,
      walletPlatform: true,
      googleObjectId: true,
      card: { select: { name: true } },
      tenant: { select: { brandName: true } },
    },
  });

  const porNegocio = new Map();
  for (const p of pases) {
    const k = p.tenant.brandName;
    const v = porNegocio.get(k) ?? { total: 0, google: 0, apple: 0 };
    v.total += 1;
    if (p.googleObjectId) v.google += 1;
    if (p.walletPlatform === 'APPLE') v.apple += 1;
    porNegocio.set(k, v);
  }
  console.log(`pases de alianza vivos: ${pases.length}${negocio ? ` (solo ${negocio.brandName})` : ''}`);
  for (const [n, v] of [...porNegocio.entries()].sort()) {
    console.log(`  ${n.padEnd(32)} ${String(v.total).padStart(4)} pases · ${v.google} con objeto de Google · ${v.apple} marcados Apple`);
  }
  if (pases.length === 0) { await prisma.$disconnect(); return; }

  if (!APLICAR) {
    console.log('\n-- ENSAYO. Con --aplicar se les encola el repintado (silencioso).');
    await prisma.$disconnect();
    return;
  }

  const url = process.env.REDIS_URL;
  if (!url) {
    console.error('Sin REDIS_URL no hay a quién encolarle: la app lo ejecutaría acá con el dist de esta máquina.');
    process.exit(1);
  }

  // Apple decide si re-descarga con `If-Modified-Since`: sin tocar esto, el
  // teléfono pide el pase y le contestamos 304 «no ha cambiado».
  const ahora = new Date();
  await prisma.pass.updateMany({
    where: { id: { in: pases.map((p) => p.id) } },
    data: { lastActivityAt: ahora },
  });

  const cola = new Queue('wallet.push', { connection: conexionRedis(url) });
  let encolados = 0;
  for (const p of pases) {
    await cola.add(
      'wallet.push',
      { passId: p.id, reason: 'global_refresh', silent: true },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
    );
    encolados += 1;
  }
  await cola.close();
  console.log(`\nencolados ${encolados} repintados silenciosos. Los ejecuta el backend desplegado.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
