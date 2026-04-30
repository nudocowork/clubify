import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  PaymentSession,
  PaymentWebhookResult,
} from '../payment-gateway.interface';
import { Order, Tenant } from '@prisma/client';

/**
 * Mercado Pago (no implementado todavía).
 *
 * Para activar:
 *   1. npm i mercadopago
 *   2. MERCADO_PAGO_ACCESS_TOKEN=APP_USR-... en .env
 *   3. Implementar createSession con preference.create({ items, back_urls, auto_return, notification_url })
 *   4. Webhook: validar `x-signature` y consultar payment con mercadopago.payment.findById(paymentId).
 */
@Injectable()
export class MercadoPagoGateway implements IPaymentGateway {
  readonly id = 'mercado_pago';
  private logger = new Logger(MercadoPagoGateway.name);

  async createSession(_args: {
    order: Order;
    tenant: Tenant;
    successUrl: string;
    cancelUrl: string;
    webhookUrl: string;
  }): Promise<PaymentSession> {
    this.logger.warn('MercadoPagoGateway.createSession no implementado');
    throw new Error(
      'MERCADO_PAGO_NOT_CONFIGURED — añade MERCADO_PAGO_ACCESS_TOKEN al .env e implementa MercadoPagoGateway.',
    );
  }

  async parseWebhook(
    _headers: Record<string, any>,
    _rawBody: any,
  ): Promise<PaymentWebhookResult> {
    throw new Error('MERCADO_PAGO_NOT_CONFIGURED');
  }
}
