/**
 * Variantes y adiciones de un producto que llega del Onboarding.
 *
 * Hasta ahora el Onboarding **aplanaba las variantes a texto** y las pegaba al
 * final de la descripción: «Presentaciones / Torre pequeña — $34.900 / Torre
 * personal — $44.900». El cliente veía una lista que no podía tocar y el precio
 * del producto era el más barato de los tres, así que el pedido llegaba con un
 * importe que no era el que se pidió.
 *
 * Con un producto de DOS ejes —tamaño y adiciones— aplanar es peor todavía: no
 * hay forma de escribir en una descripción que se elige uno de tres tamaños y
 * hasta cinco adiciones.
 *
 * DOS EJES, DOS MODELOS
 * ---------------------
 *  · **Variantes** = de qué tamaño/presentación. Se elige entre ellas.
 *  · **Adiciones** = qué le echas encima. Se suman al precio resultante.
 *
 * EL PRECIO DE LA VARIANTE NO SIEMPRE ES UN DELTA
 * -----------------------------------------------
 * El formulario pide el **precio final** de cada presentación («Torre pequeña
 * $34.900»), no lo que suma sobre el base. Eso es `variantPriceMode:
 * 'ABSOLUTE'`. Mandarlo como DELTA convertiría 34.900 en «base + 34.900» y le
 * cobraría al cliente casi el doble.
 */

/** Una variante lista para guardar. */
export interface VarianteNormalizada {
  groupName: string;
  name: string;
  priceDelta: number;
  isDefault: boolean;
  position: number;
}

/** Una adición lista para guardar. */
export interface AdicionNormalizada {
  name: string;
  price: number;
  maxQty: number;
  isAvailable: boolean;
}

/** Convierte a número lo que venga: "34.900", "$12,50", 8000… */
export function aNumero(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!/\d/.test(s)) return null; // «Consultar», «—»
  const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (sep !== -1) {
    // El ÚLTIMO separador decide: con 3 dígitos detrás es de miles («34.900»
    // = treinta y cuatro mil novecientos, es-CO), con 1 o 2 es decimal.
    const decimales = s.length - sep - 1;
    const entero = s.slice(0, sep).replace(/[.,]/g, '');
    const resto = s.slice(sep + 1).replace(/[.,]/g, '');
    s = decimales > 0 && decimales <= 2 ? `${entero}.${resto}` : `${entero}${resto}`;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Las variantes de un producto. `null` = el payload no habla de variantes y no
 * se toca lo que el negocio tenga puesto en el panel.
 */
export function variantesDeProducto(entrada: {
  variants?: unknown;
}): VarianteNormalizada[] | null {
  if (!Array.isArray(entrada.variants)) return null;

  const salida: VarianteNormalizada[] = [];
  for (const v of entrada.variants) {
    if (!v || typeof v !== 'object') continue;
    const f = v as Record<string, unknown>;
    const name = String(f.name ?? '').trim();
    if (!name) continue;
    const precio = aNumero(f.priceDelta ?? f.price);
    // Una variante sin precio no se descarta: hay presentaciones que cuestan lo
    // mismo que el base y el formulario las deja en blanco.
    salida.push({
      groupName: String(f.groupName ?? f.group ?? 'Tamaño').trim() || 'Tamaño',
      name,
      priceDelta: precio ?? 0,
      isDefault: f.isDefault === true,
      position: salida.length,
    });
  }
  return salida;
}

/** Las adiciones de un producto. `null` = el payload no habla de ellas. */
export function adicionesDeProducto(entrada: {
  extras?: unknown;
}): AdicionNormalizada[] | null {
  if (!Array.isArray(entrada.extras)) return null;

  const salida: AdicionNormalizada[] = [];
  for (const e of entrada.extras) {
    if (!e || typeof e !== 'object') continue;
    const f = e as Record<string, unknown>;
    const name = String(f.name ?? '').trim();
    if (!name) continue;
    const precio = aNumero(f.price);
    const tope = aNumero(f.maxQty);
    salida.push({
      name,
      price: precio ?? 0,
      // Menos de 1 no tiene sentido: sería una adición que no se puede elegir.
      maxQty: tope != null && tope >= 1 ? Math.floor(tope) : 1,
      isAvailable: f.isAvailable !== false,
    });
  }
  return salida;
}

/**
 * Cómo se interpretan los precios de las variantes.
 *
 * Por defecto **ABSOLUTE** cuando el Onboarding manda variantes, porque su
 * formulario pide el precio final de cada presentación. Se puede forzar con
 * `variantPriceMode`.
 */
export function modoDePrecioDeVariantes(entrada: {
  variantPriceMode?: unknown;
}): 'DELTA' | 'ABSOLUTE' {
  return String(entrada.variantPriceMode ?? '')
    .trim()
    .toUpperCase() === 'DELTA'
    ? 'DELTA'
    : 'ABSOLUTE';
}
