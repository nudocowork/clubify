// Carga creds Cross en paymentConfig.cross de una marca, CIFRANDO apiKey/
// webhookSecret (secret-box) SIN cambiar paymentGateway ni otras claves.
// Lee las creds de un JSON externo (CROSS_CRED_FILE) — NUNCA del repo.
// Dry-run por default; APPLY=1 para escribir. Correr bajo el servicio backend.
//   CROSS_CRED_FILE=/abs/creds.json BRAND=clubify [APPLY=1] \
//     railway run --service backend node scripts/_load-cross-creds.cjs
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');

const PREFIX = 'enc:v1:';
function encryptSecret(plain) {
  const key = Buffer.from(process.env.SECRETS_ENC_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('SECRETS_ENC_KEY inválida');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + iv.toString('base64') + ':' + tag.toString('base64') + ':' + ct.toString('base64');
}
const mask = (v) => (v ? `set(len=${String(v).length})` : 'NULL');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const APPLY = process.env.APPLY === '1';
  const brandKey = (process.env.BRAND || 'clubify').toLowerCase();

  const credFile = process.env.CROSS_CRED_FILE;
  if (!credFile || !fs.existsSync(credFile)) {
    console.error('Falta CROSS_CRED_FILE (json con apiKey/companyId/[webhookSecret]/environment)');
    process.exit(1);
  }
  const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  console.log('Creds leídas:', {
    apiKey: mask(creds.apiKey), companyId: creds.companyId ? 'set' : 'NULL',
    webhookSecret: mask(creds.webhookSecret), environment: creds.environment || 'sandbox',
  });
  if (!creds.apiKey || !creds.companyId) { console.error('apiKey y companyId obligatorios'); process.exit(1); }

  // Buscar marca (por slug o nombre). Clubify = marca plataforma.
  const wl = await prisma.$queryRawUnsafe(
    `SELECT id, name, slug, "paymentGateway", "paymentConfig" FROM "WhiteLabel"
     WHERE lower(slug)=$1 OR lower(name)=$1 ORDER BY "createdAt" ASC LIMIT 1`,
    brandKey,
  ).then((r) => r[0]);
  if (!wl) { console.error(`No se encontró marca '${brandKey}'`); process.exit(1); }
  console.log('Marca:', { id: wl.id, name: wl.name, slug: wl.slug, gateway: wl.paymentGateway });

  const cfg = (wl.paymentConfig && typeof wl.paymentConfig === 'object') ? wl.paymentConfig : {};
  const crossSlot = {
    ...(cfg.cross && typeof cfg.cross === 'object' ? cfg.cross : {}),
    apiKey: encryptSecret(creds.apiKey),
    companyId: String(creds.companyId),
    environment: creds.environment || 'sandbox',
    ...(creds.companyName ? { companyName: String(creds.companyName) } : {}),
    ...(creds.paymentMethod ? { paymentMethod: String(creds.paymentMethod) } : {}),
    ...(creds.webhookSecret ? { webhookSecret: encryptSecret(creds.webhookSecret) } : {}),
  };
  const merged = { ...cfg, cross: crossSlot };

  console.log('\nNuevo paymentConfig.cross (cifrado):', {
    apiKey: mask(crossSlot.apiKey), companyId: crossSlot.companyId,
    environment: crossSlot.environment, webhookSecret: mask(crossSlot.webhookSecret),
  });
  console.log('paymentGateway se mantiene:', wl.paymentGateway, '(NO se cambia)');

  if (!APPLY) {
    console.log('\n[DRY-RUN] APPLY=1 para escribir.');
    await prisma.$disconnect();
    return;
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "WhiteLabel" SET "paymentConfig"=$1::jsonb WHERE id=$2`,
    JSON.stringify(merged), wl.id,
  );
  console.log('\n✅ Escrito. paymentConfig.cross configurado (gateway sin cambios).');

  // Plan CROSS de prueba ($1) para que el checkout resuelva el monto.
  if (process.env.LINK_AMOUNT) {
    const amt = Number(process.env.LINK_AMOUNT);
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM "WhiteLabelPaymentLink" WHERE "whiteLabelId"=$1 AND gateway='CROSS' LIMIT 1`,
      wl.id,
    );
    if (existing.length) {
      await prisma.$executeRawUnsafe(
        `UPDATE "WhiteLabelPaymentLink" SET "amountUsd"=$1, active=true, "updatedAt"=NOW() WHERE id=$2`,
        amt, existing[0].id,
      );
      console.log(`✅ Plan CROSS actualizado a $${amt}.`);
    } else {
      const { randomUUID } = require('crypto');
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WhiteLabelPaymentLink" (id,"whiteLabelId",gateway,name,periodicity,"amountUsd",active,"sortOrder","createdAt","updatedAt")
         VALUES ($1,$2,'CROSS','Prueba Cross','MENSUAL',$3,true,0,NOW(),NOW())`,
        randomUUID(), wl.id, amt,
      );
      console.log(`✅ Plan CROSS creado ($${amt}).`);
    }
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
