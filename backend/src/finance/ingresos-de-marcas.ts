/**
 * Reglas puras del apartado «Marcas blancas»: qué es cada ingreso y cómo se
 * comparan las marcas. Sin base de datos, para poder probarlas solas.
 *
 * Una marca blanca le paga a la plataforma por dos cosas, y SOLO esas dos son
 * ingreso de Clubify (Sara, 2026-10-06):
 *   - la COMPRA DE LA MARCA BLANCA (la licencia, unos USD 1.000–1.200), que se
 *     puede pagar en cuotas (`WhiteLabelSale` guarda el acuerdo), y
 *   - los CRÉDITOS que gasta al activar cada negocio suyo.
 * Un SERVICIO (la automatización de WhatsApp de Sellea) también pasa por aquí,
 * pero Clubify solo hace de intermediario: se guarda con estado INTERMEDIADO y
 * se ve aparte, como «servicios adicionales», sin sumar a los ingresos.
 * Todo vive en el mismo libro que el resto, con `payerWhiteLabelId` = la marca.
 *
 * La clave REBRANDING se queda (hay filas guardadas con ella); lo que cambia es
 * cómo se llama en pantalla.
 */

export const CONCEPTOS = {
  REBRANDING: 'Compra marca blanca',
  CREDITOS: 'Créditos',
  SERVICIO: 'Servicio',
  OTRO: 'Otro',
} as const;
export type Concepto = keyof typeof CONCEPTOS;

/**
 * El concepto de un ingreso de marca. Lo registrado a mano lleva el concepto en
 * `productName`; lo que llegó por Hotmart como compra de créditos se reconoce
 * por su fila en `HotmartCreditPurchase`.
 */
export function conceptoDelIngreso(fila: {
  externalTxId: string;
  productName: string | null;
  esCompraDeCreditos: boolean;
}): Concepto {
  if (fila.esCompraDeCreditos) return 'CREDITOS';
  const n = (fila.productName ?? '').trim().toLowerCase();
  if (n === CONCEPTOS.REBRANDING.toLowerCase() || n === 'rebranding') return 'REBRANDING';
  if (n === CONCEPTOS.CREDITOS.toLowerCase()) return 'CREDITOS';
  if (n.startsWith(CONCEPTOS.SERVICIO.toLowerCase())) return 'SERVICIO';
  return 'OTRO';
}

export type IngresoDeMarca = {
  payerWhiteLabelId: string;
  grossUsd: number;
  saleDate: Date;
  concepto: Concepto;
};

export type ResumenDeMarca = {
  whiteLabelId: string;
  totalUsd: number;
  porConcepto: Record<Concepto, number>;
  pagos: number;
  ultimoPago: Date | null;
  /** Qué parte de lo que pagaron TODAS las marcas en el período es suya. */
  participacion: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Suma por marca y las ordena de la que más ingresa a la que menos. */
export function compararMarcas(ingresos: IngresoDeMarca[], marcas: string[]): ResumenDeMarca[] {
  const vacio = (): Record<Concepto, number> => ({ REBRANDING: 0, CREDITOS: 0, SERVICIO: 0, OTRO: 0 });
  const por = new Map<string, ResumenDeMarca>(
    marcas.map((id) => [id, { whiteLabelId: id, totalUsd: 0, porConcepto: vacio(), pagos: 0, ultimoPago: null, participacion: 0 }]),
  );
  for (const i of ingresos) {
    const m = por.get(i.payerWhiteLabelId);
    if (!m) continue;
    m.totalUsd = r2(m.totalUsd + i.grossUsd);
    m.porConcepto[i.concepto] = r2(m.porConcepto[i.concepto] + i.grossUsd);
    m.pagos += 1;
    if (!m.ultimoPago || i.saleDate > m.ultimoPago) m.ultimoPago = i.saleDate;
  }
  const total = [...por.values()].reduce((a, m) => a + m.totalUsd, 0);
  return [...por.values()]
    .map((m) => ({ ...m, participacion: total > 0 ? Math.round((m.totalUsd / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
}

// ─── La venta de la marca blanca, en cuotas ──────────────────────────────────

export const FRECUENCIAS = { MENSUAL: 'Mensual', QUINCENAL: 'Quincenal', SEMANAL: 'Semanal' } as const;
export type Frecuencia = keyof typeof FRECUENCIAS;

export const ESTADOS_DE_VENTA = {
  ACTIVA: 'En curso',
  /** Pagó una parte y se detuvo (Fideliso): lo pagado cuenta, no se espera cuota. */
  PAUSADA: 'Pausada',
  PAGADA: 'Pagada',
  CANCELADA: 'Cancelada',
} as const;
export type EstadoDeVenta = keyof typeof ESTADOS_DE_VENTA;

export type VentaDeMarca = {
  totalUsd: number | null;
  cuotas: number;
  frecuencia: Frecuencia;
  primeraCuota: Date | null;
  estado: EstadoDeVenta;
};

export type CuentaDeLaVenta = {
  pagadoUsd: number;
  /** null mientras no se haya fijado el precio de venta. */
  faltaUsd: number | null;
  montoCuotaUsd: number | null;
  cuotasPagadas: number;
  /** Cuándo toca la siguiente cuota; null si no se espera ninguna. */
  proximaCuota: Date | null;
  vencida: boolean;
};

/** La fecha de la cuota número `n` (0 = la primera). Fin de mes se respeta:
 *  una venta del 31 cobra el 30 de abril, no el 1 de mayo. */
export function fechaDeCuota(primera: Date, frecuencia: Frecuencia, n: number): Date {
  if (frecuencia === 'SEMANAL') return new Date(primera.getTime() + n * 7 * 86_400_000);
  if (frecuencia === 'QUINCENAL') return new Date(primera.getTime() + n * 15 * 86_400_000);
  const d = new Date(primera);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d;
}

/**
 * Cuánto lleva pagado una marca de su compra, cuánto falta y cuándo es la
 * próxima cuota. Los pagos son los PAGADOS de concepto «Compra marca blanca».
 *
 * Las cuotas pagadas se cuentan por DINERO, no por número de pagos: si pagaron
 * dos cuotas en una transferencia, son dos; si pagaron media, aún no es una.
 */
export function cuentaDeLaVenta(venta: VentaDeMarca, pagos: number[], hoy: Date): CuentaDeLaVenta {
  const pagadoUsd = r2(pagos.reduce((a, n) => a + n, 0));
  const total = venta.totalUsd != null && venta.totalUsd > 0 ? venta.totalUsd : null;
  const cuotas = Math.max(1, Math.floor(venta.cuotas || 1));
  const faltaUsd = total == null ? null : r2(Math.max(0, total - pagadoUsd));
  const montoCuotaUsd = total == null ? null : r2(total / cuotas);
  const cuotasPagadas =
    montoCuotaUsd == null ? 0 : Math.min(cuotas, Math.floor((pagadoUsd + 0.005) / montoCuotaUsd));
  const espera = venta.estado === 'ACTIVA' && faltaUsd != null && faltaUsd > 0 && venta.primeraCuota != null;
  const proximaCuota = espera ? fechaDeCuota(venta.primeraCuota!, venta.frecuencia, cuotasPagadas) : null;
  return {
    pagadoUsd,
    faltaUsd,
    montoCuotaUsd,
    cuotasPagadas,
    proximaCuota,
    vencida: proximaCuota != null && proximaCuota.getTime() < hoy.getTime(),
  };
}
