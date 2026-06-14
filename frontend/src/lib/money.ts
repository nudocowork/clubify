/**
 * Formato monetario por país/moneda — usa Intl.NumberFormat.
 *
 * Antes muchos sitios usaban `Intl.NumberFormat('es-CO', { currency:
 * 'COP', maximumFractionDigits: 0 })`, lo que redondeaba 13.50 USD →
 * 14 USD silenciosamente al usar el mismo formato para todas las
 * monedas. Este helper aplica las reglas correctas de cada moneda:
 *
 *  - COP: 0 decimales, separador miles `.`         → $1.350
 *  - USD: 2 decimales, separador miles `,`         → $1,350.00
 *  - EUR: 2 decimales, separador miles `.`         → 1.350,00 €
 *  - MXN/ARS/CLP/PEN/etc: usar `currency` directamente — Intl resuelve.
 *
 * El valor en DB siempre se guarda con precisión completa (`Decimal`
 * 10,2). Esta función SOLO afecta visualización.
 */

const LOCALE_FOR_CURRENCY: Record<string, string> = {
  COP: 'es-CO',
  USD: 'en-US',
  EUR: 'de-DE',
  MXN: 'es-MX',
  ARS: 'es-AR',
  CLP: 'es-CL',
  PEN: 'es-PE',
  BRL: 'pt-BR',
  GBP: 'en-GB',
};

/** Monedas que tradicionalmente NO usan decimales en uso diario. */
const ZERO_DECIMAL_CURRENCIES = new Set(['COP', 'CLP', 'PYG', 'VND', 'JPY', 'KRW']);

export type CurrencyCode = string; // ISO 4217 — keep flexible

/**
 * Formatea un número como precio con símbolo de moneda.
 * Default currency = 'COP' para compat con el código histórico.
 *
 * @param value monto numérico (Decimal o number)
 * @param currency ISO 4217 (COP, USD, EUR, ...). Default 'COP'.
 * @param opts.withSymbol si false, omite el símbolo (`1.350,00` en vez
 *   de `1.350,00 €`). Default true.
 */
export function formatPrice(
  value: number | string | null | undefined,
  currency: CurrencyCode = 'COP',
  opts?: { withSymbol?: boolean; symbolOverride?: string | null },
): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return '';
  const ccy = (currency || 'COP').toUpperCase();
  const locale = LOCALE_FOR_CURRENCY[ccy] ?? 'es-CO';
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(ccy);
  // Si el valor tiene decimales no triviales, mostrar 2 incluso en COP
  // (raro, pero un producto vendido a $1.350,50 debe mostrar el .50).
  const hasFractional = Math.abs(n - Math.trunc(n)) > 0.001;
  const minFrac = isZeroDecimal && !hasFractional ? 0 : 2;
  const maxFrac = isZeroDecimal && !hasFractional ? 0 : 2;

  const withSymbol = opts?.withSymbol !== false;
  const symbolOverride = opts?.symbolOverride?.trim();
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: withSymbol ? 'currency' : 'decimal',
      currency: withSymbol ? ccy : undefined,
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    });

    // Override del símbolo: usamos formatToParts para reemplazar SOLO la
    // parte "currency" sin tocar separadores ni el orden (varía por locale).
    if (withSymbol && symbolOverride) {
      const parts = formatter.formatToParts(n);
      return parts
        .map((p) => (p.type === 'currency' ? symbolOverride : p.value))
        .join('');
    }
    return formatter.format(n);
  } catch {
    // Fallback si el currency code es inválido (Intl tira RangeError).
    const base = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: minFrac,
      maximumFractionDigits: maxFrac,
    }).format(n);
    if (withSymbol && symbolOverride) return `${symbolOverride} ${base}`;
    return base;
  }
}

/**
 * Parsea un string ingresado por el usuario en formato locale a
 * número canónico. Maneja tanto `1.350,50` (es-CO/de-DE) como
 * `1,350.50` (en-US) de forma robusta — interpreta el último
 * separador como decimal.
 */
export function parsePriceInput(
  input: string | null | undefined,
): number | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (s === '') return null;
  // Quitar símbolos de moneda y espacios
  const cleaned = s.replace(/[^\d.,-]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  // Detectar separador decimal: el último `,` o `.` antes de los
  // últimos 1-3 dígitos. Si solo hay uno y va seguido de 1-2 dígitos
  // al final, es decimal. Si va seguido de 3 dígitos, es miles.
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized = cleaned;
  if (lastDot === -1 && lastComma === -1) {
    // sin separador
  } else if (lastDot > lastComma) {
    // `.` es decimal, `,` (si hay) son miles
    normalized = cleaned.replace(/,/g, '');
  } else if (lastComma > lastDot) {
    // `,` es decimal, `.` (si hay) son miles
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
