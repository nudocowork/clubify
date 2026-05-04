/**
 * Geo-pricing helpers. Detecta país via Cloudflare CF-IPCountry header en SSR
 * y renderiza el precio en moneda local usando una tabla de tasas que
 * actualizamos manualmente cuando el dólar Hotmart se mueve >3%.
 *
 * IMPORTANTE: Hotmart hace su propia conversión en el checkout. Esto es solo
 * "marketing display" en el landing/billing para reducir la fricción del
 * "USD asusta". El cobro real se hace en moneda local por Hotmart.
 */

export type Currency = 'USD' | 'COP' | 'MXN' | 'ARS' | 'CLP' | 'PEN' | 'BRL' | 'CRC' | 'GTQ' | 'UYU' | 'EUR';

type CountryConfig = {
  currency: Currency;
  /** Cuántas unidades locales = 1 USD (referencia, actualizar manualmente) */
  rate: number;
  /** Locale para Intl.NumberFormat */
  locale: string;
  /** Símbolo a anteponer si Intl no lo hace bonito */
  symbol?: string;
};

// Tasas Hotmart de referencia. Actualizar cuando se muevan >3%.
// Última actualización: 2026-05-01
const COUNTRIES: Record<string, CountryConfig> = {
  CO: { currency: 'COP', rate: 4100, locale: 'es-CO' },
  MX: { currency: 'MXN', rate: 17.5, locale: 'es-MX' },
  AR: { currency: 'ARS', rate: 1100, locale: 'es-AR' },
  CL: { currency: 'CLP', rate: 950, locale: 'es-CL' },
  PE: { currency: 'PEN', rate: 3.7, locale: 'es-PE' },
  BR: { currency: 'BRL', rate: 5.1, locale: 'pt-BR' },
  CR: { currency: 'CRC', rate: 530, locale: 'es-CR' },
  GT: { currency: 'GTQ', rate: 7.8, locale: 'es-GT' },
  UY: { currency: 'UYU', rate: 41, locale: 'es-UY' },
  EC: { currency: 'USD', rate: 1, locale: 'es-EC' }, // Ecuador usa USD nativo
  PA: { currency: 'USD', rate: 1, locale: 'es-PA' },
  ES: { currency: 'EUR', rate: 0.93, locale: 'es-ES' },
  DEFAULT: { currency: 'USD', rate: 1, locale: 'en-US' },
};

export type LocalPrice = {
  /** Texto formateado listo para mostrar, p.ej. "$ 205.000" */
  display: string;
  /** Texto USD original, p.ej. "USD 50" */
  displayUsd: string;
  /** Currency code: COP, MXN, etc. */
  currency: Currency;
  /** Locale usado */
  locale: string;
  /** Cantidad numérica en moneda local */
  amount: number;
  /** Cantidad USD original */
  usd: number;
  /** Si la moneda detectada == USD */
  isUsdCountry: boolean;
};

export function getLocalPrice(usdAmount: number, country: string | null | undefined): LocalPrice {
  const cfg = COUNTRIES[(country ?? 'DEFAULT').toUpperCase()] ?? COUNTRIES.DEFAULT;
  const amount = Math.round(usdAmount * cfg.rate);
  const display = new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency: cfg.currency,
    maximumFractionDigits: cfg.rate > 100 ? 0 : 2,
  }).format(amount);
  return {
    display,
    displayUsd: `USD ${usdAmount}`,
    currency: cfg.currency,
    locale: cfg.locale,
    amount,
    usd: usdAmount,
    isUsdCountry: cfg.currency === 'USD',
  };
}

/**
 * En server component: lee el header CF-IPCountry de Cloudflare. En dev local
 * (sin Cloudflare), devuelve null y caemos al default USD.
 */
export function detectCountryFromHeaders(headers: Headers): string | null {
  return (
    headers.get('cf-ipcountry') ||
    headers.get('x-vercel-ip-country') ||
    null
  );
}
