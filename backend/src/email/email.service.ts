import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IEmailAdapter, EmailMessage } from './email.interface';
import { ConsoleEmailAdapter } from './adapters/console.adapter';
import { ResendAdapter } from './adapters/resend.adapter';
import { BrandEmailCreds } from './brand-email-creds.util';

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

  /**
   * Envía con la conexión de una MARCA blanca (su cuenta Resend + su remitente).
   * `creds` viene de `brandEmailCreds(whiteLabel)`. Con `creds = null` cae a la
   * cuenta de PLATAFORMA — solo válido para Clubify; para una marca blanca sin
   * conexión el llamador debe abstenerse de enviar (ver BrandEmailService).
   *
   * Best-effort igual que `send`, pero devuelve `false` si no se pudo enviar
   * para que el llamador pueda loguear/reintentar con criterio.
   */
  async sendWithCreds(
    creds: BrandEmailCreds | null,
    msg: EmailMessage,
  ): Promise<boolean> {
    try {
      if (!creds) {
        await this.adapter.send(msg);
        return true;
      }
      // Con creds de marca siempre usamos Resend real: el adapter de consola
      // solo aplica cuando la plataforma no tiene proveedor configurado.
      await this.resend.send(
        { ...msg, from: creds.from, replyTo: creds.replyTo ?? msg.replyTo },
        { apiKey: creds.apiKey },
      );
      return true;
    } catch (e: any) {
      this.logger.warn(`Email send failed (${msg.subject}): ${e?.message ?? e}`);
      return false;
    }
  }

  /** Igual que `sendWithCreds` pero propaga el error — para el botón "Probar
   *  conexión" del Master Admin, donde el motivo del fallo debe verse. */
  async sendWithCredsOrThrow(creds: BrandEmailCreds | null, msg: EmailMessage) {
    if (!creds) return this.adapter.send(msg);
    return this.resend.send(
      { ...msg, from: creds.from, replyTo: creds.replyTo ?? msg.replyTo },
      { apiKey: creds.apiKey },
    );
  }
}
