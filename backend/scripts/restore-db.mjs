#!/usr/bin/env node
/**
 * Restore desde un backup en R2.
 *
 * IMPORTANTE: este script es DESTRUCTIVO — corre `psql` sobre la DB target
 * y dropea/recrea tablas según el dump. Probalo PRIMERO contra una DB
 * staging antes de tocar prod.
 *
 * Flow:
 *   GET R2 backup → descifrar AES-256-GCM → gunzip → psql $TARGET_DATABASE_URL
 *
 * Env requeridas:
 *   TARGET_DATABASE_URL    Postgres connection string DONDE restaurar (NO la
 *                          de prod por accidente — usá staging).
 *   S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY
 *   BACKUP_ENCRYPTION_KEY  Mismo key que se usó en backup-db.mjs.
 *
 * Uso:
 *   node backend/scripts/restore-db.mjs backups/2026-05-12T03-15.sql.gz.enc
 *   node backend/scripts/restore-db.mjs --latest
 */

import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const required = [
  'TARGET_DATABASE_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'BACKUP_ENCRYPTION_KEY',
];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`[restore] ❌ Falta env var: ${k}`);
    process.exit(1);
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('[restore] Uso: node restore-db.mjs <key>  o  --latest');
  process.exit(1);
}

const PREFIX = (process.env.BACKUP_PREFIX ?? 'backups/').replace(/\/+$/, '/');
const BUCKET = process.env.S3_BUCKET;

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
});

function deriveKey() {
  const raw = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, 'base64');
  if (raw.length < 32) {
    return scryptSync(raw, 'clubify-backup-v1', 32);
  }
  return raw.slice(0, 32);
}

async function findLatest() {
  let token;
  let newest = null;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key) continue;
      if (!newest || (obj.LastModified ?? new Date(0)) > newest.LastModified) {
        newest = { Key: obj.Key, LastModified: obj.LastModified ?? new Date(0) };
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  if (!newest) throw new Error('No hay backups en el bucket.');
  return newest.Key;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function restore() {
  const key = arg === '--latest' ? await findLatest() : arg;
  console.log(`[restore] Pulling ${key} from ${BUCKET}…`);

  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await streamToBuffer(obj.Body);

  // Layout: [12-byte IV][16-byte auth tag][ciphertext]
  const iv = body.subarray(0, 12);
  const authTag = body.subarray(12, 28);
  const ciphertext = body.subarray(28);

  const aesKey = deriveKey();
  const decipher = createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const gunzip = createGunzip();

  const psql = spawn('psql', [process.env.TARGET_DATABASE_URL], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });

  Readable.from(decrypted).pipe(gunzip).pipe(psql.stdin);

  await new Promise((resolve, reject) => {
    psql.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exit ${code}`));
    });
  });

  console.log(`[restore] ✓ Restored ${key} → ${maskUrl(process.env.TARGET_DATABASE_URL)}`);
}

function maskUrl(u) {
  return u.replace(/:[^:@/]+@/, ':***@');
}

(async () => {
  try {
    await restore();
    process.exit(0);
  } catch (e) {
    console.error(`[restore] ❌ ${e?.stack ?? e?.message ?? e}`);
    process.exit(1);
  }
})();
