/**
 * Busca a una persona en TODAS las clases de Google Wallet del emisor.
 *
 * POR QUÉ: `buscar-objeto-google.cjs` mira UNA clase —la del primer objeto que
 * exista— y eso no basta. Un negocio puede tener varias clases (la tarjeta se
 * rehízo, la migración de cupón a sellos creó otra, una alianza tiene la suya).
 * Si la persona está en otra clase, el script anterior dice «no existe» y es
 * mentira.
 *
 * Tampoco se fía de `Pass.walletPlatform`: ese campo guarda QUÉ BOTÓN pulsó el
 * cliente, no dónde acabó la tarjeta. Puede decir APPLE con el pase viviendo en
 * Google Wallet.
 *
 *   railway run node scripts/buscar-en-todas-las-clases.cjs "<nombre>"
 */
const { PrismaClient } = require('@prisma/client');

const quien = process.argv[2];

(async () => {
  if (!quien) { console.error('uso: node scripts/buscar-en-todas-las-clases.cjs "<nombre>"'); process.exit(1); }

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

  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  console.log(`emisor: ${issuerId ?? '(sin GOOGLE_WALLET_ISSUER_ID)'}`);

  // Todas las clases del emisor.
  const clases = [];
  let token;
  do {
    const r = await wallet.loyaltyclass.list({ issuerId, maxResults: 100, token });
    for (const c of r.data.resources ?? []) clases.push(c);
    token = r.data.pagination?.nextPageToken;
  } while (token);
  console.log(`clases del emisor: ${clases.length}\n`);

  const nombreDe = (o) =>
    (o.textModulesData ?? []).find((t) => /CLIENTE/i.test(t.header ?? ''))?.body ?? '';

  const encontrados = [];
  for (const c of clases) {
    let t2;
    let n = 0;
    do {
      const r = await wallet.loyaltyobject.list({ classId: c.id, maxResults: 100, token: t2 });
      const objs = r.data.resources ?? [];
      n += objs.length;
      for (const o of objs) {
        if (nombreDe(o).toLowerCase().includes(quien.toLowerCase())) {
          encontrados.push({ clase: c.id, programa: c.programName, obj: o });
        }
      }
      t2 = r.data.pagination?.nextPageToken;
    } while (t2);
    console.log(`  ${c.id} · "${c.programName ?? '—'}" · ${n} objetos`);
  }

  console.log(`\n════ OBJETOS CUYO «CLIENTE» CASA CON "${quien}": ${encontrados.length}\n`);
  for (const e of encontrados) {
    console.log(`  ${e.obj.id}`);
    console.log(`    clase: ${e.clase} ("${e.programa ?? '—'}")`);
    console.log(`    estado=${e.obj.state} · puntos="${e.obj.loyaltyPoints?.balance?.string ?? '—'}"`);
  }

  // Y qué tenemos nosotros de esa persona.
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  });
  const nuestros = await prisma.$queryRawUnsafe(`
    SELECT t."brandName", c."fullName", p.id, p."googleObjectId", p."stampsCount",
           ca."stampsRequired", p."walletPlatform"::text plataforma, p.status
      FROM "Pass" p
      JOIN "Customer" c ON c.id = p."customerId"
      JOIN "Tenant" t ON t.id = p."tenantId"
      JOIN "Card" ca ON ca.id = p."cardId"
     WHERE c."fullName" ILIKE '%${quien.replace(/'/g, "''")}%'`);
  console.log('\n════ LO QUE TENEMOS NOSOTROS\n');
  for (const r of nuestros) {
    console.log(`  ${r.brandName} · ${r.fullName} · ${r.stampsCount}/${r.stampsRequired} · ${r.plataforma} · ${r.status}`);
    console.log(`    obj guardado: ${r.googleObjectId ?? '—'}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
