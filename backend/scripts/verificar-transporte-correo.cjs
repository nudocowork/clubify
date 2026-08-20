/**
 * SOLO LECTURA (salvo --enviar) — ¿por qué subcuenta saldría el correo de cada
 * negocio, y con qué remitente? Replica la cascada de
 * `BrandEmailService.resolveBrand` + `platformTransport` contra datos reales.
 *
 * Uso:
 *   railway run node scripts/verificar-transporte-correo.cjs
 *   railway run node scripts/verificar-transporte-correo.cjs --enviar tu@correo.com
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const API = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const PLATFORM_SLUG = 'clubify';
const idx = process.argv.indexOf('--enviar');
const ENVIAR_A = idx > -1 ? process.argv[idx + 1] : null;

const cacheId = new Map();
async function identidad(locationId, apiKey) {
  if (cacheId.has(locationId)) return cacheId.get(locationId);
  let out = '¿?';
  try {
    const r = await fetch(`${API}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Version: VERSION, Accept: 'application/json' },
    });
    const j = r.ok ? await r.json() : null;
    const l = j ? (j.location ?? j) : null;
    out = l ? `${l.name} <${l.email ?? 's/correo'}>` : `HTTP ${r.status}`;
  } catch (e) { out = `error: ${e.message}`; }
  cacheId.set(locationId, out);
  return out;
}

/** Fallback de plataforma: cuenta asignada al negocio > predeterminada. */
async function platformTransport(tenantId) {
  if (tenantId) {
    const [t] = await p.$queryRawUnsafe(
      `SELECT "billingAlertsAccountId" FROM "Tenant" WHERE id = $1`, tenantId);
    if (t?.billingAlertsAccountId) {
      const [a] = await p.$queryRawUnsafe(
        `SELECT name, "locationId", "apiKey" FROM "GrowBusinessAccount"
          WHERE id = $1 AND "deletedAt" IS NULL`, t.billingAlertsAccountId);
      if (a) return { ...a, via: 'cuenta asignada al negocio' };
    }
  }
  const [d] = await p.$queryRawUnsafe(
    `SELECT name, "locationId", "apiKey" FROM "GrowBusinessAccount"
      WHERE "isDefault" = true AND "deletedAt" IS NULL LIMIT 1`);
  return d ? { ...d, via: 'subcuenta predeterminada' } : null;
}

(async () => {
  const marcas = await p.$queryRawUnsafe(
    `SELECT id, name, slug, "growBusinessLocationId", "growBusinessApiKey"
       FROM "WhiteLabel" ORDER BY slug`);

  for (const m of marcas) {
    const [t] = await p.$queryRawUnsafe(
      `SELECT id, name FROM "Tenant"
        WHERE "whiteLabelId" = $1 AND "deletedAt" IS NULL
          AND "currentPeriodEnd" IS NOT NULL LIMIT 1`, m.id);
    const esPlataforma = m.slug === PLATFORM_SLUG;
    console.log(`\n▸ ${m.name}  (${m.slug}${esPlataforma ? ', plataforma' : ', marca blanca'})`);
    console.log(`  firma del correo:  "Enviado por ${m.name}" · logo y color de la marca`);

    if (m.growBusinessLocationId && m.growBusinessApiKey) {
      console.log(`  transporte:        subcuenta PROPIA de la marca`);
      console.log(`  remitente:         (subcuenta ${m.growBusinessLocationId})`);
      continue;
    }
    if (!esPlataforma) {
      console.log(`  transporte:        NINGUNO — marca blanca sin subcuenta, no envía`);
      console.log(`  (correcto: sacarlo por una subcuenta de Clubify delataría la plataforma)`);
      continue;
    }
    const tr = await platformTransport(t?.id ?? null);
    if (!tr) { console.log(`  transporte:        NINGUNO — no hay subcuenta predeterminada`); continue; }
    console.log(`  transporte:        ${tr.name}  (${tr.via})`);
    console.log(`  remitente real:    ${await identidad(tr.locationId, tr.apiKey)}`);
    console.log(`  negocio de muestra: ${t?.name ?? '—'}`);

    if (ENVIAR_A && esPlataforma) {
      const up = await fetch(`${API}/contacts/upsert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tr.apiKey}`, Version: VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: tr.locationId, email: ENVIAR_A }),
      });
      const uj = await up.json().catch(() => ({}));
      const contactId = uj?.contact?.id ?? uj?.id;
      if (!contactId) { console.log(`  ENVÍO: falló el upsert — ${up.status} ${JSON.stringify(uj).slice(0,200)}`); continue; }
      const res = await fetch(`${API}/conversations/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tr.apiKey}`, Version: VERSION, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'Email', contactId,
          subject: `Prueba de transporte — ${m.name}`,
          html: `<p>Este correo salió por la subcuenta <b>${tr.name}</b> (${tr.via}).</p><p style="color:#9CA3AF;font-size:11px">Enviado por ${m.name}</p>`,
          message: `Este correo salió por la subcuenta ${tr.name} (${tr.via}).`,
        }),
      });
      const rj = await res.json().catch(() => ({}));
      console.log(`  ENVÍO: ${res.status} ${rj?.message ?? JSON.stringify(rj).slice(0, 160)}`);
    }
  }
  await p.$disconnect();
})().catch(async (e) => { console.error(e.message); await p.$disconnect(); process.exit(1); });
