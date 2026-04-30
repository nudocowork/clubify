import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AutomationRunStatus, ChannelType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ChannelsService } from '../channels/channels.service';

export type AutomationEvent =
  | 'STAMP_ADDED'
  | 'POINTS_REACHED'
  | 'INACTIVITY'
  | 'GEO_ENTER'
  | 'REWARD_REDEEMED'
  | 'PASS_CREATED'
  | 'PASS_COMPLETED'
  | 'ORDER_CREATED'
  | 'ORDER_CONFIRMED'
  | 'ORDER_DELIVERED'
  | 'BIRTHDAY';

export type Trigger = { type: AutomationEvent; days?: number };
export type Condition = { field: string; op: 'eq' | 'gt' | 'lt' | 'in' | 'contains'; value: any };
export type Action =
  | { type: 'SEND_WHATSAPP_LINK'; templateId?: string; body: string }
  | { type: 'SEND_PUSH'; title: string; body: string }
  | { type: 'ADD_STAMPS'; cardId?: string; amount: number }
  | { type: 'APPLY_PROMO'; promoId: string };

export type RuleDto = {
  name: string;
  description?: string;
  trigger: Trigger;
  conditions?: Condition[];
  actions: Action[];
  isActive?: boolean;
};

@Injectable()
export class AutomationsService {
  private logger = new Logger(AutomationsService.name);
  constructor(
    private prisma: PrismaService,
    private channels: ChannelsService,
  ) {}

  // ========== CRUD ==========

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.automationRule.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(user: AuthUser, dto: RuleDto, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.automationRule.create({
      data: {
        tenantId: tid,
        name: dto.name,
        description: dto.description ?? '',
        trigger: dto.trigger as any,
        conditions: (dto.conditions ?? []) as any,
        actions: dto.actions as any,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(user: AuthUser, id: string, dto: Partial<RuleDto>) {
    const r = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && r.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return this.prisma.automationRule.update({
      where: { id },
      data: {
        ...dto,
        trigger: dto.trigger ? (dto.trigger as any) : undefined,
        conditions: dto.conditions ? (dto.conditions as any) : undefined,
        actions: dto.actions ? (dto.actions as any) : undefined,
      },
    });
  }

  async remove(user: AuthUser, id: string) {
    const r = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!r) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && r.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.automationRule.delete({ where: { id } });
    return { ok: true };
  }

  // ========== Motor de eventos ==========

  /**
   * Llamado por otros módulos cuando ocurre un evento.
   * Busca reglas activas que matcheen y ejecuta sus acciones.
   * En MVP corre síncrono; en producción se mueve a BullMQ worker.
   */
  async emit(eventType: AutomationEvent, payload: any) {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        tenantId: payload.tenantId,
        isActive: true,
      },
    });

    for (const rule of rules) {
      const trigger = rule.trigger as Trigger;
      if (trigger.type !== eventType) continue;

      const conditions = (rule.conditions as Condition[]) ?? [];
      const ok = conditions.every((c) => this.matchCondition(c, payload));
      if (!ok) {
        await this.logRun(rule.id, payload, 'SKIPPED');
        continue;
      }

      try {
        for (const action of rule.actions as Action[]) {
          await this.executeAction(action, payload, rule.id);
        }
        await this.logRun(rule.id, payload, 'SUCCESS');
        await this.prisma.automationRule.update({
          where: { id: rule.id },
          data: {
            stats: {
              ...((rule.stats as any) ?? {}),
              runs: (((rule.stats as any)?.runs as number) ?? 0) + 1,
              lastRunAt: new Date().toISOString(),
            },
          },
        });
      } catch (e: any) {
        this.logger.error(`Rule ${rule.id} failed: ${e.message}`);
        await this.logRun(rule.id, payload, 'FAILED', e.message);
      }
    }
  }

  private matchCondition(c: Condition, payload: any): boolean {
    const v = (payload as any)[c.field];
    switch (c.op) {
      case 'eq':
        return v === c.value;
      case 'gt':
        return Number(v) > Number(c.value);
      case 'lt':
        return Number(v) < Number(c.value);
      case 'in':
        return Array.isArray(c.value) && c.value.includes(v);
      case 'contains':
        return typeof v === 'string' && v.includes(c.value);
      default:
        return false;
    }
  }

  private async executeAction(action: Action, payload: any, ruleId: string) {
    const tenantId = payload.tenantId;
    const customerId = payload.customerId;

    switch (action.type) {
      case 'SEND_WHATSAPP_LINK': {
        const body = await this.renderTemplate(action.body, payload);
        await this.channels.enqueueMessage({
          tenantId,
          customerId,
          channel: ChannelType.WHATSAPP_LINK,
          body,
          ruleId,
          templateId: action.templateId,
          metadata: { trigger: payload },
        });
        break;
      }
      case 'SEND_PUSH': {
        await this.prisma.notification.create({
          data: {
            tenantId,
            title: action.title,
            body: action.body,
            triggerType: 'AUTOMATION',
            sentAt: new Date(),
            stats: { targeted: customerId ? 1 : 0 },
          },
        });
        break;
      }
      case 'ADD_STAMPS': {
        // Añade sellos al pase del customer (de la tarjeta indicada o la primera del tenant)
        if (!customerId) break;
        const card =
          (action.cardId &&
            (await this.prisma.card.findUnique({ where: { id: action.cardId } }))) ||
          (await this.prisma.card.findFirst({
            where: { tenantId, type: 'STAMPS', isActive: true },
          }));
        if (!card) break;
        const pass = await this.prisma.pass.findUnique({
          where: { cardId_customerId: { cardId: card.id, customerId } },
        });
        if (!pass) break;
        await this.prisma.$transaction([
          this.prisma.stamp.create({
            data: {
              tenantId,
              passId: pass.id,
              customerId,
              action: 'STAMP',
              amount: action.amount,
              note: 'Por automation',
            },
          }),
          this.prisma.pass.update({
            where: { id: pass.id },
            data: { stampsCount: { increment: action.amount } },
          }),
        ]);
        break;
      }
      case 'APPLY_PROMO':
        // Stub — en MVP las promos se aplican automáticamente al cart, no por rule
        break;
    }
  }

  private async renderTemplate(body: string, payload: any) {
    // Reemplaza {{var}} con payload.var. Si pide {{customer.fullName}}, busca customer.
    let out = body;

    if (payload.customerId) {
      const c = await this.prisma.customer.findUnique({
        where: { id: payload.customerId },
      });
      out = out.replace(/\{\{nombre\}\}|\{\{customer\.fullName\}\}/g, c?.fullName ?? '');
    }
    if (payload.orderId) {
      const o = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
      });
      out = out
        .replace(/\{\{order_code\}\}/g, o?.code ?? '')
        .replace(/\{\{order_total\}\}/g, String(Number(o?.total ?? 0)));
    }
    return out;
  }

  private logRun(
    ruleId: string,
    payload: any,
    status: AutomationRunStatus,
    error?: string,
  ) {
    return this.prisma.automationRun.create({
      data: {
        ruleId,
        eventPayload: payload,
        status,
        error,
      },
    });
  }
}
