import { Injectable, Logger } from '@nestjs/common';
import {
  IEmailAdapter,
  EmailMessage,
  EmailSenderOverride,
} from '../email.interface';

/**
 * Adapter Resend (https://resend.com).
 *
 * Sin dependencia npm — usa fetch directo a la API REST.
 * Activar con RESEND_API_KEY en .env. Resend tiene plan free 3,000 emails/mes.
 *
 * `sender.apiKey` permite enviar con la cuenta de una MARCA blanca en vez de la
 * de la plataforma (cada marca tiene su propia cuenta y dominio verificado).
 */
@Injectable()
export class ResendAdapter implements IEmailAdapter {
  readonly id = 'resend';
  private logger = new Logger('Email');

  async send(msg: EmailMessage, sender?: EmailSenderOverride) {
    const apiKey = sender?.apiKey?.trim() || process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY no configurado');

    const from =
      msg.from ?? process.env.SMTP_FROM ?? 'Clubify <noreply@soyclubify.com>';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(15000), // review: timeout envío email
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      this.logger.error(`Resend ${res.status}: ${txt}`);
      throw new Error(`Resend send failed: ${res.status}`);
    }
    const j = await res.json();
    return { id: j.id, provider: this.id };
  }
}
