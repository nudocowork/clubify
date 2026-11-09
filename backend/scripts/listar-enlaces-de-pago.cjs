/**
 * SOLO LECTURA. Lista todos los enlaces de pago de Hotmart guardados en la
 * configuración (Setting y WhiteLabel), con el nombre que tienen al lado, para
 * encontrar una oferta concreta (p. ej. «50 % de descuento»).
 *
 * Uso: railway run --service backend --environment production --project ba90d94d-7e6d-4056-85ad-0e3f24e8d43a \
 *        node scripts/listar-enlaces-de-pago.cjs [texto]
 * Con [texto] solo muestra los que lo contienen en el nombre o el enlace (ej. 50).
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } },
});
const filtro = (process.argv[2] || '').toLowerCase();
const RE = /https?:\/\/(?:pay\.hotmart\.com|go\.hotmart\.com|[a-z0-9.-]*hotmart[a-z0-9.-]*)\/[^\s"'<>]+/gi;

// Recorre el JSON y devuelve cada enlace con los textos de su mismo objeto.
function enlaces(v, ruta, salida) {
  if (typeof v === 'string') {
    let s = v;
    try { if (/^[[{]/.test(s.trim())) return enlaces(JSON.parse(s), ruta, salida); } catch { /* texto */ }
    for (const m of s.match(RE) || []) salida.push({ ruta, url: m, contexto: s.length < 200 ? '' : '' });
    return salida;
  }
  if (Array.isArray(v)) { v.forEach((x, i) => enlaces(x, `${ruta}[${i}]`, salida)); return salida; }
  if (v && typeof v === 'object') {
    const textos = Object.entries(v)
      // Nunca imprimir llaves: WhiteLabel guarda hottok, claves de Stripe, etc.
      .filter(([k, x]) => typeof x === 'string' && !/token|secret|key|hottok|pass|api|webhook|sid|auth/i.test(k) && !/hotmart/i.test(x) && x.length < 120)
      .map(([k, x]) => `${k}=${x}`);
    RE.lastIndex = 0;
    const otros = Object.entries(v).filter(([, x]) => typeof x === 'number').map(([k, x]) => `${k}=${x}`);
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && x.match(RE)) {
        for (const m of x.match(RE)) salida.push({ ruta: `${ruta}.${k}`, url: m, contexto: [...textos, ...otros].join(' · ') });
      } else enlaces(x, `${ruta}.${k}`, salida);
    }
  }
  return salida;
}

(async () => {
  const filas = [];
  const settings = await p.setting.findMany();
  for (const s of settings) enlaces(s.value, `Setting ${s.key}`, filas);
  const marcas = await p.whiteLabel.findMany();
  for (const w of marcas) enlaces(w, `Marca ${w.name || w.slug || w.id}`, filas);
  const vistos = new Set();
  for (const f of filas) {
    const linea = `${f.ruta}\n   ${f.url}${f.contexto ? `\n   ${f.contexto}` : ''}`;
    if (vistos.has(linea)) continue;
    vistos.add(linea);
    if (filtro && !linea.toLowerCase().includes(filtro)) continue;
    console.log(linea + '\n');
  }
  console.log(`${vistos.size} enlaces encontrados${filtro ? ` (mostrando los que contienen «${filtro}»)` : ''}.`);
})()
  .catch((e) => { console.error('ERROR:', e.message); process.exitCode = 1; })
  .finally(() => p.$disconnect());
