/**
 * Comprueba EN VIVO, contra producción, lo que se desplegó estos días.
 *
 * Todo son peticiones de lectura sin sesión: lo que ve cualquiera. No escribe
 * en ninguna parte. Sirve para responder «¿esto quedó bien?» sin abrir el
 * panel y sin fiarse de la memoria.
 *
 * Cada prueba dice qué esperaba y qué recibió. Sale con código 1 si falla
 * alguna, para poder colgarlo de CI algún día.
 *
 * Uso:  node scripts/verificar-lo-desplegado.cjs
 */
const API = 'https://api.soyclubify.com';
const APP = 'https://app.soyclubify.com';

/**
 * Un pase de ALIANZA, para comprobar su JWT de Google.
 *
 * Se pasa por argumento a proposito. La primera version lo tenia a fuego, el
 * negocio borro ese pase, y la prueba empezo a dar rojo por un fallo suyo y no
 * del producto. Una prueba que grita sin motivo se acaba ignorando.
 *
 *   node scripts/verificar-lo-desplegado.cjs <passId de alianza>
 */
const PASE_ALIANZA = process.argv[2] || null;
/** Negocio con 4 sedes, para el menú por sede. */
const SLUG_SEDES = 'la-gloriosa';

const pruebas = [];
let ok = 0;
let mal = 0;

function prueba(nombre, fn) {
  pruebas.push({ nombre, fn });
}

/** Rompe la caché del borde: el menú se cachea 180 s y mentiría. */
function sinCache(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function texto(url) {
  const r = await fetch(sinCache(url), { cache: 'no-store' });
  return { estado: r.status, cuerpo: await r.text(), cabeceras: r.headers };
}

// ── El menú por sede: con la tabla vacía tiene que dar lo MISMO ────────
prueba('menú por sede · el mismo menú con sede y sin sede', async () => {
  const sin = await texto(`${API}/api/public/m/${SLUG_SEDES}/menu`);
  const con = await texto(
    `${API}/api/public/m/${SLUG_SEDES}/menu?sede=9511d531-d8c8-48f2-8b12-120da6769a35`,
  );
  if (sin.estado !== 200 || con.estado !== 200) {
    return `esperaba 200 y 200, recibí ${sin.estado} y ${con.estado}`;
  }
  const a = JSON.parse(sin.cuerpo);
  const b = JSON.parse(con.cuerpo);
  const cuenta = (m) =>
    (m.categories ?? []).reduce(
      (n, c) =>
        n +
        (c.products ?? []).length +
        (c.subsections ?? []).reduce((s, x) => s + (x.products ?? []).length, 0),
      0,
    );
  if (cuenta(a) !== cuenta(b)) {
    return `productos distintos: ${cuenta(a)} sin sede vs ${cuenta(b)} con sede`;
  }
  return null;
});

// ── La tarjeta de alianza: su JWT NO puede llevar el hero ──────────────
prueba('alianza · el JWT de Google no lleva el hero que daba 404', async () => {
  if (!PASE_ALIANZA) return 'SALTADA (pasa un passId de alianza como argumento)';
  const r = await texto(`${API}/api/passes/${PASE_ALIANZA}/google`);
  if (r.estado !== 200) return `esperaba 200, recibí ${r.estado}`;
  const { saveUrl } = JSON.parse(r.cuerpo);
  if (!saveUrl) return 'no vino saveUrl';
  const p = saveUrl.split('/save/')[1].split('.')[1];
  const payload = JSON.parse(
    Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
  ).payload;
  const mods = (payload.loyaltyObjects?.[0]?.imageModulesData ?? []).map(
    (m) => m.id,
  );
  if (mods.includes('hero')) return `lleva hero: [${mods.join(', ')}]`;
  if (!mods.includes('strip')) return `le falta el strip: [${mods.join(', ')}]`;
  return null;
});

prueba('alianza · el strip existe (200) y el hero no (404)', async () => {
  if (!PASE_ALIANZA) return 'SALTADA (pasa un passId de alianza como argumento)';
  const s = await fetch(`${API}/api/passes/${PASE_ALIANZA}/strip.png`);
  const h = await fetch(`${API}/api/passes/${PASE_ALIANZA}/hero.png`);
  if (s.status !== 200) return `strip.png dio ${s.status}, esperaba 200`;
  if (h.status !== 404) return `hero.png dio ${h.status}, esperaba 404`;
  return null;
});

// ── La impresión: solo puede quedar UN @page, el del ticket ────────────
prueba('impresión · el @page A4 del póster ya no pisa al del ticket', async () => {
  const html = (await texto(`${APP}/scan`)).cuerpo;
  const ruta = (html.match(/\/_next\/static\/css\/[a-z0-9]+\.css/) || [])[0];
  if (!ruta) return 'no encontré la hoja de estilos';
  const css = (await texto(`${APP}${ruta}`)).cuerpo;
  const reglas = css.match(/@page[^}]*}/g) || [];
  const a4 = reglas.filter((x) => /A4/i.test(x));
  if (a4.length) return `sigue habiendo un @page A4: ${a4.join(' ')}`;
  if (!reglas.some((x) => /80mm/.test(x))) {
    return `falta el @page del ticket: ${reglas.join(' ')}`;
  }
  return null;
});

// ── El teléfono de Sellea en su propia landing ────────────────────────
prueba('Sellea · la landing usa el teléfono nuevo', async () => {
  const html = (await texto('https://www.selleala.com/')).cuerpo;
  if (html.includes('17865832760')) return 'sigue el número viejo';
  if (!html.includes('13053107130')) return 'no aparece el número nuevo';
  return null;
});

// ── El dominio propio no puede enseñar la marca de la plataforma ──────
prueba('Birria León · su dominio no se comparte como Clubify', async () => {
  const r = await fetch('https://www.birrialeon.com/', { redirect: 'follow' });
  const html = await r.text();
  const og = (html.match(/<meta property="og:site_name" content="([^"]*)"/) ||
    [])[1];
  const url = (html.match(/<meta property="og:url" content="([^"]*)"/) || [])[1];
  if (og && /clubify/i.test(og)) return `og:site_name dice «${og}»`;
  if (url && /soyclubify/i.test(url)) return `og:url apunta a ${url}`;
  return null;
});

// ── Las rutas nuevas existen (401 = existe y pide sesión) ─────────────
prueba('difusión · la ruta de rotación existe', async () => {
  const r = await fetch(`${API}/api/admin/broadcasts/rotacion`);
  if (r.status === 404) return 'da 404: el código no está desplegado';
  if (r.status !== 401 && r.status !== 403) return `dio ${r.status}`;
  return null;
});

// ── El recorrido del cliente sigue en pie ─────────────────────────────
for (const [nombre, ruta] of [
  ['menú de mesa', '/m/demo-clubify'],
  ['menú de domicilios', '/d/demo-clubify'],
  ['login del escáner', '/scan'],
]) {
  prueba(`cliente · ${nombre}`, async () => {
    const r = await fetch(`${APP}${ruta}`);
    return r.status === 200 ? null : `dio ${r.status}`;
  });
}

(async () => {
  console.log('Comprobando lo desplegado, contra producción\n');
  for (const { nombre, fn } of pruebas) {
    let fallo;
    try {
      fallo = await fn();
    } catch (e) {
      fallo = `reventó: ${e.message}`;
    }
    if (fallo && String(fallo).startsWith('SALTADA')) {
      console.log(`  – ${nombre}`);
      console.log(`      ${fallo}`);
    } else if (fallo) {
      mal++;
      console.log(`  ✗ ${nombre}\n      ${fallo}`);
    } else {
      ok++;
      console.log(`  ✓ ${nombre}`);
    }
  }
  console.log(`\n  ${ok} bien · ${mal} mal`);
  process.exit(mal ? 1 : 0);
})();
