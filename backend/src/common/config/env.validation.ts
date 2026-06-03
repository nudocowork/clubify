/**
 * Validación estricta de variables de entorno al boot.
 *
 * - En producción (NODE_ENV=production) faltar un secret = el proceso NO arranca.
 *   Esto evita el bug histórico donde un deploy quedaba firmando JWT con
 *   `'dev-secret'` porque la env var no se propagó.
 * - En desarrollo permite ausencias pero igual loguea warning.
 *
 * Cualquier nueva variable que sea "obligatoria-en-prod" debe agregarse aquí.
 */

export type AppEnv = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;

  DATABASE_URL: string;
  REDIS_URL: string | null;

  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_EXPIRES: string;
  JWT_REFRESH_EXPIRES: string;

  QR_HMAC_SECRET: string;

  APP_URL: string;
  API_URL: string | null;
  CORS_ROOT_DOMAIN: string | null;
  CORS_EXTRA_ORIGINS: string | null;

  S3_ENDPOINT: string | null;
  S3_BUCKET: string | null;
  S3_ACCESS_KEY: string | null;
  S3_SECRET_KEY: string | null;
  S3_REGION: string;
  S3_PUBLIC_URL: string | null;
  S3_FORCE_PATH_STYLE: boolean;

  GOOGLE_CLIENT_ID: string | null;

  APPLE_PASS_TYPE_ID: string | null;
  APPLE_TEAM_ID: string | null;
  APPLE_PASS_CERT_PATH: string | null;
  APPLE_PASS_CERT_PASSWORD: string | null;
  APPLE_WWDR_PATH: string | null;
  APNS_KEY_PATH: string | null;
  APNS_KEY_ID: string | null;
  APNS_TEAM_ID: string | null;

  GOOGLE_WALLET_ISSUER_ID: string | null;
  GOOGLE_WALLET_SA_JSON: string | null;
  GOOGLE_WALLET_SA_BASE64: string | null;

  SMTP_HOST: string | null;
  SMTP_PORT: number | null;
  SMTP_USER: string | null;
  SMTP_PASS: string | null;
  SMTP_FROM: string | null;
};

const MIN_SECRET_BYTES = 32;

function readString(
  raw: Record<string, unknown>,
  key: string,
): string | null {
  const v = raw[key];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function readBool(raw: Record<string, unknown>, key: string, def = false) {
  const v = readString(raw, key);
  if (v === null) return def;
  return /^(1|true|yes|on)$/i.test(v);
}

function readInt(
  raw: Record<string, unknown>,
  key: string,
  def: number | null,
): number | null {
  const v = readString(raw, key);
  if (v === null) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`[env] ${key} debe ser numérico, recibido: "${v}"`);
  }
  return n;
}

function assertSecret(name: string, value: string | null, isProd: boolean) {
  if (!value) {
    if (isProd) {
      throw new Error(
        `[env] ${name} es obligatorio en producción. Configura la var en el host (Railway/Vercel/etc).`,
      );
    }
    return null;
  }
  // base64/hex/base64url decodificado debe llegar a al menos 32 bytes de
  // entropía. Heurística simple: longitud mínima en caracteres.
  if (value.length < MIN_SECRET_BYTES) {
    throw new Error(
      `[env] ${name} es demasiado corto (${value.length} chars). ` +
        `Generá uno con: openssl rand -base64 48`,
    );
  }
  if (/^(dev-|test-|changeme|secret|password)/i.test(value)) {
    if (isProd) {
      throw new Error(
        `[env] ${name} parece un placeholder ("${value.slice(0, 12)}…"). ` +
          `Rotalo antes de levantar prod.`,
      );
    }
  }
  return value;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const nodeEnvRaw = (readString(raw, 'NODE_ENV') ?? 'development').toLowerCase();
  const NODE_ENV =
    nodeEnvRaw === 'production'
      ? 'production'
      : nodeEnvRaw === 'test'
        ? 'test'
        : 'development';
  const isProd = NODE_ENV === 'production';

  const DATABASE_URL = readString(raw, 'DATABASE_URL');
  if (!DATABASE_URL) {
    throw new Error('[env] DATABASE_URL es obligatorio.');
  }
  if (!/^postgres(ql)?:\/\//.test(DATABASE_URL)) {
    throw new Error(
      `[env] DATABASE_URL debe ser un connection string de Postgres (recibido: "${DATABASE_URL.slice(0, 24)}…")`,
    );
  }

  // En prod, advertir si DATABASE_URL no tiene connection pool dimensionado.
  // Prisma default (10) puede saturarse rápido en multi-tenant a escala.
  // Recomendado: `?connection_limit=20&pool_timeout=20` o usar PgBouncer.
  // No tiramos error — solo log, para no romper deploys nuevos.
  if (isProd) {
    const hasPoolHint =
      /[?&](connection_limit|pgbouncer|pool_timeout)=/.test(DATABASE_URL);
    if (!hasPoolHint) {
      // eslint-disable-next-line no-console
      console.warn(
        '[env] WARN: DATABASE_URL en prod no especifica connection pool. ' +
          'Agrega `?connection_limit=20&pool_timeout=20` o configura PgBouncer.',
      );
    }
  }

  // En dev permitimos valores razonables como fallback; en prod son strictos.
  const JWT_SECRET =
    assertSecret('JWT_SECRET', readString(raw, 'JWT_SECRET'), isProd) ??
    'dev-only-secret-do-not-use-in-prod-_______________';
  const JWT_REFRESH_SECRET =
    assertSecret(
      'JWT_REFRESH_SECRET',
      readString(raw, 'JWT_REFRESH_SECRET'),
      isProd,
    ) ?? 'dev-only-refresh-secret-do-not-use-in-prod-_______';
  const QR_HMAC_SECRET =
    assertSecret('QR_HMAC_SECRET', readString(raw, 'QR_HMAC_SECRET'), isProd) ??
    'dev-only-qr-secret-do-not-use-in-prod-_______________';

  // Una salvaguarda extra: en prod, los tres secrets NO deben coincidir.
  if (isProd) {
    const all = [JWT_SECRET, JWT_REFRESH_SECRET, QR_HMAC_SECRET];
    if (new Set(all).size !== all.length) {
      throw new Error(
        '[env] JWT_SECRET, JWT_REFRESH_SECRET y QR_HMAC_SECRET deben ser distintos en producción.',
      );
    }
  }

  return {
    NODE_ENV,
    PORT: readInt(raw, 'PORT', 3001) ?? 3001,

    DATABASE_URL,
    REDIS_URL: readString(raw, 'REDIS_URL'),

    JWT_SECRET,
    JWT_REFRESH_SECRET,
    JWT_EXPIRES: readString(raw, 'JWT_EXPIRES') ?? '15m',
    JWT_REFRESH_EXPIRES: readString(raw, 'JWT_REFRESH_EXPIRES') ?? '30d',

    QR_HMAC_SECRET,

    APP_URL: readString(raw, 'APP_URL') ?? 'http://localhost:3000',
    API_URL: readString(raw, 'API_URL'),
    CORS_ROOT_DOMAIN: readString(raw, 'CORS_ROOT_DOMAIN'),
    CORS_EXTRA_ORIGINS: readString(raw, 'CORS_EXTRA_ORIGINS'),

    S3_ENDPOINT: readString(raw, 'S3_ENDPOINT'),
    S3_BUCKET: readString(raw, 'S3_BUCKET'),
    S3_ACCESS_KEY: readString(raw, 'S3_ACCESS_KEY'),
    S3_SECRET_KEY: readString(raw, 'S3_SECRET_KEY'),
    S3_REGION: readString(raw, 'S3_REGION') ?? 'auto',
    S3_PUBLIC_URL: readString(raw, 'S3_PUBLIC_URL'),
    S3_FORCE_PATH_STYLE: readBool(raw, 'S3_FORCE_PATH_STYLE', true),

    GOOGLE_CLIENT_ID: readString(raw, 'GOOGLE_CLIENT_ID'),

    APPLE_PASS_TYPE_ID: readString(raw, 'APPLE_PASS_TYPE_ID'),
    APPLE_TEAM_ID: readString(raw, 'APPLE_TEAM_ID'),
    APPLE_PASS_CERT_PATH: readString(raw, 'APPLE_PASS_CERT_PATH'),
    APPLE_PASS_CERT_PASSWORD: readString(raw, 'APPLE_PASS_CERT_PASSWORD'),
    APPLE_WWDR_PATH: readString(raw, 'APPLE_WWDR_PATH'),
    APNS_KEY_PATH: readString(raw, 'APNS_KEY_PATH'),
    APNS_KEY_ID: readString(raw, 'APNS_KEY_ID'),
    APNS_TEAM_ID: readString(raw, 'APNS_TEAM_ID'),

    GOOGLE_WALLET_ISSUER_ID: readString(raw, 'GOOGLE_WALLET_ISSUER_ID'),
    GOOGLE_WALLET_SA_JSON: readString(raw, 'GOOGLE_WALLET_SA_JSON'),
    GOOGLE_WALLET_SA_BASE64: readString(raw, 'GOOGLE_WALLET_SA_BASE64'),

    SMTP_HOST: readString(raw, 'SMTP_HOST'),
    SMTP_PORT: readInt(raw, 'SMTP_PORT', null),
    SMTP_USER: readString(raw, 'SMTP_USER'),
    SMTP_PASS: readString(raw, 'SMTP_PASS'),
    SMTP_FROM: readString(raw, 'SMTP_FROM'),
  };
}
