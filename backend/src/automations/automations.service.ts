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
import { plantillaEnIdioma } from './plantillas-en-ingles';
import { fechaLocal, horaLocal, restarDias } from './hora-local';

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

// ===== Fase B: workflows multipaso (secuencia con esperas) =====
export type WorkflowStep =
  | { type: 'SEND_SMS'; body: string }
  | { type: 'SEND_WHATSAPP'; body: string }
  | { type: 'SEND_PUSH'; title: string; body: string }
  | { type: 'WAIT'; unit: 'minutes' | 'hours' | 'days'; amount: number };

export type WorkflowDto = {
  name: string;
  description?: string;
  triggerType: AutomationEvent;
  triggerDays?: number;
  steps: WorkflowStep[];
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

  // ========== Workflows multipaso (Fase B) — CRUD ==========

  async listWorkflows(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.automationWorkflow.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createWorkflow(user: AuthUser, dto: WorkflowDto, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.automationWorkflow.create({
      data: {
        tenantId: tid,
        name: dto.name,
        description: dto.description ?? '',
        triggerType: dto.triggerType,
        triggerDays: dto.triggerDays ?? null,
        steps: (dto.steps ?? []) as any,
        isActive: dto.isActive ?? false,
      },
    });
  }

  async updateWorkflow(user: AuthUser, id: string, dto: Partial<WorkflowDto>) {
    const wf = await this.prisma.automationWorkflow.findUnique({ where: { id } });
    if (!wf) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && wf.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return this.prisma.automationWorkflow.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        description: dto.description ?? undefined,
        triggerType: dto.triggerType ?? undefined,
        triggerDays: dto.triggerDays === undefined ? undefined : dto.triggerDays,
        steps: dto.steps ? (dto.steps as any) : undefined,
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
      },
    });
  }

  async removeWorkflow(user: AuthUser, id: string) {
    const wf = await this.prisma.automationWorkflow.findUnique({ where: { id } });
    if (!wf) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && wf.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    await this.prisma.automationWorkflow.delete({ where: { id } });
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

    // Fase B: además de las reglas de 1 paso, este evento puede INSCRIBIR al
    // cliente en workflows multipaso (secuencias con esperas). Best-effort.
    await this.enrollForEvent(eventType, payload).catch((e) =>
      this.logger.warn(`enrollForEvent(${eventType}) falló: ${e?.message}`),
    );
  }

  /**
   * Inscribe al cliente del evento en los workflows activos cuyo disparador
   * coincide. Un pase por cliente por workflow (unique) — un re-disparo no
   * re-inscribe (se afinará en un incremento posterior). El primer paso corre
   * en el próximo tick del cron.
   */
  private async enrollForEvent(eventType: AutomationEvent, payload: any) {
    const tenantId = payload?.tenantId;
    const customerId = payload?.customerId;
    if (!tenantId || !customerId) return; // los workflows enrolan CLIENTES
    const workflows = await this.prisma.automationWorkflow.findMany({
      where: { tenantId, isActive: true, triggerType: eventType },
      select: { id: true, steps: true },
    });
    for (const wf of workflows) {
      const steps = (wf.steps as WorkflowStep[]) ?? [];
      if (!steps.length) continue;
      try {
        await this.prisma.automationEnrollment.create({
          data: {
            workflowId: wf.id,
            tenantId,
            customerId,
            stepIndex: 0,
            status: 'active',
            nextRunAt: new Date(),
          },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') continue; // ya inscrito
        throw e;
      }
    }
  }

  /**
   * Cron (cada 5 min): avanza los workflows multipaso. Procesa las inscripciones
   * vencidas (nextRunAt <= now): ejecuta los pasos de envío consecutivos y, al
   * toparse con un WAIT, reprograma nextRunAt al futuro; al terminar marca 'done'.
   * Si el workflow está pausado (isActive=false) la inscripción no avanza.
   */
  @Cron('*/5 * * * *')
  async processWorkflowTick() {
    const now = new Date();
    const due = await this.prisma.automationEnrollment.findMany({
      where: { status: 'active', nextRunAt: { lte: now } },
      include: { workflow: true },
      take: 200,
      orderBy: { nextRunAt: 'asc' },
    });
    for (const enr of due) {
      if (!enr.workflow || !enr.workflow.isActive) continue; // pausado
      try {
        await this.processEnrollment(enr, enr.workflow);
      } catch (e) {
        this.logger.warn(
          `workflow tick enr ${enr.id} falló: ${(e as Error).message}`,
        );
      }
    }
  }

  private async processEnrollment(
    enr: {
      id: string;
      tenantId: string;
      customerId: string;
      stepIndex: number;
    },
    workflow: { id: string; steps: any },
  ) {
    const steps = (workflow.steps as WorkflowStep[]) ?? [];
    let idx = enr.stepIndex;
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    // Ejecuta pasos de envío consecutivos hasta toparse con un WAIT o el final.
    while (idx < steps.length) {
      const step = steps[idx];
      if (step && step.type === 'WAIT') {
        const unitMs =
          step.unit === 'days' ? dayMs : step.unit === 'hours' ? 3600000 : 60000;
        const amount = Math.max(1, Math.min(365, Number(step.amount) || 1));
        await this.prisma.automationEnrollment.update({
          where: { id: enr.id },
          data: {
            stepIndex: idx + 1,
            nextRunAt: new Date(now.getTime() + amount * unitMs),
          },
        });
        return; // esperamos hasta el próximo vencimiento
      }
      // Paso de envío — reusa executeAction con payload mínimo.
      try {
        await this.executeAction(
          step as Action,
          { tenantId: enr.tenantId, customerId: enr.customerId },
          `wf:${workflow.id}`,
        );
      } catch (e) {
        this.logger.warn(
          `workflow ${workflow.id} paso ${idx} (${(step as any)?.type}) falló: ${
            (e as Error).message
          }`,
        );
      }
      idx++;
    }
    await this.prisma.automationEnrollment.update({
      where: { id: enr.id },
      data: { stepIndex: idx, status: 'done', nextRunAt: now },
    });
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
        // `destinatarioSinVerificar`: este teléfono es el del CLIENTE, y el
        // cliente pudo crearse desde una ruta pública —un alta por QR, un
        // pedido— con el número que quisiera quien la llamó. Sin la marca, el
        // tope no se aplicaba y las automatizaciones eran la puerta de al lado
        // para el mismo abuso que se cerró en las reservas: mandar mensajes a
        // un tercero desde el remitente del negocio y a su costa.
        const ctxEnvio = {
          tenantId,
          feature: 'automations',
          destinatarioSinVerificar: true,
        };
        if (action.type === 'SEND_SMS') {
          await this.growBusiness.sendSmsWithCreds(creds, phone, body, ctxEnvio);
        } else {
          await this.growBusiness.sendWhatsAppWithCreds(
            { locationId: creds.locationId, apiKey: creds.apiKey },
            phone,
            body,
            ctxEnvio,
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
            // Apple + Google, igual que en el envío inmediato: `sent` son
            // los de Apple y Google solo cuenta si de verdad salió.
            delivered += (r?.sent ?? 0) + (r?.google?.ok ? 1 : 0);
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
        /**
         * CUÁNTOS SELLOS. Sin esto, `increment: undefined`.
         *
         * EL FALLO (Chillin Sports & Wings, 2026-09-18): «no se le está dando
         * el sello automático al cliente». El panel guardaba la acción sin
         * `amount` al cambiarle el tipo, y en producción quedó
         * `{"body":"","type":"ADD_STAMPS","title":""}`. El panel ya no puede
         * guardar eso, pero las reglas que YA están guardadas así siguen ahí:
         * sin este respaldo, seguirían sin dar un sello hasta que alguien
         * vuelva a abrir y guardar cada una.
         */
        const cuantos = Math.max(1, Math.round(Number(action.amount) || 1));
        // clubPlanId/convenioId: null en el fallback — las tarjetas de CLUB y de
        // ALIANZA también son type STAMPS; sin el filtro, una automatización sin
        // cardId explícito le sumaría "sellos" al saldo de la membresía de club
        // o a la tarjeta de la empresa aliada, donde el contador no significa
        // nada y el cliente vería subir un número que no le sirve.
        // El filtro estaba SOLO en el fallback de abajo. Con `cardId` explícito
        // se cargaba la tarjeta a pelo —sin mirar el tenant siquiera— y si esa
        // tarjeta era la plantilla de un plan de club, la automatización le
        // SUMABA cupo al socio: sin `ClubConsumo`, sin tope y sin rastro. Media
        // puerta cerrada es una puerta abierta.
        const card =
          (action.cardId &&
            (await this.prisma.card.findFirst({
              where: {
                id: action.cardId,
                tenantId,
                clubPlanId: null,
                convenioId: null,
              },
            }))) ||
          (await this.prisma.card.findFirst({
            where: {
              tenantId,
              type: 'STAMPS',
              isActive: true,
              clubPlanId: null,
              convenioId: null,
            },
          }));
        // Los `break` de aquí abajo eran mudos: la regla se marcaba SUCCESS
        // igual, así que el panel le decía al negocio que su automatización
        // funcionaba mientras no daba un solo sello. Ahora dicen por qué.
        if (!card) {
          this.logger.warn(
            `ADD_STAMPS sin tarjeta de sellos (tenant ${tenantId}): el negocio no tiene ninguna activa, o la elegida es de club/alianza.`,
          );
          break;
        }
        const pass = await this.prisma.pass.findUnique({
          where: { cardId_customerId: { cardId: card.id, customerId } },
        });
        if (!pass) {
          this.logger.warn(
            `ADD_STAMPS sin pase (tenant ${tenantId}, tarjeta ${card.id}): el cliente se inscribió en otra tarjeta. Elige la tarjeta en la automatización.`,
          );
          break;
        }
        await this.prisma.$transaction([
          this.prisma.stamp.create({
            data: {
              tenantId,
              passId: pass.id,
              customerId,
              action: 'STAMP',
              amount: cuantos,
              note: 'Por automation',
            },
          }),
          this.prisma.pass.update({
            where: { id: pass.id },
            data: { stampsCount: { increment: cuantos } },
          }),
        ]);
        // EL PASE HAY QUE REFRESCARLO. El sellado normal lo hace
        // (`stamps.service.ts`); esto no, así que el sello entraba en la base y
        // el cliente seguía viendo su tarjeta en cero — que para él es
        // exactamente lo mismo que si no se le hubiera dado.
        this.wallet.pushPassUpdate(pass.id).catch(() => null);
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
   * A qué hora LOCAL del negocio sale cada cron diario, y cuántas horas se
   * sigue intentando después.
   *
   * La VENTANA no es un lujo: comparar `=== hora` es un punto exacto y sin
   * recuperación. Si el proceso no está vivo en el minuto 0 de esa hora —un
   * despliegue (el healthcheck admite hasta 600 s), un crash, un OOM— esos
   * negocios pierden el día entero. Ese agujero ya existía antes, pero caía a
   * las 3am, cuando nadie despliega; ahora cae a las 8 de la mañana, que es
   * justo cuando se despliega. Con la ventana, el tick de las 9 recoge lo que
   * no salió a las 8.
   *
   * La ventana NO puede cruzar la medianoche con esta comparación (8+4=12 y
   * 9+4=13 se quedan dentro del día). Si alguien mueve estas horas cerca de
   * las 20:00, hay que pasar a aritmética modular.
   */
  private static readonly HORA_CUMPLEANOS = 8;
  private static readonly HORA_INACTIVIDAD = 9;
  private static readonly VENTANA_HORAS = 4;

  /**
   * Negocios que AHORA MISMO están dentro de la ventana en SU zona horaria.
   *
   * Antes esto no existía: los crons estaban clavados a una hora UTC y el
   * servidor va en UTC, así que a Bogotá le salían a las 3am y a las 4am. Ver
   * `hora-local.ts` para el detalle y los números de producción.
   */
  private async negociosEnSuVentana(horaObjetivo: number, ahora: Date) {
    const negocios = await this.prisma.tenant.findMany({
      select: { id: true, brandName: true, timezone: true },
    });
    const fin = horaObjetivo + AutomationsService.VENTANA_HORAS;
    return negocios.filter((t) => {
      const h = horaLocal(ahora, t.timezone);
      return h >= horaObjetivo && h < fin;
    });
  }

  /**
   * Reclama el día local de un negocio para un cron diario. Devuelve true solo
   * si ES ESTA corrida la que se lo lleva.
   *
   * UPDATE condicional mirando el `count`, igual que con las notificaciones
   * programadas. El candado vive en la BASE y no en memoria porque en memoria
   * no sobrevive a lo que de verdad pasa en producción:
   *
   *  - En cada DESPLIEGUE hay dos procesos a la vez. Railway mantiene el
   *    contenedor viejo hasta que el nuevo pasa el healthcheck, y durante ese
   *    solape los dos tienen el cron armado, cada uno con su propia memoria.
   *    Si el solape cruza el minuto 0 de la hora local de un negocio, con un
   *    candado en memoria el saludo sale DOBLE.
   *  - El día que `numReplicas` pase de 1 (hoy no está fijado, o sea 1 por
   *    defecto), saldría doble todos los días.
   *
   * El `OR` con null es explícito a propósito: `{ not: valor }` sobre una
   * columna nullable no siempre casa las filas a NULL, y son justo las de
   * todos los negocios el primer día tras aplicar la migración.
   */
  private async reclamarDiaLocal(
    campo: 'ultimoCronCumpleanos' | 'ultimoCronInactividad',
    tenantId: string,
    diaLocal: string,
  ): Promise<boolean> {
    // `any` acotado: Prisma no tipa un nombre de columna dinámico.
    const where: any = {
      id: tenantId,
      OR: [{ [campo]: null }, { [campo]: { not: diaLocal } }],
    };
    const claim = await this.prisma.tenant.updateMany({
      where,
      data: { [campo]: diaLocal } as any,
    });
    return claim.count === 1;
  }

  /**
   * AL DESPLEGAR O HACER ROLLBACK DE ESTOS DOS CRONS — LEER ANTES.
   *
   * El candado de arriba solo coordina procesos que corren ESTE código. No
   * puede ver al cron viejo, que disparaba a hora UTC fija (`0 8 * * *` y
   * `0 9 * * *`). Si en un mismo día natural corren el viejo Y el nuevo, todo
   * sale DOS veces: el viejo a las 08/09 UTC y el nuevo a las 8/9 locales.
   * `emit()` no tiene dedup por cliente y día, así que se duplicarían TODOS
   * los cumpleaños y todos los «te extrañamos» de todos los negocios.
   *
   * La franja segura NO es «después de las 15:00 UTC» — esa cuenta salía de
   * mirar solo el principio de la ventana. Con la ventana de 4 horas, Colombia
   * (UTC-5) tiene ticks hasta las 16-17 UTC, y México, Guatemala y Tegucigalpa
   * (UTC-6) hasta las 18. Desplegar a las 15:10 hace que el tick de las 16:00
   * reclame las filas que siguen a NULL y vuelva a mandar lo que el viejo ya
   * mandó a las 08/09 UTC.
   *
   * SEGURO: entre las 18:01 y las 07:50 UTC. (El margen del final es porque el
   * contenedor viejo sigue vivo hasta 600 s después del healthcheck.)
   *
   * Un ROLLBACK no duplica: PIERDE el día. Volver al código viejo entre las
   * 08:00 UTC y el primer tick nuevo deja a esos negocios sin cumpleaños y sin
   * «te extrañamos», porque el viejo ya pasó de largo esa mañana.
   */

  /**
   * Cron BIRTHDAY — a las 8 de la mañana DE CADA NEGOCIO.
   * Encuentra customers cuyo cumpleaños es HOY (mes/día en la zona del
   * negocio) y emite el evento. Si el tenant tiene una regla activa con
   * trigger=BIRTHDAY, dispara el saludo (push/SMS/WA según action).
   *
   * Corre cada hora dentro de una ventana y filtra por hora local: antes era
   * `0 8 * * *` (UTC), que en Bogotá son las 3 de la madrugada.
   */
  // `ahora` es parámetro para poder probar la ventana y el candado con un
  // instante fijo. @Cron lo llama sin argumentos, así que en producción es la
  // hora real. Un test que dependa del reloj de quien lo corre da verde o rojo
  // según la hora del día, y eso no es un candado.
  @Cron('0 * * * *')
  async cronBirthday(ahora: Date = new Date()) {
    const negocios = await this.negociosEnSuVentana(
      AutomationsService.HORA_CUMPLEANOS,
      ahora,
    );
    for (const negocio of negocios) {
      const diaLocal = fechaLocal(ahora, negocio.timezone);
      const mio = await this.reclamarDiaLocal(
        'ultimoCronCumpleanos',
        negocio.id,
        diaLocal,
      );
      if (!mio) continue;

      const [, mes, dia] = diaLocal.split('-').map(Number);
      // Postgres date_part para extraer mes/día sin importar el año
      const customers = await this.prisma.$queryRaw<
        Array<{ id: string; fullName: string }>
      >`
        SELECT id, "fullName" FROM "Customer"
        WHERE "tenantId" = ${negocio.id}
          AND "birthday" IS NOT NULL
          AND EXTRACT(MONTH FROM "birthday") = ${mes}
          AND EXTRACT(DAY FROM "birthday") = ${dia}
      `;
      if (customers.length === 0) continue;
      this.logger.log(
        `cronBirthday: ${customers.length} cumpleañeros hoy en ${negocio.brandName ?? negocio.id} (${diaLocal} ${negocio.timezone})`,
      );
      for (const c of customers) {
        await this.emit('BIRTHDAY', {
          tenantId: negocio.id,
          customerId: c.id,
          customerName: c.fullName,
          businessName: negocio.brandName ?? 'nuestro local',
        }).catch(() => null);
      }
    }
  }

  /**
   * Cron INACTIVITY — a las 9 de la mañana DE CADA NEGOCIO.
   * Encuentra customers que no tuvieron actividad en > 30 días. Idempotente:
   * solo dispara si lastVisitDay es EXACTAMENTE el día 31 (o sea, ayer cayeron
   * al umbral) — así un cliente recibe el mensaje 1 vez, no todos los días.
   *
   * Corre cada hora dentro de una ventana y filtra por hora local: antes era
   * `0 9 * * *` (UTC), que en Bogotá son las 4 de la madrugada. Es el «Te
   * extrañamos …💌» que llegó a las 4:03am a los clientes de Konys.
   */
  // `ahora` es parámetro por lo mismo que en `cronBirthday`: poder fijar el
  // instante en los tests. @Cron lo llama sin argumentos.
  @Cron('0 * * * *')
  async cronInactivity(ahora: Date = new Date()) {
    const negocios = await this.negociosEnSuVentana(
      AutomationsService.HORA_INACTIVIDAD,
      ahora,
    );
    for (const negocio of negocios) {
      const diaLocal = fechaLocal(ahora, negocio.timezone);
      const mio = await this.reclamarDiaLocal(
        'ultimoCronInactividad',
        negocio.id,
        diaLocal,
      );
      if (!mio) continue;

      // Hace 30 días, contados sobre el calendario DEL NEGOCIO.
      const targetDay = restarDias(diaLocal, 30);
      const customers = await this.prisma.customer.findMany({
        where: { tenantId: negocio.id, lastVisitDay: targetDay },
        select: { id: true, fullName: true },
      });
      if (customers.length === 0) continue;
      this.logger.log(
        `cronInactivity: ${customers.length} customers cruzaron el umbral 30d en ${negocio.brandName ?? negocio.id} (${diaLocal} ${negocio.timezone})`,
      );
      for (const c of customers) {
        await this.emit('INACTIVITY', {
          tenantId: negocio.id,
          customerId: c.id,
          customerName: c.fullName,
          daysSinceLastVisit: 30,
        }).catch(() => null);
      }
    }
  }

  // ========== Plantillas pre-armadas ==========

  /**
   * Las recetas tal como las tiene que ver ESTE negocio.
   *
   * El listado salía siempre en español, así que el dueño de un negocio en
   * inglés elegía entre seis tarjetas que no entendía y que además iban a
   * mandarle a sus clientes un texto en otro idioma.
   */
  async plantillas(user: AuthUser, tenantIdOverride?: string) {
    const tid = this.tid(user, tenantIdOverride);
    const negocio = await this.prisma.tenant.findUnique({
      where: { id: tid },
      select: { locale: true },
    });
    return AUTOMATION_TEMPLATES.map((t) => plantillaEnIdioma(t, negocio?.locale));
  }

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
    const base = AUTOMATION_TEMPLATES.find((t) => t.id === templateId);
    if (!base) throw new NotFoundException('Template');
    // En el idioma del NEGOCIO. Un negocio de Estados Unidos activaba la
    // bienvenida y sus clientes recibían el saludo en español; el texto es
    // editable, pero nadie edita lo que da por hecho que ya está bien.
    const negocio = await this.prisma.tenant.findUnique({
      where: { id: tid },
      select: { locale: true },
    });
    const tpl = plantillaEnIdioma(base, negocio?.locale);
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
