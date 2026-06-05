/**
 * Whitelist de schemes permitidos en URLs que se renderizan en páginas
 * públicas. Bloquea `javascript:`, `data:`, `vbscript:`, `file:`,
 * `blob:`, etc — vectores clásicos de XSS cuando un dueño con permisos
 * de edición (TENANT_OWNER o STAFF) guarda un link malicioso y un
 * cliente final hace click.
 *
 * Acepta:
 *  - http: / https: (links externos normales)
 *  - mailto: (links de email)
 *  - tel: / wa.me / api.whatsapp.com (links de teléfono / WhatsApp)
 *  - / o ruta relativa (links internos del propio storefront)
 *
 * Devuelve la URL original si pasa, o null si está bloqueada. El caller
 * decide si rechaza (BadRequestException en el PATCH) o filtra silencioso
 * (al render). Idealmente: rechaza en write para no quedar con basura
 * en DB.
 */
export function safeUrlOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url) return null;
  // Rutas relativas internas — el browser las resuelve contra el origen
  // actual, sin posibilidad de inyección de scheme.
  if (url.startsWith('/') || url.startsWith('#')) return url;
  // Match esquemas permitidos al inicio (case-insensitive). Importante
  // chequear con startsWith en lugar de includes para que
  // `httpsx://javascript:...` no pase.
  const lower = url.toLowerCase();
  const ALLOWED_PREFIXES = [
    'http://',
    'https://',
    'mailto:',
    'tel:',
    'sms:',
    'wa.me/',
    'whatsapp://',
  ];
  if (ALLOWED_PREFIXES.some((p) => lower.startsWith(p))) return url;
  // `wa.me/+57...` sin scheme también debería pasar como WhatsApp.
  if (lower.startsWith('wa.me') || lower.startsWith('api.whatsapp.com')) {
    return url;
  }
  return null;
}

/** True si la URL es segura para renderizar. Util para guards
 *  rápidos en frontend antes de pegarla a un href. */
export function isSafeUrl(raw: unknown): boolean {
  return safeUrlOrNull(raw) !== null;
}
