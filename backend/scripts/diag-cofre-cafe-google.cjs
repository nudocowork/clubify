// SOLO LECTURA: objetos de Google que siguen en la CLASE del cupón BIENVENIDA de
// &N COFFEE, cruzados con la base. Un objeto ahí cuyo pase ya no es un cupón
// activo es un «café gratis» que el cliente sigue viendo sin deber.
const { PrismaClient } = require('@prisma/client');
const { google } = require('googleapis');
const CUPON = '76f8dff0-7513-41e6-9b98-cc6578b0a6af';
const sa = (() => { const raw = process.env.GOOGLE_WALLET_SA_JSON || process.env.GOOGLE_WALLET_SA_BASE64; return JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString()); })();
const issuer = process.env.GOOGLE_WALLET_ISSUER_ID;
(async () => {
  const p = new PrismaClient();
  const auth = new google.auth.JWT(sa.client_email, undefined, sa.private_key, ['https://www.googleapis.com/auth/wallet_object.issuer']);
  const api = google.walletobjects({ version: 'v1', auth });
  const classId = `${issuer}.card_${CUPON.replace(/-/g, '_')}`;
  const objs = []; let token;
  do {
    const r = await api.loyaltyobject.list({ classId, token, maxResults: 100 });
    objs.push(...(r.data.resources || [])); token = r.data.pagination?.nextPageToken;
  } while (token);
  const resumen = {};
  const raros = [];
  for (const o of objs) {
    const passId = o.id.split('.').pop().replace(/^pass_/, '').replace(/_/g, '-');
    const pase = await p.pass.findUnique({ where: { id: passId }, select: { cardId: true, status: true, customer: { select: { fullName: true } } } });
    let k;
    if (!pase) k = 'pase BORRADO';
    else if (pase.cardId !== CUPON) k = 'pase ya convertido a sellos';
    else k = `cupón ${pase.status}`;
    k += ` · Google ${o.state}`;
    resumen[k] = (resumen[k] || 0) + 1;
    if (!pase || pase.cardId !== CUPON || pase.status !== 'ACTIVE') raros.push({ k, objeto: o.id.split('.').pop(), cliente: pase?.customer?.fullName ?? null, hasSaved: o.hasUsers });
  }
  console.log('objetos en la clase del cupón:', objs.length);
  console.log(resumen);
  console.log(raros);
  await p.$disconnect();
})().catch((e) => { console.error('Falló:', e?.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1); });
