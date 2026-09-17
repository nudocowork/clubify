/**
 * Los enlaces de venta de Clubify: los planes normales, los de pago parcial y
 * los que llevan prueba de 7 días.
 *
 * POR QUÉ EXISTE (Javier, 2026-09-17): la configuración solo admitía CUATRO
 * enlaces fijos (mensual, trimestral, semestral, anual) más el de la prueba.
 * Cada oferta nueva de Hotmart —la prueba de 7 días del trimestral, la del
 * anual, los pagos parciales— había que meterla en el código, y mientras tanto
 * los afiliados no la tenían en su panel. Ahora la lista se edita desde
 * /admin/branding y el panel del afiliado la lee con su código dentro.
 *
 * Los 4 planes y el enlace de prueba SIGUEN donde estaban (`landing.plans.*`,
 * `landing.trial.checkoutUrl`): esta lista son los EXTRA, y `componerEnlaces`
 * los junta todos para quien los pinta. Así nada de lo que ya funciona cambia
 * de sitio.
 */

export type TipoDeEnlace = 'NORMAL' | 'PARCIAL' | 'PRUEBA';

export interface EnlaceDeVenta {
  id: string;
  nombre: string;
  tipo: TipoDeEnlace;
  /** MENSUAL | TRIMESTRAL | SEMESTRAL | ANUAL, si aplica. */
  periodicidad: string | null;
  precioUsd: number | null;
  url: string;
  activo: boolean;
}

export const CLAVE_ENLACES_DE_VENTA = 'landing.enlacesDeVenta';
/** Tope de seguridad: es una lista a mano, no un catálogo. */
export const MAX_ENLACES = 30;

const TIPOS: TipoDeEnlace[] = ['NORMAL', 'PARCIAL', 'PRUEBA'];

const texto = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * Solo http(s) — un `javascript:` en un enlace que se copia y se comparte, no —
 * y SIN `sck`/`src` pegados.
 *
 * Lo del `sck`: es donde va el código del afiliado. Si alguien copia de Hotmart
 * un enlace de campaña que ya trae `?sck=instagram`, el código del afiliado no
 * lo pisa (`conCodigoDelAfiliado` respeta un valor ajeno) y todas las ventas por
 * ese enlace se quedan sin atribuir, en silencio. Se limpia al guardar, no al
 * pintarlo: así el que guarda ve exactamente lo que se va a compartir.
 */
function urlValida(v: unknown): string {
  const s = texto(v, 600);
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    u.searchParams.delete('sck');
    u.searchParams.delete('src');
    return u.toString();
  } catch {
    return '';
  }
}

/**
 * Deja la lista utilizable venga como venga (texto JSON del ajuste, arreglo del
 * panel, o basura): descarta lo que no tiene nombre o URL, acota, y no permite
 * ids repetidos —dos enlaces con el mismo id se pisarían en el panel—.
 */
export function normalizarEnlaces(raw: unknown): EnlaceDeVenta[] {
  let lista: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      lista = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(lista)) return [];
  const vistos = new Set<string>();
  const out: EnlaceDeVenta[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const nombre = texto(o.nombre, 60);
    const url = urlValida(o.url);
    if (!nombre || !url) continue;
    const tipo = TIPOS.includes(o.tipo as TipoDeEnlace) ? (o.tipo as TipoDeEnlace) : 'NORMAL';
    const idBase = texto(o.id, 40).replace(/[^a-zA-Z0-9_-]/g, '') || `enlace-${out.length + 1}`;
    let id = idBase;
    let n = 2;
    while (vistos.has(id)) id = `${idBase}-${n++}`;
    vistos.add(id);
    const precio = Number(o.precioUsd);
    out.push({
      id,
      nombre,
      tipo,
      periodicidad: texto(o.periodicidad, 20).toUpperCase() || null,
      precioUsd: Number.isFinite(precio) && precio > 0 ? Math.round(precio * 100) / 100 : null,
      url,
      activo: o.activo !== false,
    });
    if (out.length >= MAX_ENLACES) break;
  }
  return out;
}

const NOMBRE_DEL_PLAN: Record<string, string> = {
  mensual: 'Mensual',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
};

/**
 * Todos los enlaces que se pueden compartir hoy, en orden: primero los planes de
 * siempre, después el de la prueba y al final los que se hayan añadido. Los
 * inactivos y los que no tienen URL no salen: un enlace sin URL en el panel de
 * un afiliado es un botón que no lleva a ninguna parte.
 */
export function componerEnlaces(args: {
  planes: Record<string, { price: number; checkoutUrl: string | null }>;
  urlDePrueba?: string | null;
  diasDePrueba?: number | null;
  extras?: EnlaceDeVenta[];
}): EnlaceDeVenta[] {
  const out: EnlaceDeVenta[] = [];
  for (const id of ['mensual', 'trimestral', 'semestral', 'anual']) {
    const plan = args.planes?.[id];
    const url = urlValida(plan?.checkoutUrl);
    if (!url) continue;
    out.push({
      id: `plan-${id}`,
      nombre: NOMBRE_DEL_PLAN[id] ?? id,
      tipo: 'NORMAL',
      periodicidad: id.toUpperCase(),
      precioUsd: Number.isFinite(plan?.price) ? plan!.price : null,
      url,
      activo: true,
    });
  }
  const prueba = urlValida(args.urlDePrueba);
  if (prueba) {
    const dias = args.diasDePrueba && args.diasDePrueba > 0 ? args.diasDePrueba : null;
    out.push({
      id: 'prueba',
      nombre: dias ? `Prueba de ${dias} días` : 'Prueba con tarjeta',
      tipo: 'PRUEBA',
      periodicidad: null,
      precioUsd: null,
      url: prueba,
      activo: true,
    });
  }
  const ids = new Set(out.map((e) => e.id));
  for (const extra of args.extras ?? []) {
    if (!extra.activo || ids.has(extra.id)) continue;
    ids.add(extra.id);
    out.push(extra);
  }
  return out;
}
