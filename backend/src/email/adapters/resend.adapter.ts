import { Injectable, Logger } from '@nestjs/common';
import { IEmailAdapter, EmailMessage } from '../email.interface';

/**
 * Adapter Resend (https://resend.com).
 *
 * Sin dependencia npm — usa fetch directo a la API REST.
 * Activar con RESEND_API_KEY en .env. Resend tiene plan free 3,000 emails/mes.
 */
@Injectable()
export class ResendAdapter implements IEmailAdapter {
  readonly id = 'resend';
  private logger = new Logger('Email');

  async send(msg: EmailMessage) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY no configurado');

    const from =
      msg.from ?? process.env.SMTP_FROM ?? 'Clubify <noreply@soyclubify.com>';

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
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
