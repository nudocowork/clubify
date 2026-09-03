/**
 * Payment Engine — interfaz común de pasarelas de pago (semilla).
 *
 * Hoy Clubify tiene Hotmart y Stripe como servicios separados (cada uno con su
 * propio `activate`), acoplados al modelo "una pasarela por marca". Esta interfaz
 * es la base para desacoplar eso: cualquier pasarela nueva la implementa y el
 * sistema la trata igual (crear checkout, verificar webhook, mapear estado).
 *
 * IMPORTANTE (Fase 1): SOLO `CrossService` la implementa. Hotmart y Stripe NO se
 * refactorizan todavía a esta interfaz (para no arriesgar lo que ya funciona en
 * producción). La activación real del tenant NO vive acá: se hace con los helpers
 * compartidos (`emitBusinessActivated`, `auditLifecycle`, `clearCreditRelease`)
 * que ya usan Hotmart y Stripe, para no duplicar la lógica de activación.
 */

/** Estado de pago normalizado, independiente del proveedor. */
export type NormalizedPaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/** Datos para iniciar un checkout server-side (crear cargo). */
/** Datos de tarjeta (API directa). El backend los reenvía a Cross; NO se
 *  persisten. Ver nota PCI en el checkout. */
export interface CardInput {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  holderName?: string;
}

export interface CreateCheckoutInput {
  brandSlug: string;
  email: string;
  /** Nombre del comprador (Cross lo exige como customerName). */
  customerName?: string;
  /** Documento del comprador (Cross identifica al comprador por documento). */
  document?: string;
  phone?: string;
  amountUsd: number;
  currency?: string;
  description?: string;
  /** Referencia interna nuestra para trazar el pago (idempotencia de negocio). */
  reference?: string;
  /** A dónde vuelve el usuario tras pagar / tras el desafío 3-D Secure. */
  redirectUrl?: string;
  /** Datos de tarjeta (API directa). Si falta, el proveedor decide el flujo. */
  card?: CardInput;
  metadata?: Record<string, unknown>;
}

/** Resultado del checkout. `redirectUrl` puede venir vacío si el cobro se
 *  aprobó/definió inline (sin 3-D Secure). */
export interface CheckoutResult {
  ok: boolean;
  providerRef?: string;
  /** URL a la que redirigir (3-D Secure / confirmación). Puede ser ''. */
  redirectUrl?: string;
  status?: NormalizedPaymentStatus;
  message?: string;
}

/** Evento de webhook ya verificado y normalizado. */
export interface NormalizedWebhookEvent {
  /** Tipo de evento del proveedor. */
  event: string;
  /** id/transactionId del proveedor (clave de idempotencia). */
  providerRef: string;
  /** Estado crudo del proveedor. */
  providerStatus: string;
  /** Estado normalizado. */
  status: NormalizedPaymentStatus;
}

/**
 * Contrato mínimo de una pasarela. Cada método es best-effort/seguro: devolver
 * null cuando la marca no está configurada o la firma no valida.
 */
export interface PaymentProvider {
  /** Nombre del gateway (coincide con el enum PaymentGateway). */
  readonly gateway: 'CROSS' | 'STRIPE' | 'HOTMART';

  /** Crea el cobro y devuelve el resultado (ok/redirectUrl/status/message). */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;

  /**
   * Verifica la autenticidad del webhook (firma) usando el RAW body y devuelve
   * el evento normalizado, o null si la firma es inválida / marca no configurada.
   */
  verifyAndParseWebhook(
    slug: string,
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<NormalizedWebhookEvent | null>;

  /** Mapea un estado crudo del proveedor a uno normalizado. */
  mapStatus(providerStatus: string): NormalizedPaymentStatus;
}
