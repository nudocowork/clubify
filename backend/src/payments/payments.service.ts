import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { IPaymentGateway } from './payment-gateway.interface';
import { StubGateway } from './adapters/stub.gateway';
import { StripeGateway } from './adapters/stripe.gateway';
import { MercadoPagoGateway } from './adapters/mercadopago.gateway';
import { WompiGateway } from './adapters/wompi.gateway';

const METHOD_TO_PROVIDER: Partial<Record<PaymentMethod, string>> = {
  STUB: 'stub',
  STRIPE: 'stripe',
  MERCADO_PAGO: 'mercado_pago',
  WOMPI: 'wompi',
  PSE: 'wompi', // PSE colombiano se enruta vía Wompi por defecto
  CASH_ON_DELIVERY: undefined,
};

@Injectable()
export class PaymentsService {
  private logger = new Logger(PaymentsService.name);
  private gateways: Record<string, IPaymentGateway>;

  constructor(
    private prisma: PrismaService,
    stub: StubGateway,
    stripe: StripeGateway,
    mp: MercadoPagoGateway,
    wompi: WompiGateway,
  ) {
    this.gateways = {
      [stub.id]: stub,
      [stripe.id]: stripe,
      [mp.id]: mp,
      [wompi.id]: wompi,
    };
  }

  /** Devuelve los métodos de pago habilitados según las env vars. */
  availableMethods(): { method: PaymentMethod; label: string; ready: boolean }[] {
    const has = (k: string) => !!process.env[k];
    return [
      { method: 'CASH_ON_DELIVERY', label: 'Pago contra entrega / al recoger', ready: true },
      { method: 'STUB', label: 'Demo (stub)', ready: true },
      { method: 'STRIPE', label: 'Stripe (tarjeta)', ready: has('STRIPE_SECRET_KEY') },
      { method: 'MERCADO_PAGO', label: 'Mercado Pago', ready: has('MERCADO_PAGO_ACCESS_TOKEN') },
      { method: 'WOMPI', label: 'Wompi (Colombia)', ready: has('WOMPI_PRIVATE_KEY') },
      { method: 'PSE', label: 'PSE (vía Wompi)', ready: has('WOMPI_PRIVATE_KEY') },
    ];
  }

  /**
   * Inicia un pago para una orden ya creada.
   * Devuelve `paymentUrl` al cual debe redirigirse el cliente.
   */
  async startPayment(orderId: string, method: PaymentMethod) {
    if (method === 'CASH_ON_DELIVERY') {
      throw new BadRequestException('Este método no requiere flujo de pago en línea');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { tenant: true },
    });
    if (!order) throw new NotFoundException();

    const providerId = METHOD_TO_PROVIDER[method];
    if (!providerId) throw new BadRequestException('Método de pago no soportado');
    const gateway = this.gateways[providerId];
    if (!gateway) throw new BadRequestException(`Gateway ${providerId} no registrado`);

    const apiUrl = process.env.API_URL ?? 'http://localhost:4949';
    const appUrl = process.env.APP_URL ?? 'http://localhost:4848';

    const session = await gateway.createSession({
      order,
      tenant: order.tenant,
      successUrl: `${appUrl}/o/${order.code}?paid=1`,
      cancelUrl: `${appUrl}/o/${order.code}?paid=0`,
      webhookUrl: `${apiUrl}/api/public/payments/webhook/${providerId}`,
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: 'PENDING',
        paymentMethod: method,
        paymentProvider: providerId,
        paymentRef: session.reference,
        paymentUrl: session.url,
      },
    });

    return {
      paymentUrl: session.url,
      reference: session.reference,
      provider: providerId,
    };
  }

  /**
   * Marca el pago de una orden como completado/fallido.
   * Llamado desde webhook o desde la simulación stub.
   */
  async confirmPayment(args: {
    provider: string;
    reference: string;
    status: 'PAID' | 'FAILED' | 'REFUNDED';
  }) {
    const order = await this.prisma.order.findFirst({
      where: { paymentProvider: args.provider, paymentRef: args.reference },
    });
    if (!order) throw new NotFoundException(`Orden con ref=${args.reference} no encontrada`);

    const next: PaymentStatus =
      args.status === 'PAID'
        ? 'PAID'
        : args.status === 'FAILED'
        ? 'FAILED'
        : 'REFUNDED';

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        paymentStatus: next,
        paidAt: next === 'PAID' ? new Date() : order.paidAt,
      },
    });

    await this.prisma.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'STATUS_CHANGED',
        metadata: { payment: args.status, provider: args.provider, reference: args.reference },
      },
    });

    return updated;
  }

  async handleWebhook(provider: string, headers: Record<string, any>, body: any) {
    const gw = this.gateways[provider];
    if (!gw) throw new NotFoundException(`provider ${provider}`);
    const result = await gw.parseWebhook(headers, body);
    if (!result.reference) throw new BadRequestException('reference vacío');
    return this.confirmPayment({
      provider,
      reference: result.reference,
      status: result.status,
    });
  }
}
