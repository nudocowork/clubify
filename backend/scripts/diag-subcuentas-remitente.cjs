/**
 * SOLO LECTURA — ¿qué identidad tiene cada subcuenta de Grow Business?
 *
 * El correo sale por GHL, así que el REMITENTE lo pone la subcuenta. Antes de
 * dejar que la plataforma mande por una subcuenta hay que saber con qué nombre
 * y desde qué dirección escribiría.
 *
 * Uso:  railway run node scripts/diag-subcuentas-remitente.cjs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const API = 'https://services.leadconnectorhq.com';

async function identidad(locationId, apiKey) {
  try {
    const r = await fetch(`${API}/locations/${locationId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: '2021-07-28',
        Accept: 'application/json',
      },
    });
    if (!r.ok) return `HTTP ${r.status}`;
    const j = await r.json();
    const l = j.location ?? j;
    return `nombre="${l.name ?? '—'}"  email=${l.email ?? '—'}  dominio=${l.domain ?? '—'}`;
  } catch (e) {
    return `error: ${e.message}`;
  }
}

(async () => {
  console.log('═══ SUBCUENTAS GLOBALES ═══');
  const accs = await p.$queryRawUnsafe(
    `SELECT id, name, purpose, "locationId", "apiKey", "isDefault"
       FROM "GrowBusinessAccount" WHERE "deletedAt" IS NULL ORDER BY name`,
  );
  for (const a of accs) {
    console.log(`\n  ▸ ${a.name}  (${a.purpose}, default=${a.isDefault ? 'sí' : 'no'})`);
    console.log(`    locationId: ${a.locationId}`);
    console.log(`    ${await identidad(a.locationId, a.apiKey)}`);
  }

  console.log('\n═══ SUBCUENTAS DE MARCA ═══');
  const wls = await p.$queryRawUnsafe(
    `SELECT slug, "growBusinessLocationId" FROM "WhiteLabel"
      WHERE "growBusinessLocationId" IS NOT NULL ORDER BY slug`,
  );
  for (const w of wls) {
    console.log(`  ${w.slug.padEnd(12)} locationId=${w.growBusinessLocationId}`);
  }
  if (!wls.length) console.log('  (ninguna)');

  console.log('\n═══ NEGOCIOS CON SUBCUENTA PROPIA ═══');
  const ts = await p.$queryRawUnsafe(
    `SELECT name, slug, "growBusinessLocationId" FROM "Tenant"
      WHERE "growBusinessLocationId" IS NOT NULL AND "deletedAt" IS NULL
      ORDER BY name LIMIT 20`,
  );
  for (const t of ts) console.log(`  ${t.name} — ${t.growBusinessLocationId}`);
  if (!ts.length) console.log('  (ninguno)');

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e.message);
  await p.$disconnect();
  process.exit(1);
});
