import { cookies, headers } from 'next/headers';
import { DEFAULT_LOCALE, isValidLocale, type Locale } from './config';

// Países hispanohablantes — `es` por default.
const HISPANIC_COUNTRIES = new Set([
  'CO', 'MX', 'CL', 'AR', 'PE', 'EC', 'VE', 'PA', 'CR', 'ES',
  'BO', 'DO', 'GT', 'HN', 'NI', 'PY', 'SV', 'UY', 'CU', 'PR',
]);
// Lusófonos — `pt`.
const PT_COUNTRIES = new Set(['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL']);

/**
 * Resuelve el locale activo siguiendo la prioridad del spec:
 *   1. Cookie NEXT_LOCALE (elección manual del user).
 *   2. Accept-Language del browser.
 *   3. IP geo via Vercel header `x-vercel-ip-country`.
 *   4. Default ES.
 *
 * Note: la prioridad de "User.preferredLocale (DB)" se aplica en el
 * client side al login — el frontend hidrata el cookie con el valor de
 * /auth/me y a partir de ahí esta función lo recoge como cookie.
 */
export function detectLocaleSync(): Locale {
  const cookie = cookies().get('NEXT_LOCALE')?.value;
  if (isValidLocale(cookie)) return cookie;

  const hdrs = headers();

  const acceptLang = hdrs.get('accept-language');
  if (acceptLang) {
    const langs = acceptLang.split(',').map((s) => s.split(';')[0].trim());
    // Tries exact match first (en-GB, en-US, pt-BR), then 2-letter base.
    for (const raw of langs) {
      // Normalize "en-gb" → "en-GB" para el match con isValidLocale.
      const parts = raw.split('-');
      if (parts.length >= 2) {
        const normalized = `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
        if (isValidLocale(normalized)) return normalized;
      }
      const base = raw.toLowerCase().slice(0, 2);
      if (isValidLocale(base)) return base;
    }
  }

  const country = hdrs.get('x-vercel-ip-country');
  if (country) {
    if (country === 'BR') return 'pt-BR';
    if (country === 'PT') return 'pt';
    if (PT_COUNTRIES.has(country)) return 'pt';
    if (HISPANIC_COUNTRIES.has(country)) return 'es';
    if (country === 'GB') return 'en-GB';
    if (country === 'US') return 'en-US';
    return 'en';
  }

  return DEFAULT_LOCALE;
}
