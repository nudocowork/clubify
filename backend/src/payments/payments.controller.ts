import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { OrdersGateway } from '../orders/orders.gateway';

@Controller('public/payments')
export class PublicPaymentsController {
  constructor(
    private svc: PaymentsService,
    private prisma: PrismaService,
    private gateway: OrdersGateway,
  ) {}

  @Public()
  @Get('methods')
  methods() {
    return this.svc.availableMethods();
  }

  /**
   * Inicia un pago para una orden ya creada (cliente público).
   * Body: { method: PaymentMethod }
   */
  @Public()
  @Post('start/:code')
  async start(
    @Param('code') code: string,
    @Body() body: { method: PaymentMethod },
  ) {
    const order = await this.prisma.order.findUnique({ where: { code } });
    if (!order) throw new NotFoundException();
    return this.svc.startPayment(order.id, body.method);
  }

  /**
   * Webhook genérico — un endpoint por proveedor.
   * Stub: body = { reference, status: 'success' | 'cancel' }
   */
  @Public()
  @Post('webhook/:provider')
  async webhook(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, any>,
    @Body() body: any,
  ) {
    const updated = await this.svc.handleWebhook(provider, headers, body);
    // Notifica al kanban en tiempo real
    this.gateway.broadcastOrderUpsert(updated.tenantId, updated);
    return { ok: true, paymentStatus: updated.paymentStatus };
  }

  /**
   * Endpoint usado por la página stub `/pay/[code]` para confirmar el pago.
   */
  @Public()
  @Post('stub/confirm/:code')
  async stubConfirm(
    @Param('code') code: string,
    @Body() body: { reference: string; outcome: 'success' | 'cancel' },
  ) {
    const order = await this.prisma.order.findUnique({ where: { code } });
    if (!order) throw new NotFoundException();
    const updated = await this.svc.confirmPayment({
      provider: 'stub',
      reference: body.reference,
      status: body.outcome === 'success' ? 'PAID' : 'FAILED',
    });
    this.gateway.broadcastOrderUpsert(updated.tenantId, updated);
    return { ok: true, paymentStatus: updated.paymentStatus };
  }
}
