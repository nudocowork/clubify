/**
 * Desglose POR NEGOCIO de cada tarjeta de /admin/metricas (pedido del dueño,
 * 2026-10-19: «PREMIOS CANJEADOS 708 — confirmar si sí ha completado tantas
 * tarjetas y ver cuáles son esos negocios»).
 *
 * La regla de oro de este módulo: la suma de las filas TIENE que dar el número
 * de la tarjeta. Si el detalle dice 702 y la tarjeta 708, el dueño deja de
 * creer en las dos. Por eso las consultas del desglose agrupan por
 * (negocio, día de Bogotá) —el mismo corte que la serie de `generales`— y el
 * reparto entre «rango» y «período anterior» se hace aquí con `contieneDia`,
 * el mismo helper que usa `sumaEnRango`. Mismo corte, mismo reparto: mismo
 * total, por construcción y no por casualidad.
 *
 * Todo es puro (sin base ni reloj) para poder probar ese cuadre.
 */
import { contieneDia, variacion, type Rango, type Variacion } from './rango';
import type { EstadoNegocio, NegocioBase } from './negocios';

export const METRICAS_DESGLOSE = [
  'pases',
  'clientes',
  'sellos',
  'canjes',
  'pedidos',
  'tarjetas',
  'push',
  'wallet',
  'uso',
] as const;
export type MetricaDesglose = (typeof METRICAS_DESGLOSE)[number];

export const esMetricaDesglose = (x: unknown): x is MetricaDesglose =>
  typeof x === 'string' && (METRICAS_DESGLOSE as readonly string[]).includes(x);

const n = (v: unknown) => (v == null ? 0 : Number(v));

/** Día `AAAA-MM-DD` de una fila agrupada por `(col - 5 h)::date`. Igual que `serie()` del servicio. */
export function diaDeFila(dia: Date | string): string {
  return typeof dia === 'string' ? dia.slice(0, 10) : new Date(dia).toISOString().slice(0, 10);
}

export type Acumulado<K extends string> = { actual: Record<K, number>; anterior: Record<K, number> };

/**
 * Reparte filas `(negocio, día)` entre el rango y el período anterior. Los días
 * del hueco entre ambos (con «este mes» la ventana lee del 20 al 30 del mes
 * pasado) se descartan, como en `generales`.
 */
export function repartirPorNegocio<K extends string>(
  filas: Array<{ tenantId: string; dia: Date | string } & Partial<Record<K, unknown>>>,
  campos: readonly K[],
  rango: Rango,
  anterior: Rango,
): Map<string, Acumulado<K>> {
  const cero = () => Object.fromEntries(campos.map((c) => [c, 0])) as Record<K, number>;
  const m = new Map<string, Acumulado<K>>();
  for (const f of filas) {
    const dia = diaDeFila(f.dia);
    const lado = contieneDia(rango, dia) ? 'actual' : contieneDia(anterior, dia) ? 'anterior' : null;
    if (!lado) continue;
    let acc = m.get(f.tenantId);
    if (!acc) {
      acc = { actual: cero(), anterior: cero() };
      m.set(f.tenantId, acc);
    }
    for (const c of campos) acc[lado][c] += n(f[c]);
  }
  return m;
}

// ── Tabla genérica ──────────────────────────────────────────────────────────

/** `dinero` se pinta con la moneda de la fila (`extra.moneda`) y nunca se suma. */
export type TipoColumna = 'numero' | 'texto' | 'fecha' | 'porcentaje' | 'dinero';

export interface Columna {
  clave: string;
  etiqueta: string;
  tipo: TipoColumna;
  /**
   * ¿Se suma en la fila de totales? Un % o una fecha no se suman; un valor en
   * dinero tampoco cuando cada negocio cobra en su moneda (no hay tasas de
   * cambio en el sistema: sumar pesos con dólares sería un número falso).
   */
  sumable?: boolean;
}

export type ValorCelda = number | string | null;

export interface FilaDesglose {
  id: string;
  nombre: string;
  estado: EstadoNegocio;
  valor: number;
  anterior: number;
  variacion: Variacion;
  extra: Record<string, ValorCelda>;
  /** Sub-filas opcionales (las tarjetas creadas, las tarjetas canjeadas…). */
  detalle?: Array<Record<string, ValorCelda>>;
}

export interface EntradaNegocio {
  valor: number;
  anterior: number;
  extra?: Record<string, ValorCelda>;
  detalle?: Array<Record<string, ValorCelda>>;
}

export interface TablaDesglose {
  filas: FilaDesglose[];
  totales: { valor: number; anterior: number; variacion: Variacion; extra: Record<string, number> };
  /** Negocios del alcance que no aparecen porque no tuvieron nada ni ahora ni antes. */
  sinMovimiento: number;
}

/**
 * Arma la tabla: una fila por negocio con algo en el rango o en el anterior,
 * de mayor a menor. Los TOTALES se calculan sobre todos los negocios del
 * alcance, no solo sobre las filas visibles: así un negocio escondido por no
 * tener movimiento nunca descuadra la suma (y si la descuadrara, el test lo
 * cazaría).
 *
 * Empate en valor → el que venía de más arriba en el período anterior, y luego
 * por nombre, para que dos consultas iguales den siempre el mismo orden.
 */
export function armarTabla(
  negocios: NegocioBase[],
  datos: Map<string, EntradaNegocio>,
  columnas: Columna[],
  opts: {
    incluirTodos?: boolean;
    /** Quién sale como fila. Por defecto, quien tuvo algo ahora o antes. */
    mostrar?: (d: EntradaNegocio) => boolean;
  } = {},
): TablaDesglose {
  const sumables = columnas.filter((c) => c.sumable !== false && c.tipo === 'numero').map((c) => c.clave);
  const totExtra: Record<string, number> = Object.fromEntries(sumables.map((k) => [k, 0]));
  let valor = 0;
  let anterior = 0;
  const filas: FilaDesglose[] = [];
  for (const neg of negocios) {
    const d = datos.get(neg.id);
    const v = d?.valor ?? 0;
    const a = d?.anterior ?? 0;
    valor += v;
    anterior += a;
    for (const k of sumables) totExtra[k] += n(d?.extra?.[k]);
    const visible = opts.incluirTodos || (opts.mostrar ? !!d && opts.mostrar(d) : v !== 0 || a !== 0);
    if (!visible) continue;
    filas.push({
      id: neg.id,
      nombre: neg.nombre,
      estado: neg.estado,
      valor: v,
      anterior: a,
      variacion: variacion(v, a),
      extra: d?.extra ?? {},
      ...(d?.detalle ? { detalle: d.detalle } : {}),
    });
  }
  filas.sort((x, y) => y.valor - x.valor || y.anterior - x.anterior || x.nombre.localeCompare(y.nombre, 'es'));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    filas,
    totales: {
      valor: r2(valor),
      anterior: r2(anterior),
      variacion: variacion(valor, anterior),
      extra: Object.fromEntries(Object.entries(totExtra).map(([k, x]) => [k, r2(x)])),
    },
    sinMovimiento: negocios.length - filas.length,
  };
}

export const porcentaje = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// ── Canjes ──────────────────────────────────────────────────────────────────

/**
 * Qué se canjeó. La clave es el tipo de tarjeta, salvo los cupones.
 *
 * Por qué NO basta con el tipo de la tarjeta del pase: al redimir un cupón
 * (COUPON, o DISCOUNT/GIFT heredados) `StampsService.record` TRANSFORMA el
 * pase en tarjeta de sellos. Un minuto después, `Stamp → Pass → Card` dice
 * «STAMPS» y el cupón pasaría por premio de sellos completada — exactamente el
 * error de Primor Barber («RECOMPENSAS 122», que eran cupones de bienvenida).
 * Por eso manda `Stamp.redeemKind`, que se escribe en el momento del canje.
 *
 * `redeemKind` null solo queda en las filas copiadas por el duplicador de
 * negocios (`tenant-duplicator.service.ts` no copia la columna): ahí se cae al
 * tipo de la tarjeta, y se cuentan aparte como «sin clasificar».
 */
export type TipoCanje = 'STAMPS' | 'VISITS' | 'COUPON' | 'POINTS' | 'CASHBACK' | 'MEMBERSHIP' | 'OTRO';

const TIPOS_CUPON = new Set(['COUPON', 'DISCOUNT', 'GIFT']);

export function tipoDeCanje(redeemKind: string | null | undefined, cardType: string | null | undefined): TipoCanje {
  if (redeemKind === 'COUPON') return 'COUPON';
  if (redeemKind == null && cardType && TIPOS_CUPON.has(cardType)) return 'COUPON';
  switch (cardType) {
    case 'STAMPS':
      return 'STAMPS';
    case 'VISITS':
      return 'VISITS';
    case 'POINTS':
      return 'POINTS';
    case 'CASHBACK':
      return 'CASHBACK';
    case 'MEMBERSHIP':
      return 'MEMBERSHIP';
    default:
      // HYBRID, MULTI, INFO y un premio marcado sobre una tarjeta de cupón
      // indefinido: `record` acepta el REDEEM pero no descuenta nada, así que
      // no es «tarjeta completada». Se cuentan juntos para no inflar sellos.
      return 'OTRO';
  }
}

export const ETIQUETA_CANJE: Record<TipoCanje, { plural: string; singular: string }> = {
  STAMPS: { plural: 'premios de tarjeta de sellos completada', singular: 'premio de tarjeta de sellos completada' },
  VISITS: { plural: 'premios de tarjeta de visitas completada', singular: 'premio de tarjeta de visitas completada' },
  COUPON: { plural: 'cupones canjeados', singular: 'cupón canjeado' },
  POINTS: { plural: 'canjes en tarjetas de puntos', singular: 'canje en tarjeta de puntos' },
  CASHBACK: { plural: 'canjes en tarjetas de cashback', singular: 'canje en tarjeta de cashback' },
  MEMBERSHIP: { plural: 'canjes en membresías', singular: 'canje en membresía' },
  OTRO: { plural: 'canjes en otras tarjetas (híbrida, múltiple, informativa)', singular: 'canje en otra tarjeta' },
};

const ORDEN_CANJE: TipoCanje[] = ['STAMPS', 'VISITS', 'COUPON', 'POINTS', 'CASHBACK', 'MEMBERSHIP', 'OTRO'];

export interface FilaCanje {
  tenantId: string;
  redeemKind: string | null;
  cardId: string | null;
  cardName: string | null;
  cardType: string | null;
  canjes: number;
}

export interface ResumenCanjes {
  total: number;
  porTipo: Array<{ tipo: TipoCanje; etiqueta: string; canjes: number; porcentaje: number | null }>;
  porTarjeta: Array<{
    cardId: string | null;
    tarjeta: string;
    tipo: TipoCanje;
    tipoDeTarjeta: string | null;
    tenantId: string;
    canjes: number;
    /** El pase ya no está en la tarjeta del cupón: se transformó en la que se ve. */
    tarjetaTransformada: boolean;
  }>;
  /** Filas sin `redeemKind` (copias del duplicador): se clasificaron por el tipo de la tarjeta. */
  sinClasificar: number;
  frase: string;
}

/**
 * Resumen «de los N canjes: X premios de sellos, Y cupones…», por tipo y por
 * tarjeta. Recibe SOLO las filas del rango (el reparto por día ya se hizo).
 */
export function resumirCanjes(filas: FilaCanje[]): ResumenCanjes {
  const porTipo = new Map<TipoCanje, number>();
  const porTarjeta = new Map<string, ResumenCanjes['porTarjeta'][number]>();
  let total = 0;
  let sinClasificar = 0;
  for (const f of filas) {
    const c = n(f.canjes);
    if (c === 0) continue;
    const tipo = tipoDeCanje(f.redeemKind, f.cardType);
    total += c;
    if (f.redeemKind == null) sinClasificar += c;
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + c);
    const transformada = tipo === 'COUPON' && !!f.cardType && !TIPOS_CUPON.has(f.cardType);
    // El cupón transformado se agrupa aparte de los premios de esa misma
    // tarjeta de sellos: si no, «Tarjeta Café» sumaría premios y cupones.
    const clave = `${f.tenantId}|${f.cardId ?? '—'}|${tipo}`;
    const acc = porTarjeta.get(clave) ?? {
      cardId: f.cardId,
      tarjeta: f.cardName || 'Tarjeta borrada',
      tipo,
      tipoDeTarjeta: f.cardType,
      tenantId: f.tenantId,
      canjes: 0,
      tarjetaTransformada: transformada,
    };
    acc.canjes += c;
    porTarjeta.set(clave, acc);
  }
  const tipos = ORDEN_CANJE.filter((t) => (porTipo.get(t) ?? 0) > 0).map((t) => ({
    tipo: t,
    etiqueta: ETIQUETA_CANJE[t].plural,
    canjes: porTipo.get(t) ?? 0,
    porcentaje: porcentaje(porTipo.get(t) ?? 0, total),
  }));
  const num = (x: number) => x.toLocaleString('es-CO');
  const partes = tipos.map((t) => `${num(t.canjes)} ${t.canjes === 1 ? ETIQUETA_CANJE[t.tipo].singular : t.etiqueta}`);
  const frase =
    total === 0
      ? 'No hubo canjes en el rango.'
      : total === 1
        ? `Hubo 1 canje: ${unirConY(partes)}.`
        : `De los ${num(total)} canjes: ${unirConY(partes)}.`;
  return {
    total,
    porTipo: tipos,
    porTarjeta: [...porTarjeta.values()].sort(
      (a, b) => b.canjes - a.canjes || a.tarjeta.localeCompare(b.tarjeta, 'es'),
    ),
    sinClasificar,
    frase,
  };
}

function unirConY(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

/** Canjes de un negocio por tipo, como columnas de su fila. */
export function canjesPorTipoDelNegocio(filas: FilaCanje[]): Map<string, Record<TipoCanje, number>> {
  const m = new Map<string, Record<TipoCanje, number>>();
  for (const f of filas) {
    const acc =
      m.get(f.tenantId) ??
      (Object.fromEntries(ORDEN_CANJE.map((t) => [t, 0])) as Record<TipoCanje, number>);
    acc[tipoDeCanje(f.redeemKind, f.cardType)] += n(f.canjes);
    m.set(f.tenantId, acc);
  }
  return m;
}
