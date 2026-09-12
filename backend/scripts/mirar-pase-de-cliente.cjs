/**
 * Todo lo que existe del pase de UN cliente, y qué dice Google de verdad.
 *
 * El diagnóstico agregado (`diagnostico-tarjetas-mudas.cjs`) mira una MUESTRA
 * y solo los pases con `walletPlatform='GOOGLE'` y `googleObjectId` puesto.
 * Un caso concreto que no cuadre se le escapa por cualquiera de las dos
 * puertas. Esto no filtra nada: saca TODOS los pases del cliente, con o sin
 * plataforma, activos o no, y pregunta a Google objeto por objeto.
 *
 * Nace del caso Isabel Reyes en Cocoa Beauty (Javier, 2026-09-12): el panel
 * dice 6/10 y el teléfono 0/10.
 *
 *   railway run node scripts/mirar-pase-de-cliente.cjs <slug> "<nombre o teléfono>"
 */
const { PrismaClient } = require('@prisma/client');

const slug = process.argv[2];
const quien = process.argv[3];
const digitos = (quien ?? '').replace(/\D/g, '');

(async () => {
  if (!slug || !quien) {
    console.error('uso: node scripts/mirar-pase-de-cliente.cjs <slug> "<nombre o teléfono>"');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
  });

  const tenant = await prisma.tenant.findFirst({
    where: { slug },
    select: { id: true, brandName: true },
  });
  if (!tenant) { console.error('negocio no encontrado'); process.exit(1); }

  const clientes = await prisma.customer.findMany({
    where: {
      tenantId: tenant.id,
      // Los dígitos SOLO si los hay: con un nombre, `replace(/\D/g,'')` deja
      // la cadena vacía y `contains: ''` casa con TODOS los teléfonos — el
      // script devolvía el negocio entero creyendo que filtraba.
      OR: [
        { fullName: { contains: quien, mode: 'insensitive' } },
        ...(digitos.length >= 4 ? [{ phone: { contains: digitos } }] : []),
      ],
    },
    select: { id: true, fullName: true, phone: true, email: true, createdAt: true },
  });
  console.log(`${tenant.brandName}: ${clientes.length} cliente(s) que casan con "${quien}"\n`);

  const conObjeto = [];
  for (const c of clientes) {
    console.log(`── ${c.fullName} · ${c.phone ?? 'sin teléfono'} · alta ${String(c.createdAt).slice(4, 16)}`);
    const pases = await prisma.pass.findMany({
      where: { customerId: c.id },
      select: {
        id: true, status: true, stampsCount: true, walletPlatform: true,
        googleObjectId: true, walletInstalledAt: true, issuedAt: true, lastActivityAt: true,
        card: { select: { id: true, name: true, stampsRequired: true, isActive: true } },
        _count: { select: { walletDevices: true } },
      },
      orderBy: { issuedAt: 'asc' },
    });
    if (!pases.length) { console.log('   sin ningún pase\n'); continue; }
    for (const p of pases) {
      console.log(`   pase ${p.id}`);
      console.log(`     tarjeta "${p.card?.name}" · ${p.stampsCount}/${p.card?.stampsRequired} sellos · ${p.status}`);
      console.log(`     plataforma=${p.walletPlatform ?? 'sin elegir'} · dispositivos Apple=${p._count.walletDevices}`);
      console.log(`     googleObjectId=${p.googleObjectId ?? '—'}`);
      console.log(`     instalado=${p.walletInstalledAt ? String(p.walletInstalledAt).slice(4, 21) : 'NO'} · ` +
        `emitido ${String(p.issuedAt).slice(4, 16)} · última actividad ${p.lastActivityAt ? String(p.lastActivityAt).slice(4, 21) : "—"}`);
      if (p.googleObjectId) conObjeto.push({ ...p, cliente: c.fullName });
    }
    console.log('');
  }
  await prisma.$disconnect();

  const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
  if (!b64) {
    console.log('(sin GOOGLE_WALLET_SA_BASE64 no se puede preguntar a Google)');
    return;
  }
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const wallet = google.walletobjects({ version: 'v1', auth });

  console.log('════ LO QUE DICE GOOGLE DE CADA OBJETO\n');
  for (const p of conObjeto) {
    try {
      const o = await wallet.loyaltyobject.get({ resourceId: p.googleObjectId });
      const d = o.data;
      console.log(`  ${p.googleObjectId}`);
      console.log(`    estado: ${d.state} · clase: ${d.classId}`);
      console.log(`    loyaltyPoints: "${d.loyaltyPoints?.balance?.string ?? '(vacío)'}" · etiqueta "${d.loyaltyPoints?.label ?? '—'}"`);
      console.log(`    secondaryLoyaltyPoints: "${d.secondaryLoyaltyPoints?.balance?.string ?? '—'}"`);
      console.log(`    EN LA BASE: ${p.stampsCount}/${p.card?.stampsRequired}`);
      const enGoogle = d.loyaltyPoints?.balance?.string ?? '';
      const enBase = `${p.stampsCount}/${p.card?.stampsRequired}`;
      console.log(`    ${enGoogle === enBase ? '✔ COINCIDE' : '*** NO COINCIDE ***'}`);
      if (d.textModulesData?.length) {
        for (const t of d.textModulesData.slice(0, 4)) {
          console.log(`    texto «${t.header ?? t.id}»: ${String(t.body ?? '').slice(0, 70)}`);
        }
      }
    } catch (e) {
      console.log(`  ${p.googleObjectId}`);
      console.log(`    NO EXISTE en Google (${e.code ?? ''} ${String(e.message).slice(0, 80)})`);
    }
    console.log('');
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
