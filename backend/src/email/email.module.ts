import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ConsoleEmailAdapter } from './adapters/console.adapter';
import { ResendAdapter } from './adapters/resend.adapter';

@Global()
@Module({
  providers: [EmailService, ConsoleEmailAdapter, ResendAdapter],
  exports: [EmailService],
})
export class EmailModule {}
