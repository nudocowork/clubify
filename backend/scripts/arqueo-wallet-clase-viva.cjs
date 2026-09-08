/**
 * SOLO LECTURA: qué tiene HOY la clase viva de un pase en Google Wallet.
 *
 * Todo lo que se VE del pase en Android sale de la clase (logo, color, nombre
 * del programa, imagen de cabecera) y del objeto. El backend patchea la clase
 * ENTERA en cada sello y en cada push, así que cualquier cambio del código se
 * propaga solo a las tarjetas ya instaladas.
 *
 * Esto lista, sin escribir nada, los campos visuales de la clase y del objeto
 * de una muestra de pases, para poder decir qué cambió y desde cuándo.
 *
 * Uso: railway run node scripts/arqueo-wallet-clase-viva.cjs [slug] [muestra]
 */
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');

const slug = process.argv[2] || 'primor-barber-shop';
const muestra = Number(process.argv[3] || 3);

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
    console.log('GOOGLE_WALLET_SA_BASE64 ausente: no se puede consultar Google');
    process.exit(1);
  }
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer'],
  });
  const wallet = google.walletobjects({ version: 'v1', auth });

  try {
    const t = await p.tenant.findFirst({
      where: { slug },
      select: { id: true, brandName: true },
    });
    if (!t) return console.log(`no encuentro el negocio «${slug}»`);
    console.log(`${t.brandName}\n`);

    const pases = await p.pass.findMany({
      where: { tenantId: t.id, googleObjectId: { not: null } },
      select: { id: true, googleObjectId: true, walletInstalledAt: true },
      take: muestra,
    });

    const clasesVistas = new Set();
    for (const x of pases) {
      let obj;
      try {
        obj = (await wallet.loyaltyobject.get({ resourceId: x.googleObjectId })).data;
      } catch (e) {
        console.log(`  objeto ${x.googleObjectId}: ${e?.code ?? ''} ${e?.message ?? e}`);
        continue;
      }
      console.log(`OBJETO ${x.googleObjectId}`);
      console.log(`  estado ................. ${obj.state}`);
      console.log(`  clase .................. ${obj.classId}`);
      console.log(`  locations .............. ${Array.isArray(obj.locations) ? obj.locations.length : '—'}`);
      console.log(`  merchantLocations ...... ${Array.isArray(obj.merchantLocations) ? obj.merchantLocations.length : '—'}`);
      console.log(`  textModules ............ ${(obj.textModulesData ?? []).length}`);
      console.log(`  imageModules ........... ${(obj.imageModulesData ?? []).length}`);
      console.log(`  mensajes ............... ${(obj.messages ?? []).length}`);

      if (obj.classId && !clasesVistas.has(obj.classId)) {
        clasesVistas.add(obj.classId);
        try {
          const cls = (await wallet.loyaltyclass.get({ resourceId: obj.classId })).data;
          console.log(`\n  CLASE ${obj.classId}`);
          console.log(`    issuerName ........... ${cls.issuerName}`);
          console.log(`    programName .......... ${cls.programName}`);
          console.log(`    hexBackgroundColor ... ${cls.hexBackgroundColor}`);
          console.log(`    programLogo .......... ${cls.programLogo?.sourceUri?.uri ? 'sí' : 'NO'}`);
          console.log(`    heroImage ............ ${cls.heroImage?.sourceUri?.uri ? 'sí' : 'NO'}`);
          console.log(`    reviewStatus ......... ${cls.reviewStatus}`);
          console.log(`    locations ............ ${Array.isArray(cls.locations) ? cls.locations.length : '—'}`);
          console.log(`    merchantLocations .... ${Array.isArray(cls.merchantLocations) ? cls.merchantLocations.length : '—'}`);
          console.log(`    classTemplateInfo .... ${cls.classTemplateInfo ? 'sí' : 'no'}`);
        } catch (e) {
          console.log(`  clase ${obj.classId}: ${e?.code ?? ''} ${e?.message ?? e}`);
        }
      }
      console.log('');
    }
  } finally {
    await p.$disconnect();
  }
})();
