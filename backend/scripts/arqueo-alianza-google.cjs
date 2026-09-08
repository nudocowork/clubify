/**
 * SOLO LECTURA: qué dice GOOGLE de la tarjeta de alianza.
 *
 * Dejar de suponer. Pregunta a la API de Google Wallet por la CLASE y por el
 * OBJETO de un pase concreto y enseña su respuesta literal, incluido el
 * `reviewStatus` de la clase — que es lo que decide si un usuario cualquiera
 * puede guardar el pase o le sale «Ocurrió un error».
 *
 * Compara además con un pase NORMAL del mismo negocio, que sí funciona en
 * Android: si la diferencia está en la clase, se ve al lado.
 *
 * Uso: railway run node scripts/arqueo-alianza-google.cjs <passId de alianza>
 */
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');

const PASS_ID = process.argv[2];
if (!PASS_ID) {
  console.error('Falta el passId. Uso: node scripts/arqueo-alianza-google.cjs <passId>');
  process.exit(1);
}

function credenciales() {
  const raw =
    process.env.GOOGLE_WALLET_SA_JSON ||
    process.env.GOOGLE_WALLET_SA_BASE64 ||
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString());
  } catch {
    return null;
  }
}

(async () => {
  const p = new PrismaClient();
  const sa = credenciales();
  if (!sa) {
    console.log('No hay credenciales de Google Wallet en el entorno. Nada que preguntar.');
    return p.$disconnect();
  }
  const issuerId =
    process.env.GOOGLE_WALLET_ISSUER_ID || process.env.GOOGLE_ISSUER_ID || '';

  const auth = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/wallet_object.issuer',
  ]);
  const api = google.walletobjects({ version: 'v1', auth });

  const pase = await p.pass.findUnique({
    where: { id: PASS_ID },
    select: {
      id: true,
      cardId: true,
      tenantId: true,
      card: { select: { name: true, convenioId: true } },
      tenant: { select: { brandName: true } },
    },
  });
  if (!pase) {
    console.log('No existe ese pase.');
    return p.$disconnect();
  }

  const sufijo = (s) => String(s).replace(/-/g, '_');
  const classId = `${issuerId}.card_${sufijo(pase.cardId)}`;
  const objectId = `${issuerId}.pass_${sufijo(pase.id)}`;

  console.log(`${pase.tenant?.brandName} · tarjeta «${pase.card?.name}»`);
  console.log(`  ¿es de alianza?  ${pase.card?.convenioId ? 'SÍ' : 'no'}`);
  console.log(`  classId   ${classId}`);
  console.log(`  objectId  ${objectId}\n`);

  async function mirar(nombre, fn) {
    try {
      const r = await fn();
      return { ok: true, data: r.data };
    } catch (e) {
      const detalle = e?.response?.data?.error;
      return {
        ok: false,
        code: e?.code ?? detalle?.code,
        msg: detalle?.message ?? e?.message,
        errores: (detalle?.errors ?? []).map((x) => `${x.reason}: ${x.message}`),
      };
    }
  }

  const clase = await mirar('clase', () =>
    api.loyaltyclass.get({ resourceId: classId }),
  );
  console.log('CLASE');
  if (clase.ok) {
    console.log(`  existe · reviewStatus = ${clase.data.reviewStatus}`);
    console.log(`  programName = ${clase.data.programName}`);
    const rev = clase.data.review;
    if (rev?.comments?.length) {
      console.log('  comentarios de la revisión de Google:');
      for (const c of rev.comments) console.log(`    · ${c.comment ?? JSON.stringify(c)}`);
    }
    const im = clase.data.imageModulesData ?? [];
    if (im.length) console.log(`  imágenes en la clase: ${im.map((x) => x.id).join(', ')}`);
  } else {
    console.log(`  NO existe o falló · ${clase.code} ${clase.msg}`);
    for (const e of clase.errores ?? []) console.log(`    · ${e}`);
  }

  const objeto = await mirar('objeto', () =>
    api.loyaltyobject.get({ resourceId: objectId }),
  );
  console.log('\nOBJETO');
  if (objeto.ok) {
    console.log(`  existe · state = ${objeto.data.state}`);
    const im = objeto.data.imageModulesData ?? [];
    console.log(`  imágenes: ${im.length ? im.map((x) => x.id).join(', ') : '(ninguna)'}`);
    for (const x of im) {
      console.log(`    ${x.id} → ${x.mainImage?.sourceUri?.uri ?? '(sin uri)'}`);
    }
  } else {
    console.log(`  NO existe todavía (nadie lo ha guardado) · ${objeto.code} ${objeto.msg}`);
  }

  // Una tarjeta NORMAL del mismo negocio, para comparar la clase.
  const normal = await p.pass.findFirst({
    where: { tenantId: pase.tenantId, card: { convenioId: null } },
    select: { cardId: true, card: { select: { name: true } } },
  });
  if (normal) {
    const claseNormal = `${issuerId}.card_${sufijo(normal.cardId)}`;
    const c2 = await mirar('clase normal', () =>
      api.loyaltyclass.get({ resourceId: claseNormal }),
    );
    console.log(`\nCLASE de una tarjeta NORMAL («${normal.card?.name}»), para comparar`);
    console.log(
      c2.ok
        ? `  existe · reviewStatus = ${c2.data.reviewStatus}`
        : `  NO existe · ${c2.code} ${c2.msg}`,
    );
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e?.response?.data ? JSON.stringify(e.response.data) : e.message);
  process.exit(1);
});
