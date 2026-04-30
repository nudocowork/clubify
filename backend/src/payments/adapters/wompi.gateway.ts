import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  PaymentSession,
  PaymentWebhookResult,
} from '../payment-gateway.interface';
import { Order, Tenant } from '@prisma/client';

/**
 * Wompi (Bancolombia, Colombia).
 *
 * Para activar:
 *   1. WOMPI_PUBLIC_KEY=pub_test_... y WOMPI_PRIVATE_KEY en .env
 *   2. Implementar createSession con POST https://production.wompi.co/v1/transactions
 *      o usando el Widget de pago (más sencillo: redirigir a checkout pre-firmado).
 *   3. Webhook: validar `events.signature.checksum` con SHA-256 y secret.
 *      Soporta PSE, Bancolombia button, tarjetas, Nequi.
 */
@Injectable()
export class WompiGateway implements IPaymentGateway {
  readonly id = 'wompi';
  private logger = new Logger(WompiGateway.name);

  async createSession(_args: {
    order: Order;
    tenant: Tenant;
    successUrl: string;
    cancelUrl: string;
    webhookUrl: string;
  }): Promise<PaymentSession> {
    this.logger.warn('WompiGateway.createSession no implementado');
    throw new Error(
      'WOMPI_NOT_CONFIGURED — añade WOMPI_PUBLIC_KEY/WOMPI_PRIVATE_KEY al .env e implementa WompiGateway.',
    );
  }

  async parseWebhook(
    _headers: Record<string, any>,
    _rawBody: any,
  ): Promise<PaymentWebhookResult> {
    throw new Error('WOMPI_NOT_CONFIGURED');
  }
}
