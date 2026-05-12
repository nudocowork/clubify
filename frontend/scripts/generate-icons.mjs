#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const publicDir = resolve(projectRoot, 'public');
const iconsDir = resolve(publicDir, 'icons');

const localSharpRequire = createRequire(import.meta.url);
let sharp;
try {
  sharp = localSharpRequire('sharp');
} catch {
  const backendSharp = resolve(projectRoot, '..', 'backend', 'node_modules', 'sharp');
  if (!existsSync(backendSharp)) {
    console.error('sharp no encontrado en frontend ni backend. Instala con: npm i sharp');
    process.exit(1);
  }
  const backendRequire = createRequire(resolve(projectRoot, '..', 'backend', 'package.json'));
  sharp = backendRequire('sharp');
}

const iconSvg = await readFile(resolve(iconsDir, 'icon.svg'));
const maskableSvg = await readFile(resolve(iconsDir, 'icon-maskable.svg'));
const ogSvg = await readFile(resolve(iconsDir, 'og-image.svg'));
const lockupSvg = await readFile(resolve(publicDir, 'clubify-logo.svg'));

async function rasterize(svgBuffer, size, outPath) {
  await sharp(svgBuffer, { density: 384 })
    .resize(size, size, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
  console.log(`  ✓ ${outPath.replace(projectRoot + '/', '')}`);
}

async function rasterizeRect(svgBuffer, w, h, outPath) {
  await sharp(svgBuffer, { density: 384 })
    .resize(w, h, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath);
  console.log(`  ✓ ${outPath.replace(projectRoot + '/', '')}`);
}

console.log('→ Generando favicons principales');
await rasterize(iconSvg, 16, resolve(publicDir, 'favicon-16.png'));
await rasterize(iconSvg, 32, resolve(publicDir, 'favicon-32.png'));
await rasterize(iconSvg, 48, resolve(publicDir, 'favicon-48.png'));
await rasterize(iconSvg, 64, resolve(publicDir, 'favicon.png'));
await rasterize(iconSvg, 96, resolve(publicDir, 'favicon-96.png'));

console.log('→ Generando Apple touch icon');
await rasterize(iconSvg, 180, resolve(publicDir, 'apple-touch-icon.png'));

console.log('→ Generando Android / PWA icons');
await rasterize(iconSvg, 192, resolve(iconsDir, 'icon-192.png'));
await rasterize(iconSvg, 256, resolve(iconsDir, 'icon-256.png'));
await rasterize(iconSvg, 384, resolve(iconsDir, 'icon-384.png'));
await rasterize(iconSvg, 512, resolve(iconsDir, 'icon-512.png'));

console.log('→ Generando maskable icons (PWA Android adaptive)');
await rasterize(maskableSvg, 192, resolve(iconsDir, 'icon-maskable-192.png'));
await rasterize(maskableSvg, 512, resolve(iconsDir, 'icon-maskable-512.png'));

console.log('→ Generando Open Graph image (1200x630)');
await rasterizeRect(ogSvg, 1200, 630, resolve(publicDir, 'og-image.png'));

console.log('→ Generando logo lockup (clubify-logo.png 1224×360, ratio 3.4:1)');
await rasterizeRect(lockupSvg, 1224, 360, resolve(publicDir, 'clubify-logo.png'));

console.log('→ Generando favicon.ico (16+32+48 multi-resolution)');
const ico16 = await sharp(iconSvg, { density: 384 }).resize(16, 16).png().toBuffer();
const ico32 = await sharp(iconSvg, { density: 384 }).resize(32, 32).png().toBuffer();
const ico48 = await sharp(iconSvg, { density: 384 }).resize(48, 48).png().toBuffer();
const icoBuffer = buildIco([
  { size: 16, png: ico16 },
  { size: 32, png: ico32 },
  { size: 48, png: ico48 },
]);
await writeFile(resolve(publicDir, 'favicon.ico'), icoBuffer);
console.log(`  ✓ public/favicon.ico (${icoBuffer.length} bytes)`);

console.log('\n✅ Iconos generados correctamente');

// Construye un ICO con N entries PNG. Cada entry usa el formato Vista+
// que permite PNG embebido (en vez de DIB), lo cual mantiene el archivo
// pequeño y soporta transparencia/alpha correctamente.
function buildIco(entries) {
  const HEADER = 6;
  const DIR_ENTRY = 16;
  const count = entries.length;
  const dirSize = HEADER + DIR_ENTRY * count;
  let totalImageSize = 0;
  for (const e of entries) totalImageSize += e.png.length;
  const buf = Buffer.alloc(dirSize + totalImageSize);

  // ICONDIR header
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type = 1 (ICO)
  buf.writeUInt16LE(count, 4);

  let imageOffset = dirSize;
  for (let i = 0; i < count; i++) {
    const e = entries[i];
    const entryOffset = HEADER + i * DIR_ENTRY;
    buf.writeUInt8(e.size === 256 ? 0 : e.size, entryOffset + 0); // width
    buf.writeUInt8(e.size === 256 ? 0 : e.size, entryOffset + 1); // height
    buf.writeUInt8(0, entryOffset + 2); // color palette
    buf.writeUInt8(0, entryOffset + 3); // reserved
    buf.writeUInt16LE(1, entryOffset + 4); // color planes
    buf.writeUInt16LE(32, entryOffset + 6); // bits per pixel
    buf.writeUInt32LE(e.png.length, entryOffset + 8); // image size
    buf.writeUInt32LE(imageOffset, entryOffset + 12); // image offset
    e.png.copy(buf, imageOffset);
    imageOffset += e.png.length;
  }
  return buf;
}
