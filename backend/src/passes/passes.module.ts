import { Module } from '@nestjs/common';
import { PassesService } from './passes.service';
import { PassesController } from './passes.controller';
import { WalletModule } from '../wallet/wallet.module';
import { AutomationsModule } from '../automations/automations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { JobsModule } from '../jobs/jobs.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    WalletModule,
    AutomationsModule,
    CatalogModule,
    JobsModule,
    // Para MANDARLE al cliente el enlace de su tarjeta al emitirla desde el
    // panel: sin ese SMS, «emitir» creaba el pase y nadie se lo contaba.
    IntegrationsModule,
  ],
  providers: [PassesService],
  controllers: [PassesController],
  exports: [PassesService],
})
export class PassesModule {}
