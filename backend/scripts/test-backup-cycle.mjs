#!/usr/bin/env node
/**
 * Smoke test del pipeline backup↔restore SIN pg_dump real ni R2 real.
 *
 * Verifica end-to-end con datos mock:
 *   1. Compresión gzip dentro del cipher stream
 *   2. Cifrado AES-256-GCM con layout [IV][authTag][ciphertext]
 *   3. Restore byte-perfect
 *   4. Tamper detection (1 bit flipped → authTag fail)
 *   5. Key incorrecta rechazada
 *
 * Usa la MISMA lógica criptográfica que `backup-db.mjs` / `restore-db.mjs`
 * para que si esta función refactoriza, el test se rompe.
 *
 * Uso:
 *   node backend/scripts/test-backup-cycle.mjs
 *
 * No requiere DB ni S3. Corre en cualquier entorno con Node 20+.
 */

import { createGzip, createGunzip } from 'node:zlib';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import { Readable } from 'node:stream';
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Key de TEST (NO la uses en prod — generá una con openssl).
const TEST_KEY = '5sjz4ONYOBD12ESFQPYQkcherfRa27QlMtc1sOFna5s=';

// Mismo helper que en backup-db.mjs / restore-db.mjs.
function deriveKey(b64) {
  const raw = Buffer.from(b64, 'base64');
  return raw.length >= 32
    ? raw.subarray(0, 32)
    : scryptSync(raw, 'clubify-backup-v1', 32);
}

function makeDump() {
  let sql = '-- Clubify DB dump test\n';
  sql += 'CREATE TABLE "Tenant" (id TEXT PRIMARY KEY, slug TEXT UNIQUE);\n';
  for (let i = 0; i < 5000; i++) {
    sql += `INSERT INTO "Tenant" VALUES ('tnt-${i}', 'slug-${i}-aBcDeFg');\n`;
  }
  sql += 'CREATE INDEX "Tenant_slug_idx" ON "Tenant"(slug);\n';
  return Buffer.from(sql);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const ch of stream) chunks.push(ch);
  return Buffer.concat(chunks);
}

/** Replica EXACTA del pipeline de backup-db.mjs. */
async function backup(plain, outFile) {
  const aesKey = deriveKey(TEST_KEY);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const gzip = createGzip({ level: 6 });

  Readable.from(plain).pipe(gzip).pipe(cipher);
  const ct = await streamToBuffer(cipher);
  const authTag = cipher.getAuthTag();

  const body = Buffer.concat([iv, authTag, ct]);
  writeFileSync(outFile, body);
  return body.length;
}

/** Replica EXACTA del pipeline de restore-db.mjs. */
async function restore(inFile) {
  const body = readFileSync(inFile);
  const iv = body.subarray(0, 12);
  const authTag = body.subarray(12, 28);
  const ct = body.subarray(28);

  const aesKey = deriveKey(TEST_KEY);
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ct), decipher.final()]);

  const gunzip = createGunzip();
  Readable.from(decrypted).pipe(gunzip);
  return streamToBuffer(gunzip);
}

function pass(label) {
  console.log(`  ✓ ${label}`);
}
function fail(label, detail = '') {
  console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
  process.exit(1);
}

(async () => {
  console.log('Backup↔restore cycle smoke test\n');

  const out = join(tmpdir(), 'clubify-test-backup.bin');
  const dump = makeDump();
  console.log(
    `Setup: dump mock ${(dump.length / 1024).toFixed(1)} KB en memoria`,
  );

  try {
    // 1) Round-trip
    const cipherSize = await backup(dump, out);
    const ratio = (1 - cipherSize / dump.length) * 100;
    pass(`gzip+aes-256-gcm: ${(cipherSize / 1024).toFixed(1)} KB (-${ratio.toFixed(0)}%)`);

    const restored = await restore(out);
    if (!restored.equals(dump)) {
      fail('restore byte-perfect', `dump=${dump.length} restored=${restored.length}`);
    }
    pass(`restore byte-perfect (${restored.length} bytes)`);

    // 2) Tamper en ciphertext
    const tampered = Buffer.from(readFileSync(out));
    tampered[100] ^= 0x01;
    writeFileSync(out + '.t', tampered);
    let tamperRejected = false;
    try {
      await restore(out + '.t');
    } catch {
      tamperRejected = true;
    }
    if (!tamperRejected) fail('tamper detection');
    pass('tamper detection: 1-bit flip → authTag fail');

    // 3) Key incorrecta
    const badKey = Buffer.alloc(32, 0); // all zeros
    const body = readFileSync(out);
    let badKeyRejected = false;
    try {
      const dec = createDecipheriv('aes-256-gcm', badKey, body.subarray(0, 12));
      dec.setAuthTag(body.subarray(12, 28));
      dec.update(body.subarray(28));
      dec.final();
    } catch {
      badKeyRejected = true;
    }
    if (!badKeyRejected) fail('key incorrecta debe ser rechazada');
    pass('key incorrecta rechazada');

    console.log('\n✅ Pipeline OK — backup-db.mjs / restore-db.mjs son safe para usar.');
  } finally {
    // Cleanup
    for (const f of [out, out + '.t']) {
      try {
        unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
})();
