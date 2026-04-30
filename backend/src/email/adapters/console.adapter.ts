import { Injectable, Logger } from '@nestjs/common';
import { IEmailAdapter, EmailMessage } from '../email.interface';

/**
 * Adapter de desarrollo: imprime el email a consola.
 * Útil para verificar que las plantillas se renderizan bien sin enviar nada real.
 */
@Injectable()
export class ConsoleEmailAdapter implements IEmailAdapter {
  readonly id = 'console';
  private logger = new Logger('Email');

  async send(msg: EmailMessage) {
    this.logger.log(`📧 [${msg.from ?? 'noreply@soyclubify.com'} → ${msg.to}] ${msg.subject}`);
    if (process.env.EMAIL_DEBUG === '1') {
      this.logger.log(`   text: ${msg.text?.slice(0, 200)}…`);
    }
    return { provider: this.id };
  }
}
