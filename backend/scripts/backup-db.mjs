#!/usr/bin/env node
/**
 * Backup encriptado de la DB a R2 (S3-compatible).
 *
 * Pipeline:
 *   pg_dump $DATABASE_URL → gzip → AES-256-GCM → PUT R2
 *                                         ↓
 *                              backups/YYYY-MM-DDTHH-MM.sql.gz.enc
 *
 * Después de subir, borra backups con `createdAt` viejo (retention 30d
 * por default, configurable con BACKUP_RETENTION_DAYS).
 *
 * Env requeridas:
 *   DATABASE_URL                Postgres connection string (prod).
 *   S3_ENDPOINT / S3_BUCKET     R2 bucket donde se guardan los backups.
 *   S3_ACCESS_KEY / S3_SECRET_KEY
 *   BACKUP_ENCRYPTION_KEY       Base64 de 32 bytes (openssl rand -base64 32).
 *
 * Env opcionales:
 *   BACKUP_PREFIX               Prefijo dentro del bucket (default: backups/).
 *   BACKUP_RETENTION_DAYS       Días a retener (default: 30).
 *
 * Uso local:
 *   node backend/scripts/backup-db.mjs
 *
 * Uso CI: ver .github/workflows/backup.yml
 */

import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import {
  createCipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const required = [
  'DATABASE_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'BACKUP_ENCRYPTION_KEY',
];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`[backup] ❌ Falta env var: ${k}`);
    process.exit(1);
  }
}

const PREFIX = (process.env.BACKUP_PREFIX ?? 'backups/').replace(/\/+$/, '/');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
});

const BUCKET = process.env.S3_BUCKET;

// Derivación de la key con scrypt (consistente con restore-db.mjs).
// El BACKUP_ENCRYPTION_KEY es base64 — lo decodificamos a 32 bytes raw.
function deriveKey() {
  const raw = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, 'base64');
  if (raw.length < 32) {
    // Si el key es corto, estiramos con scrypt. Usamos un salt fijo
    // (no hace falta secreto — el secreto está en el key mismo).
    return scryptSync(raw, 'clubify-backup-v1', 32);
  }
  return raw.slice(0, 32);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16); // 2026-05-12T03-15
}

async function backup() {
  const stamp = timestamp();
  const key = `${PREFIX}${stamp}.sql.gz.enc`;
  const aesKey = deriveKey();
  const iv = randomBytes(12); // GCM standard
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  const gzip = createGzip({ level: 6 });

  // pg_dump → gzip → cipher
  const dump = spawn('pg_dump', ['--format=plain', '--no-owner', '--no-privileges', process.env.DATABASE_URL], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  dump.stdout.pipe(gzip).pipe(cipher);

  // Collectamos chunks cifrados a buffer. Para DBs >500MB esto saturaría RAM —
  // en ese caso convendría usar multipart upload streaming. Por ahora,
  // simplicidad > optimización.
  const chunks = [];
  for await (const chunk of cipher) chunks.push(chunk);
  const ciphertext = Buffer.concat(chunks);
  const authTag = cipher.getAuthTag();

  await new Promise((resolve, reject) => {
    dump.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exit ${code}`));
    });
  });

  // Format final: [12-byte IV][16-byte auth tag][ciphertext]
  const body = Buffer.concat([iv, authTag, ciphertext]);

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/octet-stream',
      ServerSideEncryption: undefined, // ya cifrado client-side
      Metadata: {
        'clubify-backup-version': '1',
        'clubify-backup-timestamp': stamp,
      },
    }),
  );

  console.log(
    `[backup] ✓ ${key} (${(body.length / 1024 / 1024).toFixed(2)} MB)`,
  );
  return { key, size: body.length };
}

async function pruneOld() {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  let token;
  const toDelete = [];

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.LastModified || !obj.Key) continue;
      if (obj.LastModified.getTime() < cutoff) {
        toDelete.push({ Key: obj.Key });
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  if (toDelete.length === 0) {
    console.log(`[backup] 0 backups viejos (cutoff ${RETENTION_DAYS}d)`);
    return;
  }

  // Batch delete max 1000 por llamada.
  const batches = [];
  for (let i = 0; i < toDelete.length; i += 1000) {
    batches.push(toDelete.slice(i, i + 1000));
  }
  for (const batch of batches) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: batch },
      }),
    );
  }
  console.log(`[backup] ✓ Borrados ${toDelete.length} backups >${RETENTION_DAYS}d`);
}

(async () => {
  try {
    await backup();
    await pruneOld();
    process.exit(0);
  } catch (e) {
    console.error(`[backup] ❌ ${e?.stack ?? e?.message ?? e}`);
    process.exit(1);
  }
})();
