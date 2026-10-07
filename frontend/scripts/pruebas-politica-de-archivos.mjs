#!/usr/bin/env node
/**
 * Candado: la política de archivos del navegador
 * (`src/lib/politica-de-archivos.mjs`) y la del servidor
 * (`backend/src/media/politica-de-archivos.ts`) no pueden divergir.
 *
 *   node scripts/pruebas-politica-de-archivos.mjs
 *
 * Por qué: si el navegador deja pasar un banner de 9 MB que el servidor
 * rechaza, el negocio espera un minuto de subida para nada; si el navegador
 * rechaza lo que el servidor aceptaría, le cerramos una puerta sin motivo.
 *
 * Cómo: lee el bloque entre `// <politica:inicio>` y `// <politica:fin>` del
 * archivo del backend, le quita la sintaxis de TypeScript y lo evalúa. Cada
 * campo que el espejo declara tiene que valer lo mismo en el backend. Antes de
 * comparar, la prueba demuestra que SABE ponerse en rojo: compara una copia
 * alterada a propósito y exige que falle (un candado que no puede fallar no
 * protege nada).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as espejo from '../src/lib/politica-de-archivos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(AQUI, '..', '..', 'backend', 'src', 'media', 'politica-de-archivos.ts');

let fallos = 0;
const casos = [];
const prueba = (nombre, fn) => casos.push([nombre, fn]);
const afirmar = (c, d) => {
  if (!c) throw new Error(d);
};

function bloque(fuente, marca) {
  const a = fuente.indexOf(`// <${marca}:inicio>`);
  const b = fuente.indexOf(`// <${marca}:fin>`);
  if (a < 0 || b < 0 || b < a) throw new Error(`faltan las marcas <${marca}> en el backend`);
  return fuente.slice(a, b);
}

/** TypeScript del bloque → JavaScript evaluable. Solo lo que el bloque usa. */
function aJs(ts) {
  return ts
    .replace(/^export /gm, '')
    .replace(/:\s*FormatoDeImagen\[\]/g, '')
    .replace(/:\s*Record<string,\s*Uso>/g, '')
    .replace(/\s+as\s+const/g, '')
    .replace(/\s+as\s+number\[\]/g, '')
    .replace(/\}\s*satisfies\s+Record<Uso,\s*Politica>;/g, '};');
}

function leerBackend() {
  const fuente = readFileSync(BACKEND, 'utf8').replace(/\r\n/g, '\n');
  const pol = aJs(bloque(fuente, 'politica'));
  const car = aJs(bloque(fuente, 'carpetas'));
  // eslint-disable-next-line no-new-func
  return new Function('MB', 'KB', `${pol}\n${car}\nreturn { POLITICA, USO_POR_CARPETA };`)(
    1_000_000,
    1_000,
  );
}

/** Diferencias: cada campo del espejo contra el backend, y que estén los mismos usos. */
function diferencias(back, front) {
  const d = [];
  const usosB = Object.keys(back.POLITICA).sort();
  const usosF = Object.keys(front.POLITICA).sort();
  if (JSON.stringify(usosB) !== JSON.stringify(usosF)) {
    d.push(`usos distintos: backend ${usosB} / navegador ${usosF}`);
  }
  for (const uso of usosF) {
    const b = back.POLITICA[uso];
    if (!b) continue;
    for (const [campo, v] of Object.entries(front.POLITICA[uso])) {
      if (JSON.stringify(v) !== JSON.stringify(b[campo])) {
        d.push(`${uso}.${campo}: backend ${JSON.stringify(b[campo])} / navegador ${JSON.stringify(v)}`);
      }
    }
  }
  if (JSON.stringify(back.USO_POR_CARPETA) !== JSON.stringify(front.USO_POR_CARPETA)) {
    d.push('USO_POR_CARPETA distinto');
  }
  return d;
}

const back = leerBackend();

prueba('el candado sabe ponerse en rojo (copia alterada)', () => {
  const alterada = JSON.parse(JSON.stringify({ POLITICA: espejo.POLITICA, USO_POR_CARPETA: espejo.USO_POR_CARPETA }));
  alterada.POLITICA.BANNER.maxBytesOriginal += 1;
  const d1 = diferencias(back, alterada);
  afirmar(d1.some((x) => x.startsWith('BANNER.maxBytesOriginal')), 'no detectó un byte de diferencia');
  delete alterada.POLITICA.ICONO;
  afirmar(diferencias(back, alterada).some((x) => x.startsWith('usos distintos')), 'no detectó un uso de menos');
  alterada.USO_POR_CARPETA.logos = 'PRODUCTO';
  afirmar(diferencias(back, alterada).includes('USO_POR_CARPETA distinto'), 'no detectó una carpeta cambiada');
});

prueba('navegador y servidor dicen lo mismo', () => {
  const d = diferencias(back, { POLITICA: espejo.POLITICA, USO_POR_CARPETA: espejo.USO_POR_CARPETA });
  afirmar(d.length === 0, `divergen:\n    ${d.join('\n    ')}`);
});

prueba('el espejo trae lo que necesita el navegador', () => {
  for (const [uso, p] of Object.entries(espejo.POLITICA)) {
    if (p.tipo === 'imagen') {
      for (const c of ['etiqueta', 'maxBytesOriginal', 'formatos', 'ladoMaximoOriginal', 'maxMegapixeles', 'recortaEnNavegador', 'archivosPorLote']) {
        afirmar(c in p, `${uso} sin ${c}`);
      }
    }
  }
});

prueba('mensaje exacto del peso (el mismo texto del servidor)', () => {
  const m = espejo.validarArchivo({ size: 9_200_000, type: 'image/jpeg', name: 'banner.jpg' }, 'BANNER');
  afirmar(
    m === 'Esta imagen pesa 9,2 MB. El máximo permitido para banners es 8 MB. Reduce su tamaño o selecciona otra imagen.',
    m,
  );
  afirmar(espejo.validarArchivo({ size: 8_000_000, type: 'image/jpeg', name: 'b.jpg' }, 'BANNER') === null, 'el límite exacto debe pasar');
  afirmar(espejo.validarArchivo({ size: 8_000_001, type: 'image/jpeg', name: 'b.jpg' }, 'BANNER') !== null, '1 byte por encima debe fallar');
});

prueba('HEIC y formatos fuera de la política', () => {
  afirmar(/HEIC/.test(espejo.validarArchivo({ size: 10, type: 'image/heic', name: 'IMG_1.HEIC' }, 'PRODUCTO')), 'HEIC');
  afirmar(/Formato no admitido/.test(espejo.validarArchivo({ size: 10, type: 'image/gif', name: 'a.gif' }, 'BANNER')), 'GIF en banner');
  afirmar(espejo.validarArchivo({ size: 10, type: 'image/gif', name: 'a.gif' }, 'PRODUCTO') === null, 'GIF en producto');
});

prueba('el recorte de producto se valida tras recortar', () => {
  const grande = { size: 12 * espejo.MB, type: 'image/jpeg', name: 'f.jpg' };
  afirmar(espejo.validarArchivo(grande, 'PRODUCTO') === null, 'antes de recortar no se bloquea');
  afirmar(espejo.validarArchivo(grande, 'PRODUCTO', { trasRecortar: true }) !== null, 'tras recortar sí');
});

prueba('ayuda junto al campo y `accept`', () => {
  afirmar(espejo.textoDeAyuda('BANNER') === 'JPG, PNG, WebP o AVIF · máx. 8 MB', espejo.textoDeAyuda('BANNER'));
  afirmar(espejo.aceptarDe('PDF_MENU') === 'application/pdf', 'pdf');
  afirmar(!espejo.aceptarDe('LOGO').includes('gif'), 'logo sin gif');
});

prueba('miniaturas guardadas solo para URLs de la política nueva', () => {
  const nueva = 'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/t/menu-book/0123456789abcdef0123.webp';
  afirmar(espejo.miniaturaGuardada(nueva, 160) === nueva.replace('.webp', '.w160.webp'), 'nueva');
  const vieja = 'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/t/menu-book/eIhKf5iHJ-IC5COd.jpeg';
  afirmar(espejo.miniaturaGuardada(vieja, 160) === null, 'vieja no tiene miniatura');
  afirmar(espejo.miniaturaGuardada(nueva, 120) === null, 'solo 80/160');
});

for (const [nombre, fn] of casos) {
  try {
    fn();
    console.log(`  ok  ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA  ${nombre}\n    ${e.message}`);
  }
}
console.log(fallos ? `\n${fallos} FALLO(S)` : `\nTODO VERDE — ${casos.length} casos`);
process.exit(fallos ? 1 : 0);
