/**
 * Pide a Google que CREE el objeto del pase, para leer su error literal.
 *
 * Cuando el cliente toca «Añadir a Google Wallet», Google recibe el JWT y crea
 * el LoyaltyObject. Si algo del payload no le gusta, al cliente solo le enseña
 * «Ocurrió un error» — sin decir qué. Esto hace la misma llamada desde aquí y
 * enseña la respuesta completa.
 *
 * Escribe en Google (crea el objeto), NO en nuestra base. Es exactamente el
 * objeto que el cliente está intentando crear, así que si sale bien, su
 * siguiente intento funciona; y si sale mal, por fin sabemos por qué.
 *
 * Uso: railway run node scripts/probar-guardado-google.cjs <passId>
 */
const { google } = require('googleapis');

const PASS_ID = process.argv[2];
if (!PASS_ID) {
  console.error('Falta el passId.');
  process.exit(1);
}

const API = process.env.API_URL || 'https://api.soyclubify.com';

function credenciales() {
  const raw =
    process.env.GOOGLE_WALLET_SA_JSON || process.env.GOOGLE_WALLET_SA_BASE64;
  if (!raw) return null;
  try {
    return JSON.parse(
      raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString(),
    );
  } catch {
    return null;
  }
}

(async () => {
  const sa = credenciales();
  if (!sa) return console.log('Sin credenciales de Google Wallet.');

  // El MISMO payload que va en el enlace que se le da al cliente.
  const r = await fetch(`${API}/api/passes/${PASS_ID}/google`);
  const { saveUrl } = await r.json();
  if (!saveUrl) return console.log('El backend no devolvió saveUrl.');

  const jwt = saveUrl.split('/save/')[1];
  const payload = JSON.parse(
    Buffer.from(
      jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/') +
        '='.repeat((4 - (jwt.split('.')[1].length % 4)) % 4),
      'base64',
    ).toString(),
  ).payload;

  const objeto = payload.loyaltyObjects?.[0];
  const clase = payload.loyaltyClasses?.[0];
  console.log(`objeto  ${objeto?.id}`);
  console.log(`clase   ${clase?.id}\n`);

  const auth = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/wallet_object.issuer',
  ]);
  const api = google.walletobjects({ version: 'v1', auth });

  try {
    const res = await api.loyaltyobject.insert({ requestBody: objeto });
    console.log(`✓ GOOGLE LO ACEPTA. state = ${res.data.state}`);
    console.log('  El pase se puede guardar; si al cliente le seguía fallando,');
    console.log('  era esto y ya está creado.');
  } catch (e) {
    const d = e?.response?.data?.error;
    console.log(`✗ GOOGLE LO RECHAZA · ${d?.code ?? e.code}`);
    console.log(`  ${d?.message ?? e.message}`);
    for (const x of d?.errors ?? []) {
      console.log(`   · reason=${x.reason}`);
      console.log(`     ${x.message}`);
      if (x.location) console.log(`     en: ${x.location}`);
    }
    if (d?.details) console.log('  detalles: ' + JSON.stringify(d.details));
  }
})();
