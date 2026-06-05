/**
 * Espejo del helper backend `safe-url.ts`. Whitelist de schemes
 * permitidos en URLs que vienen de input del dueño y se renderizan en
 * páginas públicas (InfoLink buttons, popup buttonUrl, etc).
 *
 * Bloquea: `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` —
 * vectores clásicos de XSS. Acepta: http, https, mailto, tel, sms,
 * wa.me, whatsapp:// y rutas relativas (/...).
 *
 * Use isSafeUrl en cada lugar donde un string del backend se va a
 * pegar a un `href` o un `window.location.href = ...`. El backend
 * idealmente ya filtra al PATCH, pero defense-in-depth.
 */

export function safeUrlOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url) return null;
  if (url.startsWith('/') || url.startsWith('#')) return url;
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
  if (lower.startsWith('wa.me') || lower.startsWith('api.whatsapp.com')) {
    return url;
  }
  return null;
}

export function isSafeUrl(raw: unknown): boolean {
  return safeUrlOrNull(raw) !== null;
}
