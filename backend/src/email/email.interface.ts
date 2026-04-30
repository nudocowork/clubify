export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

export interface IEmailAdapter {
  readonly id: string;
  send(msg: EmailMessage): Promise<{ id?: string; provider: string }>;
}
