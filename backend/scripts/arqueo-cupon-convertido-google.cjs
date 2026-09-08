/**
 * SOLO LECTURA: qué le pasa en Google a un cupón que se convirtió en sellos.
 *
 * Al canjear un cupón, el pase «evoluciona»: mismo passId, mismo serial, mismo
 * QR, pero `cardId` pasa a ser el de la tarjeta de sellos
 * (`stamps.service.ts`, transformación in-place).
 *
 * En Apple da igual: el .pkpass se regenera entero y el iPhone se lo baja.
 *
 * En Google NO. El id de la clase se deriva del `cardId`
 * (`<issuer>.card_<cardId>`), así que al cambiar de tarjeta el pase debería
 * cambiar de CLASE — y `classId` es INMUTABLE en un LoyaltyObject ya creado.
 * Si es eso, el Android se queda con la tarjeta de cupón para siempre y los
 * push tampoco llegan, porque se mandan contra el objeto.
 *
 * Este arqueo compara, para cada pase convertido: la clase que TIENE el objeto
 * en Google contra la que le TOCARÍA por su tarjeta actual.
 *
 * Uso: railway run node scripts/arqueo-cupon-convertido-google.cjs [slug] [muestra]
 */
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');

const SLUG = process.argv[2] || 'primor-barber-shop';
const MUESTRA = Number(process.argv[3] || 12);

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

const sufijo = (s) => String(s).replace(/-/g, '_');

(async () => {
  const p = new PrismaClient();
  const sa = credenciales();
  if (!sa) return console.log('Sin credenciales de Google Wallet.');
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID || '';

  const auth = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/wallet_object.issuer',
  ]);
  const api = google.walletobjects({ version: 'v1', auth });

  const t = await p.tenant.findUnique({
    where: { slug: SLUG },
    select: { id: true, brandName: true },
  });
  if (!t) return console.log(`no existe el negocio «${SLUG}»`);

  // Pases que vivieron una conversión de cupón: tienen un Stamp REDEEM con
  // redeemKind COUPON y hoy cuelgan de una tarjeta de SELLOS.
  const convertidos = await p.stamp.findMany({
    where: { tenantId: t.id, action: 'REDEEM', redeemKind: 'COUPON' },
    select: { passId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: MUESTRA,
  });
  const ids = [...new Set(convertidos.map((s) => s.passId).filter(Boolean))];

  const pases = await p.pass.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      cardId: true,
      walletPlatform: true,
      walletInstalledAt: true,
      googleObjectId: true,
      card: { select: { name: true, type: true } },
    },
  });

  console.log(`${t.brandName} · ${pases.length} pase(s) convertidos de cupón\n`);

  let desfasados = 0;
  let sinObjeto = 0;
  let alDia = 0;

  for (const pase of pases) {
    const esperada = `${issuerId}.card_${sufijo(pase.cardId)}`;
    const objectId = pase.googleObjectId || `${issuerId}.pass_${sufijo(pase.id)}`;
    let linea = `  ${pase.id.slice(0, 8)} · ${(pase.card?.name ?? '').slice(0, 18).padEnd(20)} ${String(pase.walletPlatform ?? '—').padEnd(7)}`;
    try {
      const r = await api.loyaltyobject.get({ resourceId: objectId });
      const tiene = r.data.classId;
      if (tiene === esperada) {
        alDia++;
        linea += ' clase AL DÍA';
      } else {
        desfasados++;
        linea += ` clase VIEJA → ${String(tiene).split('.').pop()}`;
        linea += `\n      le tocaría → ${esperada.split('.').pop()}`;
      }
    } catch (e) {
      const code = e?.code ?? e?.response?.data?.error?.code;
      if (code === 404) {
        sinObjeto++;
        linea += ' sin objeto en Google (nunca se guardó)';
      } else {
        linea += ` error ${code}`;
      }
    }
    console.log(linea);
  }

  console.log(`\n  clase al día ......... ${alDia}`);
  console.log(`  clase VIEJA .......... ${desfasados}   ← siguen viendo el cupón`);
  console.log(`  sin objeto ........... ${sinObjeto}`);
  if (desfasados) {
    console.log(
      '\n  El `classId` de un LoyaltyObject es INMUTABLE: el pase no puede\n' +
        '  cambiar de clase, así que el Android se queda con la tarjeta vieja\n' +
        '  y los push contra ese objeto llegan a la tarjeta equivocada.',
    );
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e?.response?.data ? JSON.stringify(e.response.data) : e.message);
  process.exit(1);
});
