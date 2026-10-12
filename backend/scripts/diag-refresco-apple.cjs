/**
 * SOLO LECTURA. Hace EXACTAMENTE lo que hace un iPhone al deslizar la tarjeta
 * hacia abajo en Wallet: pide el pase a Clubify con su serial y su token, y
 * muestra qué contesta (código HTTP, Last-Modified) y qué trae dentro el
 * .pkpass (los campos del pass.json: sellos, cabeceras) más el tamaño de la
 * franja de sellos.
 *
 * Konys, José Carlos (2026-10-12): 3 sellos en la base, iPhone registrado, y al
 * deslizar no se actualiza. Esto separa «el servidor no le da la tarjeta»
 * (401/500) de «se la da pero sin los sellos» (problema del dibujo).
 *
 *   railway run --service backend --environment production node scripts/diag-refresco-apple.cjs --pase <passId>
 */
const { PrismaClient } = require('@prisma/client');
const zlib = require('zlib');

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const passId = arg('pase');
if (!passId) {
  console.error('Uso: --pase <passId>');
  process.exit(1);
}
const API = (process.env.API_PUBLIC_URL || 'https://api.soyclubify.com').replace(/\/$/, '');
const TIPO = process.env.APPLE_PASS_TYPE_ID || 'pass.com.clubify.loyalty';

/** Lee un archivo de un zip en memoria (directorio central). */
function leerDelZip(buf, nombre) {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) return null;
  const total = buf.readUInt16LE(fin + 10);
  let off = buf.readUInt32LE(fin + 16);
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(off + 10);
    const tamComp = buf.readUInt32LE(off + 20);
    const lNombre = buf.readUInt16LE(off + 28);
    const lExtra = buf.readUInt16LE(off + 30);
    const lComent = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const n = buf.slice(off + 46, off + 46 + lNombre).toString();
    if (n === nombre) {
      const lnL = buf.readUInt16LE(local + 26);
      const leL = buf.readUInt16LE(local + 28);
      const datos = buf.slice(local + 30 + lnL + leL, local + 30 + lnL + leL + tamComp);
      return metodo === 8 ? zlib.inflateRawSync(datos) : datos;
    }
    off += 46 + lNombre + lExtra + lComent;
  }
  return null;
}

const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});

(async () => {
  const pase = await p.pass.findUnique({
    where: { id: passId },
    select: { serialNumber: true, authToken: true, stampsCount: true, lastActivityAt: true, issuedAt: true },
  });
  if (!pase) throw new Error('No existe ese pase.');
  console.log(`Base: ${pase.stampsCount} sellos · lastActivityAt ${pase.lastActivityAt?.toISOString() ?? '—'}`);

  const url = `${API}/api/wallet/apple/v1/passes/${encodeURIComponent(TIPO)}/${encodeURIComponent(pase.serialNumber)}`;
  const t0 = Date.now();
  const r = await fetch(url, { headers: { Authorization: `ApplePass ${pase.authToken}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(`GET como el iPhone → HTTP ${r.status} en ${Date.now() - t0} ms · ${buf.length} bytes · Last-Modified ${r.headers.get('last-modified') ?? '—'}`);
  if (r.status !== 200) {
    console.log(`  Cuerpo: ${buf.toString().slice(0, 300)}`);
    console.log('  ⇒ El servidor NO le entrega la tarjeta: por eso deslizar no la actualiza.');
    return p.$disconnect();
  }
  const pj = leerDelZip(buf, 'pass.json');
  if (!pj) {
    console.log('  ⚠ No se encontró pass.json dentro del .pkpass.');
    return p.$disconnect();
  }
  const json = JSON.parse(pj.toString());
  const estilo = json.storeCard || json.generic || json.coupon || json.eventTicket || {};
  for (const grupo of ['headerFields', 'primaryFields', 'secondaryFields', 'auxiliaryFields']) {
    for (const campo of estilo[grupo] || []) {
      console.log(`  ${grupo}: ${campo.label ?? ''} = ${campo.value}`);
    }
  }
  for (const img of ['strip.png', 'strip@2x.png']) {
    const b = leerDelZip(buf, img);
    console.log(`  ${img}: ${b ? `${b.length} bytes` : 'NO viene'}`);
  }
  console.log('  ⇒ Si arriba sale «3/10» y la franja viene, el servidor entrega la tarjeta correcta.');
  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERROR:', e.message);
  await p.$disconnect();
  process.exit(1);
});
