import { Global, Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailService } from './email.service';
import { BrandEmailService } from './brand-email.service';
import { ConsoleEmailAdapter } from './adapters/console.adapter';
import { ResendAdapter } from './adapters/resend.adapter';

@Global()
@Module({
  // Los correos de marca salen por Grow Business, igual que el SMS.
  imports: [IntegrationsModule],
  providers: [
    EmailService,
    BrandEmailService,
    ConsoleEmailAdapter,
    ResendAdapter,
  ],
  exports: [EmailService, BrandEmailService],
})
export class EmailModule {}
