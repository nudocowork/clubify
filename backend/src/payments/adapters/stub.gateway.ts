import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  IPaymentGateway,
  PaymentSession,
  PaymentWebhookResult,
} from '../payment-gateway.interface';
import { Order, Tenant } from '@prisma/client';

/**
 * Gateway "stub" para desarrollo y demo.
 *
 * Genera una URL `/pay/:code?session=...` que renderiza una página de simulación
 * en el frontend; al confirmar, dispara el webhook localmente.
 *
 * En producción, reemplazar por StripeGateway / MercadoPagoGateway / WompiGateway.
 */
@Injectable()
export class StubGateway implements IPaymentGateway {
  readonly id = 'stub';

  async createSession(args: {
    order: Order;
    tenant: Tenant;
    successUrl: string;
    cancelUrl: string;
    webhookUrl: string;
  }): Promise<PaymentSession> {
    const reference = `STUB-${randomBytes(8).toString('hex').toUpperCase()}`;
    const appUrl = process.env.APP_URL ?? 'http://localhost:4848';
    return {
      provider: this.id,
      reference,
      url: `${appUrl}/pay/${args.order.code}?ref=${reference}`,
    };
  }

  async parseWebhook(
    _headers: Record<string, any>,
    rawBody: any,
  ): Promise<PaymentWebhookResult> {
    return {
      reference: rawBody?.reference,
      status: rawBody?.status === 'cancel' ? 'FAILED' : 'PAID',
      rawPayload: rawBody,
    };
  }
}
