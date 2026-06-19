// Read-only. Compara el barcode VIVO en los servers de Google (LoyaltyObject)
// vs el qrToken de la DB para los pases Google de VALMONT. Si el barcode vivo
// es un JWT largo (denso) aunque la DB tenga el token corto → el refresh NO
// actualizó el objeto y POR ESO no escanean.
//   railway run --service Postgres-Nq8w node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/inspect-valmont-google-barcode.cjs
const { PrismaClient } = require('@prisma/client');

function loadSa() {
  const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
  if (b64) {
    try {
      const p = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      if (p.client_email && p.private_key) return p;
    } catch {}
  }
  const j = process.env.GOOGLE_WALLET_SA_JSON;
  if (j) { try { const p = JSON.parse(j); if (p.client_email && p.private_key) return p; } catch {} }
  return null;
}

const fmt = (v) => {
  if (!v) return 'NULL';
  if (v.startsWith('QR-')) return `QR-corto ✅ (${v.length})`;
  if (v.split('.').length === 3) return `JWT-largo ⚠️ (${v.length} chars)`;
  return `otro (${v.length})`;
};

(async () => {
  const sa = loadSa();
  if (!sa) { console.error('✗ GOOGLE_WALLET_SA no configurado en este env'); process.exit(1); }
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: sa.client_email, key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const wallet = google.walletobjects({ version: 'v1', auth });

  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const t = await prisma.tenant.findFirst({ where: { brandName: { contains: 'almont', mode: 'insensitive' } }, select: { id: true, brandName: true } });
  if (!t) { console.error('✗ VALMONT no encontrado'); process.exit(1); }

  const passes = await prisma.pass.findMany({
    where: { tenantId: t.id, walletPlatform: 'GOOGLE', googleObjectId: { not: null } },
    select: { serialNumber: true, qrToken: true, googleObjectId: true, issuedAt: true },
    orderBy: { issuedAt: 'desc' },
  });
  console.log(`${t.brandName}: ${passes.length} pases Google con objId. Comparando DB vs Google vivo:\n`);

  // Muestra: 3 nuevos + 5 viejos
  const sample = [...passes.slice(0, 3), ...passes.slice(-5)];
  for (const p of sample) {
    const d = p.issuedAt ? new Date(p.issuedAt).toISOString().slice(0, 10) : '—';
    let live = '(?)';
    try {
      const r = await wallet.loyaltyobject.get({ resourceId: p.googleObjectId });
      live = r.data?.barcode?.value ?? '(sin barcode)';
    } catch (e) {
      live = `ERROR ${e?.code || e?.response?.status || ''}: ${(e?.message || '').slice(0, 60)}`;
    }
    const match = live === p.qrToken ? 'IGUAL' : '≠ DISTINTO';
    console.log(`  ${p.serialNumber} | ${d}`);
    console.log(`     DB qrToken : ${p.qrToken}  [${fmt(p.qrToken)}]`);
    console.log(`     Google vivo: ${typeof live === 'string' ? live.slice(0, 60) : live}  [${fmt(live)}]  -> ${match}`);
  }
  await prisma.$disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
