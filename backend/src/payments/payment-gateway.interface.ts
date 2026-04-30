import { Order, Tenant } from '@prisma/client';

export type PaymentSession = {
  /** ID de la transacción/intent del proveedor */
  reference: string;
  /** URL a la cual redirigir al cliente para completar el pago */
  url: string;
  /** Provider canonical id ("stub", "stripe", "mercado_pago", "wompi") */
  provider: string;
};

export type PaymentWebhookResult = {
  reference: string;
  status: 'PAID' | 'FAILED' | 'REFUNDED';
  rawPayload: any;
};

export interface IPaymentGateway {
  /** Identificador interno: 'stub' | 'stripe' | 'mercado_pago' | 'wompi' */
  readonly id: string;

  /** Crea la sesión de pago y devuelve la URL para redirigir al cliente. */
  createSession(args: {
    order: Order;
    tenant: Tenant;
    successUrl: string;
    cancelUrl: string;
    webhookUrl: string;
  }): Promise<PaymentSession>;

  /** Procesa un webhook entrante del proveedor y devuelve cómo cambió el estado. */
  parseWebhook(headers: Record<string, any>, rawBody: any): Promise<PaymentWebhookResult>;
}
