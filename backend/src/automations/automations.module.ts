import { Module, forwardRef } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { ChannelsModule } from '../channels/channels.module';
import { WalletModule } from '../wallet/wallet.module';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [forwardRef(() => ChannelsModule), WalletModule, IntegrationsModule],
  providers: [AutomationsService],
  controllers: [AutomationsController],
  exports: [AutomationsService],
})
export class AutomationsModule {}
