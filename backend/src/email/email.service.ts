import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IEmailAdapter, EmailMessage } from './email.interface';
import { ConsoleEmailAdapter } from './adapters/console.adapter';
import { ResendAdapter } from './adapters/resend.adapter';

@Injectable()
export class EmailService implements OnModuleInit {
  private adapter!: IEmailAdapter;
  private logger = new Logger(EmailService.name);

  constructor(
    private console: ConsoleEmailAdapter,
    private resend: ResendAdapter,
  ) {}

  onModuleInit() {
    if (process.env.RESEND_API_KEY) {
      this.adapter = this.resend;
      this.logger.log('Email provider: Resend');
    } else {
      this.adapter = this.console;
      this.logger.log('Email provider: Console (no RESEND_API_KEY)');
    }
  }

  /** Envía un email best-effort: nunca tira la transacción que lo invoca. */
  async send(msg: EmailMessage) {
    try {
      return await this.adapter.send(msg);
    } catch (e: any) {
      this.logger.warn(`Email send failed (${msg.subject}): ${e?.message ?? e}`);
      return null;
    }
  }
}
