import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PublicPaymentsController } from './payments.controller';
import { StubGateway } from './adapters/stub.gateway';
import { StripeGateway } from './adapters/stripe.gateway';
import { MercadoPagoGateway } from './adapters/mercadopago.gateway';
import { WompiGateway } from './adapters/wompi.gateway';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  providers: [
    PaymentsService,
    StubGateway,
    StripeGateway,
    MercadoPagoGateway,
    WompiGateway,
  ],
  controllers: [PublicPaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
