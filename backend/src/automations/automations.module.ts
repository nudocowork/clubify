import { Module, forwardRef } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { ChannelsModule } from '../channels/channels.module';
import { WalletModule } from '../wallet/wallet.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FlujosService } from './flujo/flujos.service';
import { FlujosController } from './flujo/flujos.controller';

@Module({
  imports: [forwardRef(() => ChannelsModule), WalletModule, IntegrationsModule],
  providers: [AutomationsService, FlujosService],
  // FlujosController ANTES: sus rutas `automations/flujos/...` no deben caer en
  // el `automations/:id` de las reglas.
  controllers: [FlujosController, AutomationsController],
  exports: [AutomationsService],
})
export class AutomationsModule {}
