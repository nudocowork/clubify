import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { MktProviderService } from './provider/mkt-provider.service';
import { SendResult } from './provider/mkt-provider.util';
import { backoffMinutes } from './mkt-workflow.util';
import { EmailEventKind, stampColumn } from './webhook.util';

type ActionRow = {
  id: string;
  whiteLabelId: string;
  channel: string;
  attempts: number;
  subject: string | null;
  body: string | null;
  payload: unknown;
};

/**
 * Envío CON ESTADO + cola de reintentos. Una acción = una fila (`MktAction`).
 *
 * El reintento lee el ESTADO (`status='retrying'`), NO atrapa excepciones: los
 * nodos de envío nunca lanzan (registran el fallo y siguen para no frenar los
 * otros canales), así que un try/catch alrededor del bucle jamás vería el fallo.
 *
 * Los errores PERMANENTES (cuerpo vacío, sin destinatario, opt-out) los detecta
 * el envoltorio del proveedor ANTES de llamar al proveedor y devuelven
 * `skipped` → se marcan `skipped` (sin gastar los 3 reintentos).
 */
@Injectable()
export class MktActionService {
  private readonly log = new Logger('MktAction');

  constructor(
    private prisma: PrismaService,
    private provider: MktProviderService,
  ) {}

  /** Ejecuta un envío nuevo con estado: crea la fila, envía una vez y la resuelve. */
  async dispatch(input: {
    workflowId: string;
    enrollmentId: string;
    contactId: string;
    whiteLabelId: string;
    nodeId: string;
    channel: 'email' | 'sms';
    to: string;
    subject?: string | null;
    body: string;
  }) {
    const action = await this.prisma.mktAction.create({
      data: {
        workflowId: input.workflowId,
        enrollmentId: input.enrollmentId,
        contactId: input.contactId,
        whiteLabelId: input.whiteLabelId,
        nodeId: input.nodeId,
        channel: input.channel,
        status: 'pending',
        subject: input.subject ?? null,
        body: input.body,
        // payload CONGELA lo necesario para reenviar idéntico.
        payload: { to: input.to, subject: input.subject ?? null, body: input.body, channel: input.channel },
      },
    });
    return this.runOnce(action);
  }

  /** Envía usando el payload congelado (idéntico en reintentos). */
  private send(a: ActionRow): Promise<SendResult> {
    const p = (a.payload as any) || {};
    const to = String(p.to ?? '');
    const body = String(p.body ?? a.body ?? '');
    if (a.channel === 'email') {
      return this.provider.sendEmail({
        whiteLabelId: a.whiteLabelId,
        toEmail: to,
        subject: String(p.subject ?? a.subject ?? ''),
        html: body,
      });
    }
    return this.provider.sendSms({ whiteLabelId: a.whiteLabelId, toPhone: to, message: body });
  }

  /** Marca processing (+1 intento), envía, y resuelve el estado final. */
  private async runOnce(a: { id: string }) {
    const claimed = (await this.prisma.mktAction.update({
      where: { id: a.id },
      data: { status: 'processing', attempts: { increment: 1 } },
    })) as unknown as ActionRow;
    const res = await this.send(claimed);
    return this.finish(claimed, res);
  }

  /** Aplica el resultado al estado: sent / skipped / retrying / failed. */
  private async finish(a: ActionRow, res: SendResult) {
    if (res.ok) {
      return this.prisma.mktAction.update({
        where: { id: a.id },
        data: {
          status: 'sent',
          error: null,
          providerMessageId: res.messageId ?? null,
          nextAttemptAt: null,
          completedAt: new Date(),
        },
      });
    }
    if (res.skipped) {
      // Error permanente: NO reintentar. Motivo accionable en `error`.
      return this.prisma.mktAction.update({
        where: { id: a.id },
        data: { status: 'skipped', error: res.error ?? 'Omitido', nextAttemptAt: null, completedAt: new Date() },
      });
    }
    const wait = backoffMinutes(a.attempts);
    if (wait == null) {
      return this.prisma.mktAction.update({
        where: { id: a.id },
        data: { status: 'failed', error: res.error ?? 'Error de envío', nextAttemptAt: null, completedAt: new Date() },
      });
    }
    return this.prisma.mktAction.update({
      where: { id: a.id },
      data: {
        status: 'retrying',
        error: res.error ?? 'Error de envío',
        nextAttemptAt: new Date(Date.now() + wait * 60000),
      },
    });
  }

  /**
   * Carril de reintentos: reenvía las acciones vencidas (`retrying` +
   * `nextAttemptAt<=now`). Claim atómico por fila (lease) para no doble-procesar
   * entre pods. Devuelve cuántas RESOLVIÓ (sent/failed/skipped), no cuántas
   * reenvió — si contáramos reenvíos, el cron reportaría 0 mientras vacía la cola.
   */
  async retryDue(limit = 100): Promise<number> {
    const due = await this.prisma.mktAction.findMany({
      where: { status: 'retrying', nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    let resolved = 0;
    for (const { id } of due) {
      // Claim: solo si sigue 'retrying' (otro pod pudo tomarla).
      const claim = await this.prisma.mktAction.updateMany({
        where: { id, status: 'retrying' },
        data: { status: 'processing', attempts: { increment: 1 } },
      });
      if (claim.count === 0) continue;
      const fresh = (await this.prisma.mktAction.findUnique({ where: { id } })) as unknown as ActionRow | null;
      if (!fresh) continue;
      const res = await this.send(fresh);
      const done = await this.finish(fresh, res);
      if (done.status === 'sent' || done.status === 'failed' || done.status === 'skipped') resolved++;
    }
    return resolved;
  }

  /**
   * Sella un evento entrante (entregado/abrió/clic/rebote) en su envío,
   * correlacionando por providerMessageId (respaldo: por email → último envío de
   * correo del contacto). Devuelve el contactId para reanudar interacciones.
   */
  async stampEvent(input: {
    whiteLabelId: string;
    messageId?: string;
    email?: string;
    kind: EmailEventKind;
  }): Promise<{ contactId: string | null }> {
    let action: { id: string; contactId: string } | null = null;
    if (input.messageId) {
      action = await this.prisma.mktAction.findFirst({
        where: { whiteLabelId: input.whiteLabelId, providerMessageId: input.messageId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, contactId: true },
      });
    }
    if (!action && input.email) {
      const c = await this.prisma.mktContact.findFirst({
        where: { whiteLabelId: input.whiteLabelId, email: input.email },
        select: { id: true },
      });
      if (c) {
        action = await this.prisma.mktAction.findFirst({
          where: { whiteLabelId: input.whiteLabelId, contactId: c.id, channel: 'email' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, contactId: true },
        });
      }
    }
    const col = stampColumn(input.kind);
    if (action && col) {
      await this.prisma.mktAction
        .update({ where: { id: action.id }, data: { [col]: new Date() } })
        .catch(() => {});
    }
    return { contactId: action?.contactId ?? null };
  }
}
