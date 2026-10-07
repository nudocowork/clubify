#!/usr/bin/env node
/**
 * Pruebas de las imágenes del InfoLink público (ver
 * `src/lib/infolink/imagen-del-infolink.mjs`).
 *
 *   node scripts/pruebas-imagenes-del-infolink.mjs
 *
 * Cuida dos cosas: que lo del bucket pase por el optimizador con un ancho que
 * acepta (otro responde 400 y la imagen sale en blanco), y que lo que no se
 * puede optimizar (Unsplash, data:, SVG) siga saliendo crudo. Y que los
 * componentes no vuelvan a pintar la URL cruda.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AVISO_DEL_INFOLINK,
  fondoDelInfolink,
  historiaDelInfolink,
  iconoDelInfolink,
  imagenDelInfolink,
  logoDelInfolink,
  miniaturaDelInfolink,
} from '../src/lib/infolink/imagen-del-infolink.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const leer = (r) => readFileSync(resolve(AQUI, '..', r), 'utf8').replace(/\r\n/g, '\n');

const BUCKET = 'https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/t/logos/9cmTKI0isUcFUew3.png';
const UNSPLASH = 'https://images.unsplash.com/photo-1437418747212-8d9709afab22?w=1200';
// deviceSizes + imageSizes por defecto de Next.
const PERMITIDOS = new Set([16, 32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]);

let fallos = 0;
const casos = [];
const prueba = (n, f) => casos.push([n, f]);
const afirmar = (c, d) => {
  if (!c) throw new Error(d);
};
const ancho = (u) => Number(new URL(u, 'https://x').searchParams.get('w'));

prueba('logo, galería, historia e icono: por el optimizador con anchos válidos', () => {
  for (const [nombre, u] of [
    ['logo', logoDelInfolink(BUCKET)],
    ['galería', miniaturaDelInfolink(BUCKET)],
    ['historia', historiaDelInfolink(BUCKET)],
    ['icono', iconoDelInfolink(BUCKET)],
  ]) {
    afirmar(u.startsWith('/_next/image?url='), `${nombre}: ${u}`);
    afirmar(PERMITIDOS.has(ancho(u)), `${nombre}: ancho ${ancho(u)} no permitido`);
  }
  afirmar(ancho(logoDelInfolink(BUCKET)) === 384, 'logo a 384');
});

prueba('lo que no se puede optimizar sale crudo (nunca en blanco)', () => {
  afirmar(logoDelInfolink(UNSPLASH) === UNSPLASH, 'unsplash');
  afirmar(logoDelInfolink('data:image/png;base64,AAAA') === 'data:image/png;base64,AAAA', 'data:');
  afirmar(iconoDelInfolink('https://pub-6de3a37544604346a69b9836aed1c6cf.r2.dev/a.svg').endsWith('.svg'), 'svg');
  afirmar(fondoDelInfolink(UNSPLASH) === `url("${UNSPLASH}")`, fondoDelInfolink(UNSPLASH));
  afirmar(logoDelInfolink(null) === '', 'null');
});

prueba('aviso con srcset y fondo con un solo ancho', () => {
  const a = imagenDelInfolink(BUCKET, AVISO_DEL_INFOLINK);
  afirmar(a.srcSet && a.sizes, 'aviso sin srcset');
  const f = fondoDelInfolink(BUCKET);
  afirmar(f.startsWith('url("/_next/image?url=') && f.includes('w=828'), f);
});

prueba('los componentes del InfoLink ya no pintan la URL cruda', () => {
  const shells = leer('src/components/info-link-shells.tsx');
  afirmar(!/src=\{tenant\.logoUrl\}/.test(shells), 'logo crudo en info-link-shells');
  afirmar(!/backgroundImage: `url\(\$\{url\}\)`/.test(shells), 'galería/historias crudas');
  afirmar(!/src=\{popup\.imageUrl\}/.test(leer('src/components/info-link-global-popup.tsx')), 'aviso global crudo');
  afirmar(!/src=\{popup\.imageUrl\}/.test(leer('src/components/InfoLinkPopupModal.tsx')), 'aviso de botón crudo');
  afirmar(!/src=\{b\.customIconUrl\}/.test(leer('src/components/info-link-button-style.tsx')), 'icono crudo');
  afirmar(leer('src/lib/info-link-banner.ts').includes('fondoDelInfolink(imageUrl)'), 'banner crudo');
  afirmar(leer('src/lib/info-link-extras.ts').includes('fondoDelInfolink(bg.imageUrl)'), 'fondo crudo');
});

for (const [n, f] of casos) {
  try {
    f();
    console.log(`  ok  ${n}`);
  } catch (e) {
    fallos++;
    console.log(`  FALLA  ${n}\n    ${e.message}`);
  }
}
console.log(fallos ? `\n${fallos} FALLO(S)` : `\nTODO VERDE — ${casos.length} casos`);
process.exit(fallos ? 1 : 0);
