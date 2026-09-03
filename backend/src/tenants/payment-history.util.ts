/**
 * Historial de pagos de un negocio, unificado.
 *
 * No hay una tabla de cobros: lo que hay es el registro crudo de cada webhook
 * (`HotmartWebhookEvent`, `StripeWebhookEvent`), los pagos cobrados por fuera
 * (`ManualPayment`) y las activaciones con crédito (`CreditTransaction`).
 * Este módulo los junta y los normaliza para responder una sola pregunta:
 * **¿este negocio está pagando o no?**
 *
 * Dos cosas que hay que respetar y no son obvias:
 *
 * 1. Hotmart manda VARIOS eventos por el MISMO cobro — `PURCHASE_APPROVED`
 *    primero y `PURCHASE_COMPLETE` una semana después (cuando vence la
 *    garantía). Contarlos por separado duplicaría todos los pagos. Se agrupa
 *    por `purchase.transaction`, que es la clave del cobro.
 *
 * 2. Un reintento que sale bien llega como otro evento de la MISMA
 *    transacción. Por eso gana el estado más definitivo, no el más reciente:
 *    un cobro rechazado que después se aprueba está pagado.
 *
 * El importe es `full_price` —lo que se le cobró al negocio—, no `price`, que
 * es lo que queda neto después de la comisión de Hotmart. Y la moneda sale de
 * `currency_value`; `currency_code` no existe en estos payloads.
 */

export type EstadoPago =
  | 'PAGADO'
  | 'RECHAZADO'
  | 'REEMBOLSADO'
  | 'CONTRACARGO'
  | 'EXPIRADO'
  | 'PENDIENTE'
  | 'CANCELADO';

export type OrigenPago = 'HOTMART' | 'STRIPE' | 'MANUAL' | 'CREDITO';

export type PagoDelHistorial = {
  id: string;
  fecha: Date;
  origen: OrigenPago;
  estado: EstadoPago;
  /** Lo que se le cobró al negocio, en la moneda en que se cobró. */
  monto: number | null;
  moneda: string | null;
  /** Precio de la oferta en USD, cuando Hotmart lo informa. Sirve para
   *  comparar cobros hechos en monedas distintas. NO es una conversión
   *  nuestra: es el dato de Hotmart. */
  montoUsd: number | null;
  metodo: string | null;
  /** Por qué se rechazó ("Saldo insuficiente."). Solo en RECHAZADO. */
  motivo: string | null;
  referencia: string | null;
  /** Número de cobro dentro de la suscripción (1 = el primero). */
  numeroDeCobro: number | null;
  /** Ciclo que cubre el pago. Solo lo sabemos en los pagos manuales. */
  cubreDesde: Date | null;
  cubreHasta: Date | null;
  nota: string | null;
};

/**
 * Qué estado gana cuando varios eventos hablan del MISMO cobro.
 *
 * No es «el más reciente»: Hotmart puede mandar el `COMPLETE` de un cobro
 * viejo después del `DELAYED` de uno nuevo. Gana el más definitivo — un
 * contracargo pesa más que un reembolso, y un reembolso más que un pago.
 */
const PESO: Record<EstadoPago, number> = {
  CONTRACARGO: 6,
  REEMBOLSADO: 5,
  PAGADO: 4,
  CANCELADO: 3,
  EXPIRADO: 2,
  RECHAZADO: 1,
  PENDIENTE: 0,
};

const ESTADO_POR_EVENTO: Record<string, EstadoPago> = {
  PURCHASE_APPROVED: 'PAGADO',
  PURCHASE_COMPLETE: 'PAGADO',
  PURCHASE_DELAYED: 'RECHAZADO',
  PURCHASE_BILLET_PRINTED: 'PENDIENTE',
  PURCHASE_EXPIRED: 'EXPIRADO',
  PURCHASE_REFUNDED: 'REEMBOLSADO',
  PURCHASE_CHARGEBACK: 'CONTRACARGO',
  PURCHASE_PROTEST: 'CONTRACARGO',
  PURCHASE_CANCELED: 'CANCELADO',
};

const METODO_LEGIBLE: Record<string, string> = {
  CREDIT_CARD: 'Tarjeta de crédito',
  DEBIT_CARD: 'Tarjeta débito',
  PIX: 'PIX',
  BILLET: 'Boleto',
  PAYPAL: 'PayPal',
  APPLE_PAY: 'Apple Pay',
  GOOGLE_PAY: 'Google Pay',
  NEQUI: 'Nequi',
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro',
};

export function metodoLegible(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return METODO_LEGIBLE[raw] ?? raw;
}

/** Hotmart manda las fechas en milisegundos. Un 0 no es una fecha. */
function fechaHotmart(ms: unknown): Date | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function numero(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

type EventoCrudo = {
  eventType: string;
  payload: unknown;
  processedAt: Date;
};

/**
 * Convierte los eventos de Hotmart de un negocio en una fila por COBRO.
 *
 * Los eventos que no hablan de dinero (`CLUB_FIRST_ACCESS`,
 * `CLUB_MODULE_COMPLETED`) se descartan: ensucian el historial sin decir nada
 * sobre si el negocio paga.
 */
export function agruparCobrosHotmart(
  eventos: EventoCrudo[],
): PagoDelHistorial[] {
  const porTransaccion = new Map<string, PagoDelHistorial>();

  for (const ev of eventos) {
    const estado = ESTADO_POR_EVENTO[ev.eventType];
    if (!estado) continue; // no habla de dinero

    const data = (ev.payload as any)?.data ?? {};
    const compra = data.purchase ?? {};
    const transaccion: string | null = compra.transaction ?? null;

    // Sin transacción no podemos deduplicar. Cae a la fecha del evento, que
    // al menos no colisiona con otro cobro.
    const clave = transaccion ?? `evt:${ev.processedAt.toISOString()}`;

    const aprobado = fechaHotmart(compra.approved_date);
    const pedido = fechaHotmart(compra.order_date);
    const fecha =
      (estado === 'PAGADO' ? aprobado : null) ??
      pedido ??
      aprobado ??
      ev.processedAt;

    const fila: PagoDelHistorial = {
      id: `hotmart:${clave}`,
      fecha,
      origen: 'HOTMART',
      estado,
      monto:
        numero(compra.full_price?.value) ?? numero(compra.price?.value) ?? null,
      moneda:
        compra.full_price?.currency_value ??
        compra.price?.currency_value ??
        null,
      montoUsd:
        compra.original_offer_price?.currency_value === 'USD'
          ? numero(compra.original_offer_price?.value)
          : compra.full_price?.currency_value === 'USD'
            ? numero(compra.full_price?.value)
            : null,
      metodo: metodoLegible(compra.payment?.type),
      motivo:
        estado === 'RECHAZADO'
          ? (compra.payment?.refusal_reason ?? null)
          : null,
      referencia: transaccion,
      numeroDeCobro: numero(compra.recurrence_number),
      cubreDesde: null,
      cubreHasta: null,
      nota: null,
    };

    const previo = porTransaccion.get(clave);
    if (!previo || PESO[fila.estado] > PESO[previo.estado]) {
      porTransaccion.set(clave, fila);
    }
  }

  return [...porTransaccion.values()];
}

/**
 * Lectura del historial: ¿está pagando como corresponde?
 *
 * `cobrosFallidos` cuenta solo los rechazos POSTERIORES al último pago bueno.
 * Un rechazo viejo que después se resolvió no es un problema abierto, y
 * contarlo haría sonar la alarma en negocios que están al día.
 */
export function resumirHistorial(pagos: PagoDelHistorial[]) {
  const ordenados = [...pagos].sort(
    (a, b) => b.fecha.getTime() - a.fecha.getTime(),
  );
  const ultimoPago = ordenados.find((p) => p.estado === 'PAGADO') ?? null;

  const desde = ultimoPago ? ultimoPago.fecha.getTime() : -Infinity;
  const fallidosAbiertos = ordenados.filter(
    (p) =>
      (p.estado === 'RECHAZADO' || p.estado === 'EXPIRADO') &&
      p.fecha.getTime() > desde,
  );

  const pagados = ordenados.filter((p) => p.estado === 'PAGADO');

  return {
    totalCobros: ordenados.length,
    pagosCorrectos: pagados.length,
    ultimoPagoEn: ultimoPago?.fecha ?? null,
    ultimoPagoMonto: ultimoPago?.monto ?? null,
    ultimoPagoMoneda: ultimoPago?.moneda ?? null,
    cobrosFallidos: fallidosAbiertos.length,
    /** Motivo del rechazo más reciente sin resolver — el dato accionable. */
    ultimoRechazoMotivo: fallidosAbiertos[0]?.motivo ?? null,
    ultimoRechazoEn: fallidosAbiertos[0]?.fecha ?? null,
    reembolsos: ordenados.filter((p) => p.estado === 'REEMBOLSADO').length,
    contracargos: ordenados.filter((p) => p.estado === 'CONTRACARGO').length,
  };
}
