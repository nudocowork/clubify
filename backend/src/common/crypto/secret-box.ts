/**
 * Cifrado simétrico de secretos en reposo (AES-256-GCM).
 *
 * Uso: API keys / secrets de las pasarelas de pago por marca blanca
 * (Hotmart, Stripe). Se guardan CIFRADOS en `WhiteLabel.paymentConfig` y solo
 * se descifran en el servidor cuando hay que usarlos (firmar/llamar a la
 * pasarela). Al frontend SIEMPRE se devuelven enmascarados — nunca el plano
 * ni el ciphertext.
 *
 * Formato del texto cifrado: `enc:v1:<iv b64>:<tag b64>:<ciphertext b64>`
 * El prefijo permite detectar si un valor ya está cifrado (idempotencia) y
 * versionar el esquema a futuro.
 *
 * Clave: env `SECRETS_ENC_KEY` = 32 bytes en base64 (256 bits). Generar con:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Sin la env, encrypt/decrypt lanzan — es intencional: no queremos guardar
 * secretos de pago "a medias" ni operar con una clave faltante.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1:';
const IV_BYTES = 12; // recomendado para GCM
const KEY_BYTES = 32; // AES-256

function loadKey(): Buffer {
  const raw = process.env.SECRETS_ENC_KEY;
  if (!raw) {
    throw new Error(
      'SECRETS_ENC_KEY no está configurada. Generá una con ' +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"` ' +
        'y seteala en el entorno antes de guardar/leer secretos de pago.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRETS_ENC_KEY inválida: se esperaban ${KEY_BYTES} bytes (base64), ` +
        `se obtuvieron ${key.length}.`,
    );
  }
  return key;
}

/** True si el valor ya está en formato cifrado (enc:v1:...). */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Cifra un secreto en texto plano. Si ya viene cifrado, lo devuelve tal cual
 * (idempotente) — útil cuando el frontend reenvía el valor enmascarado/sin
 * cambios y no queremos re-cifrar.
 */
export function encryptSecret(plain: string): string {
  if (isEncrypted(plain)) return plain;
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    iv.toString('base64') +
    ':' +
    tag.toString('base64') +
    ':' +
    ct.toString('base64')
  );
}

/**
 * Descifra un secreto. Si el valor NO está cifrado (legado en plano), lo
 * devuelve tal cual — tolera datos previos a la migración a cifrado.
 */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value;
  const key = loadKey();
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Secreto cifrado con formato inválido.');
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Enmascara un secreto para mostrarlo en la UI: `sk_live_••••1234`.
 * Acepta el valor en plano o cifrado (descifra primero). Para valores cortos
 * (≤8) enmascara todo. Nunca expone el medio del secreto.
 */
export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  let plain: string;
  try {
    plain = decryptSecret(value);
  } catch {
    // Si no se puede descifrar (clave rotada/corrupto), no filtramos nada.
    return '••••';
  }
  if (plain.length <= 8) return '•'.repeat(plain.length);
  return `${plain.slice(0, 7)}${'•'.repeat(4)}${plain.slice(-4)}`;
}
