/**
 * Arqueo SOLO LECTURA: ¿cuántos pases marcados como GOOGLE existen de verdad
 * en Google Wallet?
 *
 * Existe porque `walletPlatform = 'GOOGLE'` y `googleObjectId` se escriben al
 * GENERAR el enlace «Añadir a Google Wallet» (la página /w/:passId lo pide en
 * cada visita), no al guardarlo. El único que sabe si el cliente tocó
 * «Guardar» es Google: GET del LoyaltyObject → 200 existe, 404 nunca se
 * guardó. Es el dato que dice a cuántos Android les afecta lo del geo.
 *
 * Solo hace GET (loyaltyobject.get). No escribe en la base ni en Google. No
 * imprime credenciales ni coordenadas: de cada objeto solo mira si existe y
 * si trae `locations` / `merchantLocations` (cuántos puntos, no cuáles).
 *
 * Uso: railway run node scripts/arqueo-wallet-google-existe.cjs [slugTenant] [muestra]
 */
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');

const slug = process.argv[2] || 'primor-barber-shop';
const muestra = Number(process.argv[3] || 60);

function cargarSA() {
  const b64 = process.env.GOOGLE_WALLET_SA_BASE64;
  if (!b64) return null;
  const parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  return parsed.client_email && parsed.private_key ? parsed : null;
}

(async () => {
  const p = new PrismaClient();
  const sa = cargarSA();
  if (!sa) {
    console.log('GOOGLE_WALLET_SA_BASE64 ausente o inválida: no se puede consultar Google');
    process.exit(1);
  }
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const wallet = google.walletobjects({ version: 'v1', auth });

  async function existe(objectId) {
    try {
      const r = await wallet.loyaltyobject.get({ resourceId: objectId });
      const o = r.data || {};
      return {
        ok: true,
        state: o.state,
        locations: Array.isArray(o.locations) ? o.locations.length : null,
        merchantLocations: Array.isArray(o.merchantLocations) ? o.merchantLocations.length : null,
        messages: Array.isArray(o.messages) ? o.messages.length : 0,
      };
    } catch (e) {
      const code = e?.code || e?.response?.status;
      return { ok: false, code };
    }
  }

  async function sondear(titulo, pases) {
    console.log(`\n== ${titulo}: ${pases.length} pases ==`);
    let existen = 0, noExisten = 0, otros = 0;
    let conLocations = 0, conMerchant = 0, locVacias = 0;
    let ejemplo = null;
    for (const ps of pases) {
      const r = await existe(ps.googleObjectId);
      if (r.ok) {
        existen++;
        if (r.locations !== null && r.locations > 0) conLocations++;
        if (r.locations !== null && r.locations === 0) locVacias++;
        if (r.merchantLocations !== null && r.merchantLocations > 0) conMerchant++;
        if (!ejemplo) ejemplo = r;
      } else if (r.code === 404) noExisten++;
      else { otros++; console.log(`   ? ${ps.id} → código ${r.code}`); }
    }
    console.log(`  existen en Google (el cliente sí guardó):     ${existen}`);
    console.log(`  404 (nunca guardó, solo abrió la página):      ${noExisten}`);
    if (otros) console.log(`  otros errores:                                 ${otros}`);
    console.log(`  de los que existen: con locations[] (>0): ${conLocations} · locations vacío/ausente: ${existen - conLocations} · con merchantLocations[]: ${conMerchant}`);
    if (ejemplo) console.log(`  ejemplo de objeto vivo: state=${ejemplo.state} locations=${ejemplo.locations} merchantLocations=${ejemplo.merchantLocations} messages=${ejemplo.messages}`);
  }

  try {
    const t = await p.tenant.findFirst({ where: { slug }, select: { id: true, name: true } });
    if (!t) { console.log(`tenant ${slug} no encontrado`); process.exit(1); }
    const pasesT = await p.pass.findMany({
      where: { tenantId: t.id, walletPlatform: 'GOOGLE', googleObjectId: { not: null } },
      select: { id: true, googleObjectId: true },
    });
    await sondear(`${t.name} · walletPlatform=GOOGLE`, pasesT);

    const pasesApple = await p.pass.findMany({
      where: { tenantId: t.id, walletPlatform: 'APPLE', googleObjectId: { not: null } },
      select: { id: true, googleObjectId: true },
    });
    await sondear(`${t.name} · walletPlatform=APPLE pero con googleObjectId`, pasesApple);

    // Muestra al azar de toda la plataforma (walletPlatform=GOOGLE, ACTIVE).
    const ids = await p.$queryRawUnsafe(
      `SELECT id, "googleObjectId" FROM "Pass" WHERE "walletPlatform"='GOOGLE' AND "googleObjectId" IS NOT NULL AND status='ACTIVE' ORDER BY random() LIMIT ${Math.max(1, Math.min(muestra, 300))}`,
    );
    await sondear(`Toda la plataforma · muestra aleatoria walletPlatform=GOOGLE ACTIVE`, ids);
    console.log('');
  } finally {
    await p.$disconnect();
  }
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
