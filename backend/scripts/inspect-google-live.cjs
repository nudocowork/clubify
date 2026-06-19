// Read-only, SIN DB (usa objId hardcodeados del diagnóstico). Solo necesita las
// creds de Google → correr con el env del BACKEND:
//   railway run --service backend node /Users/jhonarias/Documents/AGENTES/CLUBIFY/backend/scripts/inspect-google-live.cjs
// Compara el barcode.value VIVO en Google vs el qrToken corto de la DB.
function loadSa() {
  const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
  if (b64) { try { const p = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); if (p.client_email && p.private_key) return p; } catch {} }
  const j = process.env.GOOGLE_WALLET_SA_JSON;
  if (j) { try { const p = JSON.parse(j); if (p.client_email && p.private_key) return p; } catch {} }
  return null;
}
const fmt = (v) => !v ? 'NULL' : v.startsWith('QR-') ? `QR-corto ✅` : v.split('.').length === 3 ? `JWT-largo ⚠️(${v.length})` : `otro(${v.length})`;

const targets = [
  { serial: 'CLB-6Q5VDN6JBR', dia: '06-15 VIEJO', objId: '3388000000023129792.pass_7bc99e20_e828_4d74_8ea9_bacd529fd384', dbTok: 'QR-V2cX6RWEt0WXg3eXqCLA' },
  { serial: 'CLB-RGSD4K8GCR', dia: '06-15 VIEJO', objId: '3388000000023129792.pass_fe666408_f374_4185_9d58_04fb500df2e4', dbTok: 'QR-nfXboAtbdHhix3cyEyED' },
  { serial: 'CLB-OUYPIJWMO6', dia: '06-15 VIEJO', objId: '3388000000023129792.pass_a5d91931_f55f_4b0f_b896_0f9f60da2f2a', dbTok: 'QR-1CDntkyecWdmg5jme0VQ' },
  { serial: 'CLB-EC6ETCER5P', dia: '06-18 nuevo', objId: '3388000000023129792.pass_6dc27027_0430_4dc4_9a0e_819f0bc0889e', dbTok: 'QR-rnHDxYZdg-Sfvf2iHJe6' },
];

(async () => {
  const sa = loadSa();
  if (!sa) { console.error('✗ GOOGLE_WALLET_SA no está en este env. Corré con --service backend.'); process.exit(1); }
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'] });
  const wallet = google.walletobjects({ version: 'v1', auth });
  console.log('Comparando barcode VIVO en Google vs qrToken corto de la DB:\n');
  for (const t of targets) {
    try {
      const r = await wallet.loyaltyobject.get({ resourceId: t.objId });
      const live = r.data?.barcode?.value ?? '(sin barcode)';
      const type = r.data?.barcode?.type ?? '?';
      const same = live === t.dbTok;
      console.log(`  ${t.serial} [${t.dia}]`);
      console.log(`     Google vivo: "${String(live).slice(0, 50)}"  type=${type}  [${fmt(live)}]`);
      console.log(`     DB corto   : "${t.dbTok}"  -> ${same ? 'IGUAL ✅ (debería escanear)' : '≠ DISTINTO ⚠️ (Google tiene barcode VIEJO)'}\n`);
    } catch (e) {
      console.log(`  ${t.serial}: ERROR ${e?.code || e?.response?.status || ''}: ${(e?.message || '').slice(0, 80)}\n`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
