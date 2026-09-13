/**
 * Busca en Google TODOS los objetos de la clase de un negocio y los cruza con
 * lo que tenemos guardado.
 *
 * POR QUÉ: el pase de Isabel Reyes (Cocoa Beauty) tiene `googleObjectId`
 * guardado y ese id da 404 en Google — pero su teléfono SÍ enseña la tarjeta.
 * Si la tarjeta existe y el id que guardamos no, entonces estamos parcheando
 * un objeto que no es el suyo: por eso «Refrescar Wallet» desde el panel no
 * hace nada y la tarjeta se queda en 0/10.
 *
 * Esto lista lo que Google tiene DE VERDAD y lo compara con nuestra base.
 *
 *   railway run node scripts/buscar-objeto-google.cjs <slug> ["nombre"]
 */
const { PrismaClient } = require('@prisma/client');

const slug = process.argv[2];
const quien = process.argv[3] ?? null;

(async () => {
  if (!slug) { console.error('uso: node scripts/buscar-objeto-google.cjs <slug> ["nombre"]'); process.exit(1); }
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  });

  const filas = await prisma.$queryRawUnsafe(`
    SELECT p.id, p."googleObjectId", p."stampsCount", p."walletPlatform"::text plataforma,
           c."fullName", ca."stampsRequired", ca.id AS card_id
      FROM "Pass" p
      JOIN "Tenant" t ON t.id = p."tenantId"
      JOIN "Customer" c ON c.id = p."customerId"
      JOIN "Card" ca ON ca.id = p."cardId"
     WHERE t.slug = '${slug.replace(/'/g, "''")}' AND p.status = 'ACTIVE'`);
  await prisma.$disconnect();

  const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
  if (!b64) { console.error('sin GOOGLE_WALLET_SA_BASE64'); process.exit(1); }
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const wallet = google.walletobjects({ version: 'v1', auth });

  // Las clases que usa este negocio, sacadas del prefijo de los ids guardados.
  const clases = new Set();
  for (const f of filas) {
    if (!f.googleObjectId) continue;
    const issuer = String(f.googleObjectId).split('.')[0];
    clases.add(issuer);
  }
  console.log(`${filas.length} pases activos · issuer(s): ${[...clases].join(', ') || '—'}`);

  // Se pregunta por la CLASE de cada objeto que sí existe, para saber dónde
  // listar. Si ninguno existe, se prueba con la clase derivada de la tarjeta.
  let classId = null;
  for (const f of filas) {
    if (!f.googleObjectId) continue;
    try {
      const o = await wallet.loyaltyobject.get({ resourceId: f.googleObjectId });
      classId = o.data.classId;
      break;
    } catch { /* seguimos buscando uno que exista */ }
  }
  if (!classId) {
    const issuer = [...clases][0];
    const card = filas.find((f) => f.card_id)?.card_id;
    if (issuer && card) classId = `${issuer}.card_${String(card).replace(/-/g, '_')}`;
  }
  if (!classId) { console.error('no se pudo determinar la clase'); process.exit(1); }
  console.log(`clase: ${classId}\n`);

  const enGoogle = [];
  let token = undefined;
  do {
    const r = await wallet.loyaltyobject.list({ classId, maxResults: 100, token });
    for (const o of r.data.resources ?? []) enGoogle.push(o);
    token = r.data.pagination?.nextPageToken;
  } while (token);

  console.log(`objetos que Google tiene en esa clase: ${enGoogle.length}`);
  const guardados = new Set(filas.map((f) => f.googleObjectId).filter(Boolean));
  const idsGoogle = new Set(enGoogle.map((o) => o.id));

  const huerfanos = enGoogle.filter((o) => !guardados.has(o.id));
  const fantasmas = filas.filter((f) => f.googleObjectId && !idsGoogle.has(f.googleObjectId));
  console.log(`  en Google y NO en nuestra base: ${huerfanos.length}`);
  console.log(`  en nuestra base y NO en Google: ${fantasmas.length}\n`);

  const nombreDe = (o) =>
    (o.textModulesData ?? []).find((t) => /CLIENTE/i.test(t.header ?? ''))?.body ?? '';

  if (quien) {
    console.log(`── objetos de Google cuyo «CLIENTE» casa con "${quien}"`);
    const suyos = enGoogle.filter((o) => nombreDe(o).toLowerCase().includes(quien.toLowerCase()));
    for (const o of suyos) {
      console.log(`   ${o.id}`);
      console.log(`     estado=${o.state} · puntos="${o.loyaltyPoints?.balance?.string ?? '—'}"`);
      console.log(`     ¿está en nuestra base? ${guardados.has(o.id) ? 'SÍ' : '*** NO ***'}`);
    }
    if (!suyos.length) console.log('   ninguno');
    const nuestro = filas.filter((f) => String(f.fullName).toLowerCase().includes(quien.toLowerCase()));
    for (const f of nuestro) {
      console.log(`   nuestra base: ${f.fullName} · ${f.stampsCount}/${f.stampsRequired} · ${f.plataforma} · obj=${f.googleObjectId ?? '—'}`);
    }
  } else {
    for (const o of huerfanos.slice(0, 20)) {
      console.log(`   huérfano ${o.id} · "${nombreDe(o)}" · puntos="${o.loyaltyPoints?.balance?.string ?? '—'}"`);
    }
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
