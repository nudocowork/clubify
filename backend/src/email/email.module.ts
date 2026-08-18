import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { BrandEmailService } from './brand-email.service';
import { ConsoleEmailAdapter } from './adapters/console.adapter';
import { ResendAdapter } from './adapters/resend.adapter';

@Global()
@Module({
  providers: [
    EmailService,
    BrandEmailService,
    ConsoleEmailAdapter,
    ResendAdapter,
  ],
  exports: [EmailService, BrandEmailService],
})
export class EmailModule {}
