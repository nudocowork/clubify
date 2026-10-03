/**
 * Reglas puras del apartado «Marcas blancas»: qué es cada ingreso y cómo se
 * comparan las marcas. Sin base de datos, para poder probarlas solas.
 *
 * Una marca blanca le paga a la plataforma por el REBRANDING (la licencia, unos
 * USD 1.000–1.200), por los CRÉDITOS que gasta al activar cada negocio suyo, y a
 * veces por un SERVICIO (p. ej. la automatización de WhatsApp de Sellea). Todo
 * eso es ingreso de la plataforma (Sara, 2026-10-03) y vive en el mismo libro
 * que el resto, con `payerWhiteLabelId` = la marca que pagó.
 */

export const CONCEPTOS = {
  REBRANDING: 'Rebranding',
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
  if (n === CONCEPTOS.REBRANDING.toLowerCase()) return 'REBRANDING';
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
