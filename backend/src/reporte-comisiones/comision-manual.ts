/**
 * «+ NUEVA COMISIÓN» — la comisión que crea a mano un administrador.
 *
 * POR QUÉ NO SE REUSA `ReferralsService.createCommission`: ese camino crea la
 * fila sobre el `referralUse` del negocio con `periodKey = mes actual`. Eso
 * choca con la `UNIQUE(referralUseId, recipientCodeId, periodKey)` en cuanto el
 * colaborador ya tiene la comisión automática del mes, y peor: el webhook de
 * Hotmart y el reconciliador saltan un cobro si encuentran una comisión del
 * mismo (uso, destinatario) a ±3 días (`sameCycle`). Una comisión manual colgada
 * del uso haría que la comisión REAL de ese cobro no se generara nunca.
 *
 * Por eso la manual nace SIN `referralUseId` (como la comisión de equipo), con un
 * `periodKey` propio `MANUAL-<mes>-<clave>`, y el negocio, la venta relacionada y
 * la base se guardan en `CommissionManual`. El prefijo `MANUAL-` está en la lista
 * de monto libre (`referrals/comisiones-de-monto-libre.ts`): ni el recálculo del
 * reparto ni el arqueo la reescriben ni la anulan por «fantasma».
 *
 * El monto lo calcula SIEMPRE el servidor: lo que mande el formulario es solo
 * una vista previa.
 */

export const TIPOS_MANUALES = ['VENTA', 'RENOVACION', 'BONO', 'AJUSTE', 'OTRO'] as const;
export type TipoManual = (typeof TIPOS_MANUALES)[number];

export const ETIQUETA_DE_TIPO: Record<TipoManual, string> = {
  VENTA: 'Venta nueva',
  RENOVACION: 'Renovación',
  BONO: 'Bono',
  AJUSTE: 'Ajuste',
  OTRO: 'Otro',
};

export const ESTADOS_INICIALES = ['GENERADA', 'EN_REVISION'] as const;
export type EstadoInicial = (typeof ESTADOS_INICIALES)[number];

export const PREFIJO_MANUAL = 'MANUAL-';

/** Tope de cordura: una comisión manual de más de esto es un error de dedo. */
export const MONTO_MAXIMO_USD = 100_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type CalculoManual =
  | { ok: true; montoUsd: number; porcentaje: number | null; baseUsd: number }
  | { ok: false; error: string };

/**
 * El monto de la comisión. Con porcentaje: base × % / 100. Con monto fijo: ese
 * monto (la base queda como referencia de la venta, puede ser 0 en un bono).
 */
export function calcularComisionManual(input: {
  baseUsd: unknown;
  porcentaje?: unknown;
  montoFijoUsd?: unknown;
}): CalculoManual {
  const base = Number(input.baseUsd ?? 0);
  if (!Number.isFinite(base) || base < 0 || base > MONTO_MAXIMO_USD) {
    return { ok: false, error: 'La base de la comisión no es válida.' };
  }
  const hayFijo = input.montoFijoUsd !== undefined && input.montoFijoUsd !== null && input.montoFijoUsd !== '';
  const hayPct = input.porcentaje !== undefined && input.porcentaje !== null && input.porcentaje !== '';
  if (hayFijo === hayPct) {
    return { ok: false, error: 'Indica un porcentaje o un monto fijo (uno de los dos).' };
  }
  if (hayFijo) {
    const fijo = Number(input.montoFijoUsd);
    if (!Number.isFinite(fijo) || fijo <= 0 || fijo > MONTO_MAXIMO_USD) {
      return { ok: false, error: 'El monto fijo tiene que ser mayor que cero.' };
    }
    return { ok: true, montoUsd: round2(fijo), porcentaje: null, baseUsd: round2(base) };
  }
  const pct = Number(input.porcentaje);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return { ok: false, error: 'El porcentaje tiene que estar entre 0 y 100.' };
  }
  if (base <= 0) return { ok: false, error: 'Con porcentaje, la base tiene que ser mayor que cero.' };
  const monto = round2((base * pct) / 100);
  if (monto <= 0) return { ok: false, error: 'La comisión calculada da cero.' };
  return { ok: true, montoUsd: monto, porcentaje: round2(pct), baseUsd: round2(base) };
}

/** La clave de idempotencia que manda el formulario al abrirse (un uuid). */
export function claveValida(clave: unknown): clave is string {
  return typeof clave === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(clave);
}

/** `periodKey` de una comisión manual: único por creación y empieza por su mes. */
export function periodKeyManual(fechaYmd: string, clave: string): string {
  return `${PREFIJO_MANUAL}${fechaYmd.slice(0, 7)}-${clave.replace(/-/g, '').slice(0, 12)}`;
}

export const esManual = (periodKey: string | null | undefined): boolean =>
  !!periodKey && periodKey.startsWith(PREFIJO_MANUAL);

/**
 * ¿El colaborador ya cobra comisión por ESA venta? Se compara contra sus
 * comisiones vivas del mismo negocio: por la transacción de Hotmart, o por fecha
 * a ±3 días (el mismo margen con el que el motor decide «mismo cobro»).
 */
export function yaCobraEstaVenta(
  venta: { externalTxId: string; saleDate: Date | string },
  existentes: Array<{
    status: string;
    hotmartTransactionId: string | null;
    externalTxId: string | null;
    businessDate: Date | string | null;
    createdAt: Date | string;
    periodKey: string | null;
  }>,
): boolean {
  const fecha = new Date(venta.saleDate).getTime();
  return existentes.some((c) => {
    if (c.status === 'REJECTED' || esManual(c.periodKey)) return false;
    if (c.hotmartTransactionId && c.hotmartTransactionId === venta.externalTxId) return true;
    if (c.externalTxId && c.externalTxId === venta.externalTxId) return true;
    // Con OTRA transacción es otro cobro, por cerca que esté (Wok Explosivo:
    // dos cobros reales en el mismo mes).
    if (c.hotmartTransactionId) return false;
    const f = new Date(c.businessDate ?? c.createdAt).getTime();
    return Math.abs(f - fecha) <= 3 * 86_400_000;
  });
}
