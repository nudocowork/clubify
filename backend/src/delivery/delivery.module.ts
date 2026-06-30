import { Module } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { DeliveryAdminController } from './delivery-admin.controller';
import { DeliveryPortalController } from './delivery-portal.controller';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * Red de Domicilios (Fase 1). PrismaService y AuditService son globales;
 * IntegrationsModule provee GrowBusinessService para avisar a la empresa.
 * Exporta DeliveryService para que OrdersModule dispare el ciclo de vida.
 */
@Module({
  imports: [IntegrationsModule],
  providers: [DeliveryService],
  controllers: [DeliveryAdminController, DeliveryPortalController],
  exports: [DeliveryService],
})
export class DeliveryModule {}
