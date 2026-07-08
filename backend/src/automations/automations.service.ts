import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AutomationRunStatus, ChannelType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ChannelsService } from '../channels/channels.service';
import { WalletService } from '../wallet/wallet.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import {
  brandGrowCreds,
  BRAND_GROW_SELECT,
} from '../integrations/brand-sms-creds.util';

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
  | 'ORDER_RATED'
  | 'BIRTHDAY'
  | 'NEAR_REWARD'
  | 'COUPON_REDEEMED';

export type Trigger = { type: AutomationEvent; days?: number };
export type Condition = { field: string; op: 'eq' | 'gt' | 'lt' | 'in' | 'contains'; value: any };
export type Action =
  | { type: 'SEND_WHATSAPP_LINK'; templateId?: string; body: string }
  | { type: 'SEND_SMS'; body: string }
  | { type: 'SEND_WHATSAPP'; body: string }
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
    private wallet: WalletService,
    private growBusiness: GrowBusinessService,
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

  async list(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.automationRule.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: AuthUser, dto: RuleDto, override?: string) {
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
      // SMS / WhatsApp server-side vía Grow Business. AISLAMIENTO POR MARCA:
      // se envía desde las creds propias del negocio, o si no tiene, desde la
      // subcuenta GHL de SU marca blanca. NUNCA cae a Clubify ni a otra marca;
      // sin creds → no se envía (se registra y sigue).
      case 'SEND_SMS':
      case 'SEND_WHATSAPP': {
        if (!customerId) {
          this.logger.warn(
            `${action.type} (rule ${ruleId}) sin customerId — se omite`,
          );
          break;
        }
        const customer = await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { phone: true },
        });
        const phone = customer?.phone?.trim();
        if (!phone) {
          this.logger.warn(
            `${action.type} (rule ${ruleId}) cliente sin teléfono — se omite`,
          );
          break;
        }
        const creds = await this.resolveCustomerSmsCreds(tenantId);
        if (!creds) {
          this.logger.warn(
            `${action.type} (rule ${ruleId}) sin credenciales Grow Business (negocio ni marca) — se omite`,
          );
          break;
        }
        const body = await this.renderTemplate(action.body, payload);
        if (action.type === 'SEND_SMS') {
          await this.growBusiness.sendSmsWithCreds(creds, phone, body);
        } else {
          await this.growBusiness.sendWhatsAppWithCreds(
            { locationId: creds.locationId, apiKey: creds.apiKey },
            phone,
            body,
          );
        }
        break;
      }
      case 'SEND_PUSH': {
        // FIX: antes de Fase C+5, las plantillas con {{customerName}},
        // {{businessName}}, {{cardName}}, {{rewardText}}, etc. se guardaban
        // verbatim — el cliente recibía el push con `{{customerName}}` literal.
        const title = await this.renderTemplate(action.title, payload);
        const body = await this.renderTemplate(action.body, payload);

        // CRÍTICO (cumpleaños / inactividad / cerca-recompensa, etc.):
        // el push de una automatización es INDIVIDUAL — debe llegar SOLO
        // al pase del cliente que disparó el evento, NUNCA a todas las
        // wallets del tenant. Si por algún motivo no hay customerId, NO
        // hacemos broadcast: registramos y salimos para no felicitar a
        // todos los clientes.
        if (!customerId) {
          this.logger.warn(
            `SEND_PUSH (rule ${ruleId}) sin customerId — se omite para evitar broadcast`,
          );
          await this.prisma.notification.create({
            data: {
              tenantId,
              title,
              body,
              triggerType: 'AUTOMATION',
              sentAt: new Date(),
              stats: { targeted: 0, skipped: 'no-customer' },
            },
          });
          break;
        }

        // ORDEN IMPORTANTE: creamos la Notification ANTES de pushear. El pase
        // Apple, al re-armarse en pushPassUpdate, lee la ÚLTIMA Notification del
        // cliente para el campo `lastMessage` (lockscreen). Si la creáramos
        // después, el iPhone mostraría el mensaje ANTERIOR, no este saludo.
        // DESTINATARIO individual (customerId) → el pase de OTROS clientes nunca
        // muestra este saludo personalizado.
        const notif = await this.prisma.notification.create({
          data: {
            tenantId,
            customerId,
            title,
            body,
            triggerType: 'AUTOMATION',
            sentAt: new Date(),
            stats: { customerId },
          },
        });

        // Pases ACTIVOS de ESTE cliente. El push se hace pase por pase:
        // nunca toca los pases de otros clientes.
        const passes = await this.prisma.pass.findMany({
          where: {
            tenantId,
            customerId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        let delivered = 0;
        for (const p of passes) {
          try {
            await this.prisma.pass.update({
              where: { id: p.id },
              data: { lastActivityAt: new Date() },
            });
            // Pasamos el texto renderizado: Apple lo muestra vía el campo
            // lastMessage (ya scopeado al cliente) y Google lo usa en el
            // addMessage (en vez del texto genérico de saldo/sellos).
            const r = await this.wallet.pushPassUpdate(p.id, {
              message: { header: title, body },
            });
            delivered += r?.sent ?? 0;
          } catch (e) {
            this.logger.warn(
              `SEND_PUSH pass ${p.id} (rule ${ruleId}) falló: ${(e as Error).message}`,
            );
          }
        }
        await this.prisma.notification.update({
          where: { id: notif.id },
          data: { stats: { targeted: passes.length, delivered, customerId } },
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

  /**
   * Credenciales Grow Business para enviar SMS/WhatsApp de una automatización,
   * AISLADAS POR MARCA: creds propias del negocio → subcuenta GHL de su marca
   * blanca → null. Nunca la cuenta de Clubify ni la de otra marca. Un negocio
   * de Clubify sin creds propias tampoco envía (mismo criterio de aislamiento).
   */
  private async resolveCustomerSmsCreds(tenantId: string): Promise<{
    locationId: string;
    apiKey: string;
    switchNumber: number | null;
  } | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        growBusinessLocationId: true,
        growBusinessApiKey: true,
        growBusinessSwitchNumber: true,
        whiteLabel: { select: BRAND_GROW_SELECT },
      },
    });
    if (tenant?.growBusinessLocationId && tenant.growBusinessApiKey) {
      return {
        locationId: tenant.growBusinessLocationId,
        apiKey: tenant.growBusinessApiKey,
        switchNumber: tenant.growBusinessSwitchNumber ?? null,
      };
    }
    return brandGrowCreds(tenant?.whiteLabel);
  }

  private async renderTemplate(body: string, payload: any) {
    if (!body) return body;
    let out = body;

    // Lookups async desde DB (legacy {{nombre}} y {{order_*}})
    if (payload.customerId && /\{\{(nombre|customer\.fullName)\}\}/.test(out)) {
      const c = await this.prisma.customer.findUnique({
        where: { id: payload.customerId },
      });
      out = out.replace(
        /\{\{nombre\}\}|\{\{customer\.fullName\}\}/g,
        c?.fullName ?? '',
      );
    }
    if (payload.orderId && /\{\{order_(code|total)\}\}/.test(out)) {
      const o = await this.prisma.order.findUnique({
        where: { id: payload.orderId },
      });
      out = out
        .replace(/\{\{order_code\}\}/g, o?.code ?? '')
        .replace(/\{\{order_total\}\}/g, String(Number(o?.total ?? 0)));
    }

    // Sustitución genérica de cualquier {{key}} o {{a.b}} contra el payload.
    // Cubre {{customerName}}, {{businessName}}, {{cardName}}, {{remaining}},
    // {{rewardText}} y cualquier campo nuevo que se agregue al payload sin
    // tener que mantener una whitelist.
    out = out.replace(/\{\{([\w.]+)\}\}/g, (raw, key: string) => {
      const value = key
        .split('.')
        .reduce<any>((obj, k) => (obj == null ? undefined : obj[k]), payload);
      return value === undefined || value === null ? raw : String(value);
    });

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

  // ========== Crons diarios ==========

  /**
   * Cron BIRTHDAY — todos los días a las 8am UTC.
   * Encuentra customers cuyo cumpleaños es HOY (mes/día) y emite el
   * evento. Si el tenant tiene una regla activa con trigger=BIRTHDAY,
   * dispara el saludo (push/SMS/WA según action).
   */
  @Cron('0 8 * * *')
  async cronBirthday() {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    // Postgres date_part para extraer mes/día sin importar el año
    const customers = await this.prisma.$queryRaw<
      Array<{ id: string; tenantId: string; fullName: string }>
    >`
      SELECT id, "tenantId", "fullName" FROM "Customer"
      WHERE "birthday" IS NOT NULL
        AND EXTRACT(MONTH FROM "birthday") = ${month}
        AND EXTRACT(DAY FROM "birthday") = ${day}
    `;
    this.logger.log(`cronBirthday: ${customers.length} cumpleañeros hoy`);

    // Cache businessName por tenant para evitar N queries
    const brandCache = new Map<string, string>();
    for (const c of customers) {
      let brand = brandCache.get(c.tenantId);
      if (brand === undefined) {
        const t = await this.prisma.tenant.findUnique({
          where: { id: c.tenantId },
          select: { brandName: true },
        });
        brand = t?.brandName ?? 'nuestro local';
        brandCache.set(c.tenantId, brand);
      }
      await this.emit('BIRTHDAY', {
        tenantId: c.tenantId,
        customerId: c.id,
        customerName: c.fullName,
        businessName: brand,
      }).catch(() => null);
    }
  }

  /**
   * Cron INACTIVITY — todos los días a las 9am UTC.
   * Encuentra customers que no tuvieron actividad en > 30 días (lastVisitDay
   * más viejo o null). Idempotente: solo dispara si lastVisitDay es
   * EXACTAMENTE el día 31 (o sea, ayer cayeron al umbral) — así un cliente
   * recibe el mensaje 1 vez, no todos los días después.
   */
  @Cron('0 9 * * *')
  async cronInactivity() {
    // Fecha de hace 30 días en formato YYYY-MM-DD
    const t = new Date();
    t.setDate(t.getDate() - 30);
    const targetDay = t.toISOString().slice(0, 10);

    const customers = await this.prisma.customer.findMany({
      where: { lastVisitDay: targetDay },
      select: {
        id: true,
        tenantId: true,
        fullName: true,
        lastVisitDay: true,
      },
    });
    this.logger.log(`cronInactivity: ${customers.length} customers cruzaron el umbral 30d`);
    for (const c of customers) {
      await this.emit('INACTIVITY', {
        tenantId: c.tenantId,
        customerId: c.id,
        customerName: c.fullName,
        daysSinceLastVisit: 30,
      }).catch(() => null);
    }
  }

  // ========== Plantillas pre-armadas ==========

  /**
   * Crea una regla a partir de una plantilla. La plantilla solo
   * provee defaults — el dueño puede después editar el body en
   * /app/automations.
   */
  async createFromTemplate(
    user: AuthUser,
    templateId: string,
    overrides: { cardId?: string } = {},
    tenantIdOverride?: string,
  ) {
    const tid = this.tid(user, tenantIdOverride);
    const tpl = AUTOMATION_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) throw new NotFoundException('Template');
    return this.prisma.automationRule.create({
      data: {
        tenantId: tid,
        name: tpl.name,
        description: tpl.description,
        trigger: tpl.trigger as any,
        conditions: (tpl.conditions ?? []) as any,
        actions: tpl.actions as any,
        isActive: true,
      },
    });
  }
}

// ─── Plantillas pre-armadas ───
// 5 plantillas listas para usar. Cada una crea un AutomationRule con un
// click. El dueño puede editar el texto después en /app/automations.
export const AUTOMATION_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: 'fidelizacion' | 'reactivacion' | 'ocasion';
  trigger: Trigger;
  conditions?: Condition[];
  actions: Action[];
}> = [
  {
    id: 'welcome',
    name: 'Bienvenida al inscribirse',
    description: 'Saluda al cliente apenas obtiene su primera tarjeta de fidelización.',
    emoji: '👋',
    category: 'fidelizacion',
    trigger: { type: 'PASS_CREATED' },
    actions: [
      {
        type: 'SEND_PUSH',
        title: '¡Bienvenido/a {{customerName}}! 🎉',
        body: 'Tu tarjeta {{cardName}} está activa. Empieza a sumar para tu primera recompensa.',
      },
    ],
  },
  {
    id: 'near-reward',
    name: 'Cerca de la recompensa',
    description: 'Avisa cuando al cliente le faltan 1-2 sellos para canjear su premio.',
    emoji: '🎯',
    category: 'fidelizacion',
    trigger: { type: 'NEAR_REWARD' },
    actions: [
      {
        type: 'SEND_PUSH',
        title: '¡Solo te faltan {{remaining}}! 🔥',
        body: 'Estás a {{remaining}} de obtener {{rewardText}}. ¡Pasá hoy!',
      },
    ],
  },
  {
    id: 'reward-ready',
    name: 'Premio listo para canjear',
    description: 'Notifica al cliente cuando completó el cartón y puede canjear.',
    emoji: '🎁',
    category: 'fidelizacion',
    trigger: { type: 'PASS_COMPLETED' },
    actions: [
      {
        type: 'SEND_PUSH',
        title: '🎁 ¡Premio desbloqueado!',
        body: '{{rewardText}} es tuyo. Canjealo en tu próxima visita.',
      },
    ],
  },
  {
    id: 'birthday',
    name: 'Saludo de cumpleaños',
    description: 'Push automático al cliente el día de su cumpleaños con un mensaje personalizado.',
    emoji: '🎂',
    category: 'ocasion',
    trigger: { type: 'BIRTHDAY' },
    actions: [
      {
        type: 'SEND_PUSH',
        title: '🎉 Feliz cumpleaños {{customerName}}',
        body: 'Ven a {{businessName}}, tenemos un obsequio para ti 🎁',
      },
    ],
  },
  {
    id: 'reactivation-30d',
    name: 'Reactivación 30 días',
    description: 'Mensaje a clientes que llevan 30 días sin visitarte para que vuelvan.',
    emoji: '💌',
    category: 'reactivacion',
    trigger: { type: 'INACTIVITY', days: 30 },
    actions: [
      {
        type: 'SEND_PUSH',
        title: 'Te extrañamos {{customerName}} 💌',
        body: 'Hace un mes que no nos vemos. Pasá esta semana y disfrutá de tu fidelidad.',
      },
    ],
  },
  {
    id: 'redeemed-thanks',
    name: 'Gracias post-canje',
    description: 'Agradece al cliente después de canjear su premio para mantener engagement.',
    emoji: '🙌',
    category: 'fidelizacion',
    trigger: { type: 'REWARD_REDEEMED' },
    actions: [
      {
        type: 'SEND_PUSH',
        title: '🙌 Gracias por canjear',
        body: '¡Esperamos que lo disfrutes! Empieza a sumar de nuevo, hay más recompensas esperandote.',
      },
    ],
  },
];
