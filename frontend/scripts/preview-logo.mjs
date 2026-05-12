#!/usr/bin/env node
// Simula los dos variants del componente Logo (Logo.tsx) renderizando
// clubify-logo.png exactamente como lo hace el browser:
//
//   variant="mark" → container size×size, bg-image scaled 320% auto,
//                    position '15% center' → visible window source x:10.3-41.6%
//   variant="full" → <Image width={size*3.4} height={size}> → stretch fill
//
// Sirve para verificar el lockup antes de deploy sin levantar Next.js.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const backendRequire = createRequire(resolve(root, '..', 'backend', 'package.json'));
const sharp = backendRequire('sharp');

const LOCKUP = await readFile(resolve(root, 'public', 'clubify-logo.png'));
const MARK = await readFile(resolve(root, 'public', 'icons', 'icon-256.png'));
const lockupMeta = await sharp(LOCKUP).metadata();
const markMeta = await sharp(MARK).metadata();
console.log(`lockup: ${lockupMeta.width}×${lockupMeta.height}`);
console.log(`mark:   ${markMeta.width}×${markMeta.height}`);

async function renderMark(size) {
  return sharp(MARK).resize(size, size, { fit: 'fill' }).png().toBuffer();
}

async function renderFull(size) {
  const ratio = 3.4;
  const targetW = Math.round(size * ratio);
  return sharp(LOCKUP).resize(targetW, size, { fit: 'fill' }).png().toBuffer();
}

for (const size of [32, 42, 64, 96]) {
  const mark = await renderMark(size);
  const full = await renderFull(size);
  // Upscale 4x for inspection
  await sharp(mark).resize(size * 4, size * 4, { kernel: 'nearest' }).toFile(`/tmp/logo-mark-${size}.png`);
  await sharp(full).resize(Math.round(size * 3.4 * 4), size * 4, { kernel: 'nearest' }).toFile(`/tmp/logo-full-${size}.png`);
  console.log(`✓ /tmp/logo-mark-${size}.png  (rendered ${size}×${size}, upscaled 4×)`);
  console.log(`✓ /tmp/logo-full-${size}.png  (rendered ${Math.round(size * 3.4)}×${size}, upscaled 4×)`);
}
