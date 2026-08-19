import { decryptSecret } from '../common/crypto/secret-box';

/**
 * Conexión de EMAIL de una MARCA blanca, lista para enviar.
 *
 * Igual que `brandGrowCreds` para SMS: cada marca envía SUS correos con SU
 * propia cuenta (Resend) y su propio dominio remitente. Una marca blanca nunca
 * debe mandar un correo con remitente `@soyclubify.com` — revela la plataforma
 * y además rompe SPF/DKIM del dominio ajeno.
 *
 * El apiKey vive CIFRADO en `WhiteLabel.emailConfig` (secret-box) → se descifra
 * acá. Devuelve null si la marca no tiene la conexión completa (sin apiKey o
 * sin remitente) — el llamador decide si cae a la cuenta de plataforma (solo
 * la marca `clubify`) o no envía nada.
 */

export type BrandEmailProvider = 'RESEND';

export type BrandEmailCreds = {
  provider: BrandEmailProvider;
  apiKey: string;
  /** Remitente ya formateado: `Sellea <hola@selleala.com>`. */
  from: string;
  replyTo: string | null;
};

/** Forma cruda del Json `WhiteLabel.emailConfig`. */
export type BrandEmailConfig = {
  provider?: string | null;
  apiKey?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  replyTo?: string | null;
};

/** Campos a seleccionar de whiteLabel para resolver su envío de email. */
export const BRAND_EMAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  emailConfig: true,
  // Modelo previo (ya en producción): remitente de la marca sobre la cuenta de
  // email de la plataforma. Sigue siendo válido — ver `brandEmailSender`.
  emailFrom: true,
  contactEmail: true,
  // Dominio propio de la marca: los links de sus correos deben apuntar ahí,
  // no a soyclubify.com.
  domain: true,
  appDomain: true,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True si el string parece un email válido (validación de remitente/reply-to). */
export function isEmailAddress(v: string | null | undefined): boolean {
  return !!v && EMAIL_RE.test(v.trim());
}

/**
 * Arma el header `From`. El nombre se sanea (sin comillas ni `<>`, que romperían
 * el header) y, si queda vacío, se manda solo la dirección.
 */
export function formatFrom(
  fromName: string | null | undefined,
  fromEmail: string,
): string {
  const name = (fromName ?? '').replace(/["<>\r\n]/g, '').trim();
  return name ? `${name} <${fromEmail.trim()}>` : fromEmail.trim();
}

/**
 * Credenciales de envío de la marca, o null si la conexión está incompleta.
 * Tolera el apiKey en plano (dato previo al cifrado) igual que `decryptSecret`.
 */
export function brandEmailCreds(
  wl: { emailConfig?: unknown } | null | undefined,
): BrandEmailCreds | null {
  const cfg = (wl?.emailConfig ?? null) as BrandEmailConfig | null;
  if (!cfg || typeof cfg !== 'object') return null;

  const rawKey = (cfg.apiKey ?? '').trim();
  const fromEmail = (cfg.fromEmail ?? '').trim();
  if (!rawKey || !isEmailAddress(fromEmail)) return null;

  let apiKey: string;
  try {
    apiKey = decryptSecret(rawKey);
  } catch {
    // Clave rotada / valor corrupto: mejor no enviar que enviar mal.
    return null;
  }
  if (!apiKey.trim()) return null;

  const replyTo = (cfg.replyTo ?? '').trim();
  return {
    provider: 'RESEND',
    apiKey,
    from: formatFrom(cfg.fromName, fromEmail),
    replyTo: isEmailAddress(replyTo) ? replyTo : null,
  };
}

/** ¿La marca tiene la conexión de email configurada? (sin descifrar el secreto) */
export function hasBrandEmailConnection(
  wl: { emailConfig?: unknown } | null | undefined,
): boolean {
  const cfg = (wl?.emailConfig ?? null) as BrandEmailConfig | null;
  if (!cfg || typeof cfg !== 'object') return false;
  return !!(cfg.apiKey ?? '').trim() && isEmailAddress(cfg.fromEmail);
}

/**
 * De dónde sale un correo de esta marca:
 *  - `own`      → cuenta Resend PROPIA de la marca (`emailConfig`). Reputación
 *                 de envío separada de la de todos los demás. Lo mejor.
 *  - `shared`   → cuenta de la plataforma, pero con el remitente de la marca
 *                 (`emailFrom`, dominio verificado). Es el modelo que ya está
 *                 en producción y sigue funcionando igual.
 *  - `platform` → cuenta y remitente de Clubify. Solo para la marca `clubify`
 *                 y los negocios sin marca.
 *  - `none`     → una marca blanca sin ninguno de los dos NO envía. Mandar su
 *                 correo desde `@soyclubify.com` delataría la plataforma y
 *                 rompería el DMARC del dominio ajeno.
 */
export type BrandEmailSenderMode = 'own' | 'shared' | 'platform' | 'none';

export type BrandEmailSender = {
  mode: BrandEmailSenderMode;
  /** Cuenta propia. Null = se manda por la cuenta de la plataforma. */
  creds: BrandEmailCreds | null;
  /** Remitente a forzar cuando no hay cuenta propia. */
  from: string | null;
  replyTo: string | null;
};

type BrandSenderRow = {
  emailConfig?: unknown;
  emailFrom?: string | null;
  contactEmail?: string | null;
};

/** Resuelve la cascada de envío de la marca. */
export function brandEmailSender(
  wl: BrandSenderRow | null | undefined,
  opts: { isPlatform: boolean },
): BrandEmailSender {
  const own = brandEmailCreds(wl);
  if (own) {
    return { mode: 'own', creds: own, from: own.from, replyTo: own.replyTo };
  }
  const from = (wl?.emailFrom ?? '').trim();
  if (from) {
    const replyTo = (wl?.contactEmail ?? '').trim();
    return {
      mode: 'shared',
      creds: null,
      from,
      replyTo: isEmailAddress(replyTo) ? replyTo : null,
    };
  }
  if (opts.isPlatform) {
    return { mode: 'platform', creds: null, from: null, replyTo: null };
  }
  return { mode: 'none', creds: null, from: null, replyTo: null };
}

/** ¿Sale ALGÚN correo de esta marca? (cuenta propia o remitente propio) */
export function canBrandSendEmail(
  wl: (BrandSenderRow & { slug?: string | null }) | null | undefined,
  opts: { isPlatform: boolean },
): boolean {
  return brandEmailSender(wl, opts).mode !== 'none';
}

/** URL base de la marca: su dominio propio si lo tiene, si no el de la
 *  plataforma. Los links de sus correos salen de acá. */
export function brandBaseUrl(
  wl: { domain?: string | null; appDomain?: string | null } | null | undefined,
  fallbackAppUrl: string,
): string {
  const base = (fallbackAppUrl || 'https://soyclubify.com').replace(/\/+$/, '');
  const host = (wl?.domain || wl?.appDomain || '').trim().replace(/\/+$/, '');
  return host ? `https://${host}` : base;
}
