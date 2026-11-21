/**
 * Archiva en Google Wallet los cupones que el cliente ya canjeó y que seguían
 * a la vista como «disponibles».
 *
 * EL FALLO (arreglado en `stamps.service.ts` el 2026-11-20)
 * ---------------------------------------------------------
 * Al canjear un cupón de un cliente que ya tenía INSTALADA la tarjeta de
 * sellos, el cupón se fundía en ella y su fila se BORRABA. Su objeto de Google
 * quedaba ACTIVE con el premio escrito («Reclama Gratis 1 Americano») y ya no
 * había fila desde la que actualizarlo. Ahora el cupón se cierra (COMPLETED) y
 * un cupón cerrado sale INACTIVE. Esto limpia los que quedaron de antes.
 *
 * QUÉ TOCA, y nada más
 * --------------------
 * Objetos que viven en la CLASE de una tarjeta COUPON y cuyo pase:
 *   · ya no existe en la base (fundido y borrado), o
 *   · sigue en el cupón pero COMPLETED (canjeado).
 * A esos se les pone `state: INACTIVE`: Google los pasa a «pases vencidos».
 * No se borran ni se cambia su texto. Un cupón ACTIVE de la base no se toca.
 * Un cupón INDEFINIDO nunca queda COMPLETED, así que no entra.
 *
 * Apple NO tiene arreglo desde aquí: al borrarse la fila, la cascada se llevó
 * sus registros de dispositivo. El cliente tiene que borrar el pase a mano.
 *
 * Uso (desde backend/):
 *   railway run ... node scripts/archivar-cupones-canjeados-google.cjs [slug]            ← solo mira
 *   railway run ... node scripts/archivar-cupones-canjeados-google.cjs [slug] --aplicar  ← escribe
 * Sin slug recorre todos los negocios. Idempotente: un objeto ya INACTIVE se salta.
 */
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const SLUG = args.find((a) => !a.startsWith('--')) || null;

function credenciales() {
  const raw = process.env.GOOGLE_WALLET_SA_JSON || process.env.GOOGLE_WALLET_SA_BASE64;
  if (!raw) return null;
  return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString());
}
const sufijo = (s) => String(s).replace(/-/g, '_');

(async () => {
  const p = new PrismaClient();
  const sa = credenciales();
  if (!sa) throw new Error('Sin credenciales de Google Wallet.');
  const issuer = process.env.GOOGLE_WALLET_ISSUER_ID;
  const auth = new google.auth.JWT(sa.client_email, undefined, sa.private_key, [
    'https://www.googleapis.com/auth/wallet_object.issuer',
  ]);
  const api = google.walletobjects({ version: 'v1', auth });

  const cupones = await p.card.findMany({
    where: { type: 'COUPON', ...(SLUG ? { tenant: { slug: SLUG } } : {}) },
    select: { id: true, name: true, tenant: { select: { slug: true } } },
  });
  console.log(`${APLICAR ? 'APLICANDO' : 'SOLO MIRA'} · ${cupones.length} tarjeta(s) de cupón${SLUG ? ` de ${SLUG}` : ''}\n`);

  const total = { revisados: 0, borrados: 0, canjeados: 0, archivados: 0, fallos: 0 };
  for (const card of cupones) {
    const classId = `${issuer}.card_${sufijo(card.id)}`;
    const objs = [];
    let token;
    try {
      do {
        const r = await api.loyaltyobject.list({ classId, token, maxResults: 100 });
        objs.push(...(r.data.resources || []));
        token = r.data.pagination?.nextPageToken;
      } while (token);
    } catch (e) {
      const code = e?.code ?? e?.response?.status;
      if (code !== 404) console.log(`  ${card.tenant.slug} · ${card.name}: error ${code} al listar`);
      continue; // 404 = la clase nunca se creó: nadie guardó ese cupón
    }
    // Una consulta por tarjeta, no una por objeto: con cientos de objetos y la
    // base por el proxy público, ir de uno en uno cortaba la conexión.
    const idDe = (o) => o.id.split('.').pop().replace(/^pass_/, '').replace(/_/g, '-');
    const vivos = objs.filter((o) => o.state === 'ACTIVE' || o.state === 'active');
    total.revisados += objs.length;
    const filas = vivos.length
      ? await p.pass.findMany({ where: { id: { in: vivos.map(idDe) } }, select: { id: true, cardId: true, status: true } })
      : [];
    const porId = new Map(filas.map((f) => [f.id, f]));
    for (const o of vivos) {
      const pase = porId.get(idDe(o));
      let motivo = null;
      if (!pase) motivo = 'borrado';
      else if (pase.cardId === card.id && pase.status === 'COMPLETED') motivo = 'canjeado';
      if (!motivo) continue;
      total[motivo === 'borrado' ? 'borrados' : 'canjeados']++;
      console.log(`  ${card.tenant.slug.padEnd(28)} ${card.name.slice(0, 18).padEnd(20)} ${o.id.split('.').pop()}  ${motivo}${o.hasUsers ? ' · guardado' : ''}`);
      if (!APLICAR) continue;
      try {
        await api.loyaltyobject.patch({ resourceId: o.id, requestBody: { state: 'INACTIVE' } });
        total.archivados++;
      } catch (e) {
        total.fallos++;
        console.log(`    fallo: ${e?.response?.data?.error?.message ?? e.message}`);
      }
    }
  }
  console.log('\n', total);
  if (!APLICAR) console.log('\nNada escrito. Repetir con --aplicar para archivarlos.');
  await p.$disconnect();
})().catch((e) => {
  console.error('Falló:', e?.response?.data ? JSON.stringify(e.response.data) : e.message);
  process.exit(1);
});
