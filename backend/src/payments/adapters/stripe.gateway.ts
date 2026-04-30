import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  PaymentSession,
  PaymentWebhookResult,
} from '../payment-gateway.interface';
import { Order, Tenant } from '@prisma/client';

/**
 * Stripe (no implementado todavía).
 *
 * Para activar:
 *   1. npm i stripe
 *   2. STRIPE_SECRET_KEY=sk_test_... en .env
 *   3. Implementar createSession con stripe.checkout.sessions.create({...})
 *      pasando line_items derivados de order.items y success/cancel URLs.
 *   4. Implementar parseWebhook verificando la firma con stripe.webhooks.constructEvent
 *      usando STRIPE_WEBHOOK_SECRET y rawBody.
 */
@Injectable()
export class StripeGateway implements IPaymentGateway {
  readonly id = 'stripe';
  private logger = new Logger(StripeGateway.name);

  async createSession(_args: {
    order: Order;
    tenant: Tenant;
    successUrl: string;
    cancelUrl: string;
    webhookUrl: string;
  }): Promise<PaymentSession> {
    this.logger.warn('StripeGateway.createSession no implementado — retornando stub');
    throw new Error(
      'STRIPE_NOT_CONFIGURED — añade STRIPE_SECRET_KEY al .env e implementa StripeGateway.',
    );
  }

  async parseWebhook(
    _headers: Record<string, any>,
    _rawBody: any,
  ): Promise<PaymentWebhookResult> {
    throw new Error('STRIPE_NOT_CONFIGURED');
  }
}
