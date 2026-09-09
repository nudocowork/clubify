/**
 * Cuánto dinero entró en una compra del producto de "servicios adicionales"
 * (packs de créditos, descuento de implementación).
 *
 * POR QUÉ NO SIRVE `purchase.price.value`
 * ---------------------------------------
 * Hotmart lo manda en la moneda del comprador y casi nunca es USD. Medido
 * contra las 18 compras reales de producción el 2026-09-09:
 *
 *   COP  12   ·   PAB  2   ·   PEN  1   ·   USD  2   ·   sin precio  1
 *
 * Tomarlo como USD sumaría 505.703,63 dólares por una compra de veinte. Es
 * exactamente el error que `resolvePaidUsd` ya evita para las suscripciones.
 *
 * DE DÓNDE SALE ENTONCES
 * ----------------------
 * De `original_offer_price`, que es el precio de la OFERTA y viene en USD en 17
 * de las 18 (la 18ª, la de Sellea del 31-jul, no trae precio de ninguna clase).
 * Mismo criterio que la contabilidad de suscripciones: vale el precio pactado,
 * no lo que la pasarela cobró tras el cambio de moneda.
 *
 * El último recurso es el precio del pack configurado en `HotmartCreditLink`,
 * y solo si está en USD — el campo admite otras monedas y nadie convierte.
 */

export interface PrecioHotmart {
  value?: number;
  currency_code?: string;
  currency_value?: string;
}

export interface CompraHotmartPrecios {
  price?: PrecioHotmart | null;
  original_offer_price?: PrecioHotmart | null;
}

export interface PackConfigurado {
  price?: unknown;
  currency?: string | null;
}

export type FuentePrecio = 'oferta' | 'pagado' | 'pack' | null;

export interface PrecioDePack {
  /** Importe en USD, o null si no se pudo determinar sin inventar. */
  usd: number | null;
  fuente: FuentePrecio;
  /** Para el log cuando `usd` es null: por qué no se pudo. */
  motivo?: string;
}

/** Techo de cordura: ninguna oferta de este producto pasa de ahí, así que un
 *  valor mayor es moneda local colada sin etiqueta. Los packs reales van de
 *  18 a 300 USD. */
const TECHO_USD = 600;

/** Moneda declarada, mirando los dos campos: Hotmart manda `currency_value` y
 *  a veces `currency_code`. Vacío = no la declaró. */
function monedaDe(p: PrecioHotmart | null | undefined): string {
  return (p?.currency_code || p?.currency_value || '').trim().toUpperCase();
}

/** El importe si está en USD y es creíble; null si no. Una moneda ausente NO
 *  se toma por USD: los pagos en COP llegaban con `currency_value` puesto, así
 *  que un campo vacío es un payload raro, no una promesa de dólares. */
function usdDe(p: PrecioHotmart | null | undefined): number | null {
  const v = p?.value;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  if (monedaDe(p) !== 'USD') return null;
  if (v > TECHO_USD) return null;
  return v;
}

export function precioDePackUsd(
  compra: CompraHotmartPrecios | null | undefined,
  pack?: PackConfigurado | null,
): PrecioDePack {
  // 1) Precio de la oferta en USD. Es el que sobrevive al cambio de moneda.
  const oferta = usdDe(compra?.original_offer_price);
  if (oferta != null) return { usd: oferta, fuente: 'oferta' };

  // 2) Lo pagado, pero solo cuando Hotmart lo declaró en USD.
  const pagado = usdDe(compra?.price);
  if (pagado != null) return { usd: pagado, fuente: 'pagado' };

  // 3) El precio configurado del pack, y solo si está en USD.
  const moneda = (pack?.currency ?? '').trim().toUpperCase();
  const configurado = Number(pack?.price);
  if (moneda === 'USD' && Number.isFinite(configurado) && configurado > 0) {
    return { usd: configurado, fuente: 'pack' };
  }

  const declarada =
    monedaDe(compra?.original_offer_price) || monedaDe(compra?.price) || '(sin moneda)';
  return {
    usd: null,
    fuente: null,
    motivo:
      moneda && moneda !== 'USD'
        ? `precio de la oferta en ${declarada} y el pack configurado en ${moneda}`
        : `precio de la oferta en ${declarada} y el pack sin precio en USD`,
  };
}
