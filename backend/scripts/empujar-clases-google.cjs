/**
 * Empuja las CLASES de Google Wallet para que el geo llegue ya.
 *
 * El aviso por cercanía lo dispara `merchantLocations`, y ese campo se manda
 * en la clase de cada tarjeta. Pero la clase solo se actualiza cuando alguien
 * pone un sello o sale un push: los negocios tranquilos siguen con la clase
 * de antes del arreglo del 2026-09-07 y sus clientes de Android no reciben
 * nada al pasar por la puerta.
 *
 * Medido el 2026-09-08: 53 de 102 clases sin `merchantLocations`, y 27 de esos
 * negocios habían puesto sellos ese mismo mes. No son negocios muertos: es que
 * nadie ha empujado su clase.
 *
 * Esto hace UN `loyaltyclass.patch` por tarjeta, que es exactamente lo que ya
 * ocurre en cada sello. No toca los objetos ni manda notificaciones a nadie:
 * `patch` de clase no notifica.
 *
 *   railway run node scripts/empujar-clases-google.cjs            (ensayo)
 *   railway run node scripts/empujar-clases-google.cjs --aplicar
 */
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');

const APLICAR = process.argv.includes('--aplicar');
const p = new PrismaClient();

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

/** Las sedes en el formato de Google, con el mismo filtro que el servicio. */
function sedesParaGoogle(locations) {
  return (locations ?? [])
    .map((l) => ({ latitude: Number(l.latitude), longitude: Number(l.longitude) }))
    .filter(
      (x) =>
        Number.isFinite(x.latitude) &&
        Number.isFinite(x.longitude) &&
        (x.latitude !== 0 || x.longitude !== 0),
    )
    .slice(0, 10);
}

(async () => {
  const sa = credenciales();
  if (!sa) return console.log('Sin credenciales de Google Wallet.');
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  if (!issuerId) return console.log('Sin GOOGLE_WALLET_ISSUER_ID.');

  const auth = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/wallet_object.issuer',
  ]);
  const api = google.walletobjects({ version: 'v1', auth });

  // Solo tarjetas de negocios CON sede: sin sede no hay geo que mandar.
  const cards = await p.card.findMany({
    where: { tenant: { locations: { some: { isActive: true } } } },
    select: {
      id: true,
      name: true,
      tenant: {
        select: {
          brandName: true,
          locations: {
            where: { isActive: true },
            select: { latitude: true, longitude: true },
          },
        },
      },
    },
  });

  console.log(`tarjetas de negocios con sede: ${cards.length}\n`);

  let yaEstaban = 0;
  let actualizadas = 0;
  let sinClase = 0;
  let sinSedeValida = 0;
  let fallos = 0;

  for (const c of cards) {
    const sedes = sedesParaGoogle(c.tenant?.locations);
    if (!sedes.length) {
      sinSedeValida++;
      continue;
    }
    const classId = `${issuerId}.card_${sufijo(c.id)}`;
    let actual;
    try {
      actual = (await api.loyaltyclass.get({ resourceId: classId })).data;
    } catch (e) {
      const code = e?.code ?? e?.response?.data?.error?.code;
      if (code === 404) {
        // Todavía nadie guardó esta tarjeta en Android: Google crea la clase
        // en el primer guardado, con el JWT que ya lleva el campo bueno.
        sinClase++;
      } else {
        fallos++;
        console.log(`  ✗ ${c.tenant?.brandName} · ${c.name}: get ${code}`);
      }
      continue;
    }

    if ((actual.merchantLocations ?? []).length) {
      yaEstaban++;
      continue;
    }

    console.log(
      `  ${APLICAR ? '→' : '·'} ${(c.tenant?.brandName ?? '').slice(0, 26).padEnd(28)} ` +
        `${(c.name ?? '').slice(0, 22).padEnd(24)} ${sedes.length} sede(s)`,
    );
    if (!APLICAR) {
      actualizadas++;
      continue;
    }
    try {
      // `reviewStatus` va SIEMPRE en el patch. Google rechaza con 400
      // «Invalid review status "APPROVED"» si no se lo reenvías: un cambio en
      // la clase la devuelve a revisión, y hay que decirlo explícitamente. Es
      // lo mismo que hace el servicio al sellar (`buildClass` lo incluye).
      await api.loyaltyclass.patch({
        resourceId: classId,
        requestBody: {
          merchantLocations: sedes,
          reviewStatus: 'UNDER_REVIEW',
        },
      });
      actualizadas++;
    } catch (e) {
      fallos++;
      const d = e?.response?.data?.error;
      console.log(`    ✗ patch: ${d?.code ?? e.code} ${d?.message ?? e.message}`);
    }
  }

  console.log(`\n  ya tenían el geo ........ ${yaEstaban}`);
  console.log(`  ${APLICAR ? 'actualizadas' : 'se actualizarían'} ......... ${actualizadas}`);
  console.log(`  sin clase todavía ....... ${sinClase}  (se crea al primer guardado en Android)`);
  console.log(`  sin sede con coordenadas  ${sinSedeValida}`);
  console.log(`  fallos .................. ${fallos}`);
  if (!APLICAR) console.log('\n  (ensayo — nada se ha escrito. Repite con --aplicar)');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('Falló:', e?.response?.data ? JSON.stringify(e.response.data) : e.message);
  await p.$disconnect();
  process.exit(1);
});
