// READ-ONLY. Prueba la mapsApiKey de Sellea contra Google (Static Maps respeta
// las restricciones de referrer HTTP igual que la JS API) para saber si el
// dominio del panel está permitido en la key. NO modifica nada.
const { PrismaClient } = require('@prisma/client');

(async () => {
  const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  const wl = await p.whiteLabel.findFirst({ where: { slug: 'sellea' }, select: { mapsApiKey: true } });
  await p.$disconnect();
  const key = wl?.mapsApiKey;
  if (!key) { console.log('Sellea no tiene mapsApiKey'); return; }
  console.log('mapsApiKey:', key.slice(0, 14) + '… (len ' + key.length + ')\n');

  const test = async (label, k, ref) => {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=10.5,-66.9&zoom=12&size=200x200&key=${k}`;
    try {
      const r = await fetch(url, { headers: { Referer: ref } });
      const ct = r.headers.get('content-type') || '';
      let extra = '';
      if (!ct.startsWith('image')) extra = ' → ' + (await r.text()).slice(0, 160).replace(/\s+/g, ' ');
      const verdict = ct.startsWith('image') ? '✅ OK' : '❌ RECHAZADO';
      console.log(`[${label}] Referer ${ref} → HTTP ${r.status} · ${verdict}${extra}`);
    } catch (e) {
      console.log(`[${label}] Referer ${ref} → ERROR ${e.message}`);
    }
  };

  console.log('── Key de SELLEA ──');
  for (const ref of ['https://app.selleala.com/', 'https://www.selleala.com/']) await test('sellea', key, ref);

  const GLOBAL = process.env.GLOBAL_MAPS_KEY || 'AIzaSyDjXb8lol8X-00L1rXjCuEAo01rD21PnCE';
  console.log('\n── Key GLOBAL Clubify · ¿ya acepta selleala.com? ──');
  console.log('   ("API is not activated" = referer ACEPTADO ✅ | "not authorized to use this API key" = referer RECHAZADO ❌)');
  for (const ref of ['https://app.selleala.com/', 'https://www.selleala.com/', 'https://soyclubify.com/']) await test('global', GLOBAL, ref);
})().catch((e) => { console.error(e.message); process.exit(1); });
