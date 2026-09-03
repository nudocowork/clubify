export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

/**
 * Credenciales por llamada. Sin esto el adapter usa las de la PLATAFORMA
 * (env RESEND_API_KEY). Con esto envía desde la cuenta de una MARCA blanca
 * (ver `brand-email-creds.util.ts`), que es lo normal para todo correo de un
 * negocio: la marca manda desde su propio dominio, nunca desde el de Clubify.
 */
export type EmailSenderOverride = {
  apiKey?: string;
};

export interface IEmailAdapter {
  readonly id: string;
  send(
    msg: EmailMessage,
    sender?: EmailSenderOverride,
  ): Promise<{ id?: string; provider: string }>;
}
