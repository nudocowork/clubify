import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
import { addPlanPeriod } from '../common/plan-period';
import {
  HotmartEventType,
  HotmartService,
  HotmartWebhookPayload,
} from './hotmart.service';

const SIMULATABLE_EVENTS = [
  'PURCHASE_APPROVED',
  'PURCHASE_DELAYED',
  'PURCHASE_PROTEST',
  'PURCHASE_REFUNDED',
  'PURCHASE_CHARGEBACK',
  'SUBSCRIPTION_CANCELLATION',
  'UPDATE_SUBSCRIPTION_CHARGE_DATE',
] as const satisfies readonly HotmartEventType[];

class SimulateWebhookDto {
  @IsUUID()
  tenantId!: string;

  @IsIn(SIMULATABLE_EVENTS as unknown as string[])
  event!: (typeof SIMULATABLE_EVENTS)[number];
}

class SimulateGroupWebhookDto {
  @IsUUID()
  groupId!: string;

  @IsIn(SIMULATABLE_EVENTS as unknown as string[])
  event!: (typeof SIMULATABLE_EVENTS)[number];
}

// Simulación de COMPRA DE CRÉDITOS (Modelo B). Verifica el ruteo por token
// (src=wl_<id>) sin tocar Hotmart. dryRun=true (default) NO escribe créditos.
class SimulateCreditWebhookDto {
  @IsOptional() @IsUUID() whiteLabelId?: string;
  @IsOptional() @IsString() slug?: string;
  @IsInt() credits!: number; // 1 | 10 | 20 → busca el link de ese pack
  @IsOptional() @IsBoolean() withToken?: boolean; // default true
  @IsOptional() @IsBoolean() dryRun?: boolean; // default true (no escribe)
}

/**
 * Simulador de webhooks Hotmart para QA. Solo SUPER_ADMIN.
 * Construye un payload válido contra el tenant indicado y lo pasa por el
 * mismo `handleEvent()` que ejecuta el webhook real, para ejercer el flujo
 * end-to-end sin tocar Hotmart ni cobrar tarjetas.
 *
 * NO requiere HOTTOK porque salta el receptor `/webhooks/hotmart`.
 */
@Controller('admin/billing/hotmart')
export class HotmartSimulatorController {
  constructor(
    private prisma: PrismaService,
    private hotmart: HotmartService,
  ) {}

  @Roles('SUPER_ADMIN')
  @Post('simulate-webhook')
  async simulate(@Body() dto: SimulateWebhookDto) {
    // Doble candado: solo permitido fuera de procesar webhooks reales
    // (esto NO valida HOTTOK, así que limitamos a super admin a través de
    // @Roles + el guard explícito aquí).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: {
        id: true,
        brandName: true,
        hotmartSubscriberCode: true,
        hotmartTransactionId: true,
        planPeriodicity: true,
        plan: { select: { name: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant no existe');
    const owner = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, role: 'TENANT_OWNER', isActive: true },
      select: { email: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner?.email) {
      throw new BadRequestException(
        'Tenant no tiene owner con email — no puedo simular el match del webhook',
      );
    }

    // Marker estable para distinguir simulaciones de cobros reales en logs
    // y en la BD (`subscriberCode` arranca con `sim-` para que sea evidente).
    const subscriberCode =
      tenant.hotmartSubscriberCode ?? `sim-${tenant.id.slice(0, 8)}`;
    const transactionId =
      tenant.hotmartTransactionId ??
      `SIMTX-${Date.now().toString(36).toUpperCase()}`;
    const planName = tenant.plan?.name;

    // Default `date_next_charge` según la periodicidad real del plan
    // (Trimestral = +3 meses), para PURCHASE_APPROVED y
    // UPDATE_SUBSCRIPTION_CHARGE_DATE. Para los demás no aplica.
    const nextChargeMs = addPlanPeriod(new Date(), tenant.planPeriodicity).getTime();

    const payload: HotmartWebhookPayload = {
      id: `sim-${Date.now()}`,
      event: dto.event,
      data: {
        buyer: { email: owner.email, name: owner.fullName ?? undefined },
        subscription: {
          subscriber: { code: subscriberCode },
          plan: planName ? { name: planName } : undefined,
          date_next_charge: nextChargeMs,
          status: dto.event === 'SUBSCRIPTION_CANCELLATION' ? 'CANCELLED' : 'ACTIVE',
        },
        purchase: {
          transaction: transactionId,
          status: dto.event === 'PURCHASE_APPROVED' ? 'APPROVED' : undefined,
          approved_date: Date.now(),
        },
      },
    };

    const result = await this.hotmart.handleEvent(payload);
    return {
      ok: true,
      simulated: dto.event,
      buyerEmail: owner.email,
      payload,
      handlerResult: result,
    };
  }

  /**
   * Simula una COMPRA DE CRÉDITOS (Modelo B). Arma un payload con el producto y
   * la oferta reales del pack pedido + el token src=wl_<id> de la marca, y lo
   * pasa por el MISMO tryHandleCreditPurchase/handleEvent que el webhook real.
   * dryRun=true (default): solo resuelve marca+cantidad, NO escribe créditos.
   */
  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Post('simulate-credit-webhook')
  async simulateCredit(@Body() dto: SimulateCreditWebhookDto) {
    const wl = await this.prisma.whiteLabel.findFirst({
      where: dto.whiteLabelId
        ? { id: dto.whiteLabelId }
        : { slug: (dto.slug ?? '').toLowerCase() },
      select: { id: true, name: true, slug: true },
    });
    if (!wl) throw new NotFoundException('Marca no encontrada (whiteLabelId o slug)');

    // Link de crédito ACTIVO del pack pedido (cantidad de créditos). En Modelo B
    // las ofertas son compartidas (de Clubify) → tomamos una de esa cantidad
    // para obtener productId + offerCode REALES.
    const link = await this.prisma.hotmartCreditLink.findFirst({
      where: {
        credits: dto.credits,
        isActive: true,
        hotmartProductId: { not: null },
      },
      orderBy: { position: 'asc' },
    });
    if (!link || !link.hotmartProductId) {
      throw new BadRequestException(
        `No hay HotmartCreditLink activo para ${dto.credits} créditos con productId. Configura las ofertas primero.`,
      );
    }

    const withToken = dto.withToken !== false; // default true
    const dryRun = dto.dryRun !== false; // default true (seguro, no escribe)
    const transactionId = `SIMCR-${Date.now().toString(36).toUpperCase()}`;
    const payload: HotmartWebhookPayload = {
      id: `sim-cr-${Date.now()}`,
      event: 'PURCHASE_APPROVED',
      data: {
        buyer: { email: `sim-${wl.slug}@example.com` },
        purchase: {
          transaction: transactionId,
          status: 'APPROVED',
          approved_date: Date.now(),
          offer: link.hotmartOfferCode
            ? { code: link.hotmartOfferCode }
            : undefined,
          tracking: withToken ? { source: `wl_${wl.id}` } : undefined,
        },
        product: { id: Number(link.hotmartProductId) },
      },
    };

    const handlerResult = dryRun
      ? await this.hotmart.tryHandleCreditPurchase(payload, true)
      : await this.hotmart.handleEvent(payload);

    return {
      ok: true,
      mode: dryRun ? 'DRYRUN (no escribió nada)' : 'REAL (acreditó de verdad)',
      targetBrand: { id: wl.id, name: wl.name, slug: wl.slug },
      pack: {
        credits: dto.credits,
        productId: link.hotmartProductId,
        offerCode: link.hotmartOfferCode,
      },
      withToken,
      token: withToken ? `wl_${wl.id}` : null,
      transactionId,
      handlerResult,
    };
  }

  /**
   * Simula un cobro Hotmart de un GRUPO EMPRESARIAL. Pasa por el mismo
   * handleEvent → el hook de grupos matchea por subscriberCode (o email del
   * responsable) y cascadea el estado a TODOS los negocios del grupo. Sirve
   * para validar el flujo pago/refund del grupo sin Hotmart real.
   */
  @Roles('SUPER_ADMIN', 'PLATFORM_OWNER')
  @Post('simulate-group-webhook')
  async simulateGroup(@Body() dto: SimulateGroupWebhookDto) {
    const group = await this.prisma.businessGroup.findUnique({
      where: { id: dto.groupId },
      select: {
        id: true,
        name: true,
        hotmartSubscriberCode: true,
        responsibleEmail: true,
        planPeriodicity: true,
        deletedAt: true,
      },
    });
    if (!group || group.deletedAt) throw new NotFoundException('Grupo no existe');

    // El hook de grupos matchea por subscriberCode o por email del responsable.
    // Si el grupo no tiene código, le asignamos uno de simulación y lo
    // persistimos para que el match funcione (y futuros cobros reales también).
    let subscriberCode = group.hotmartSubscriberCode;
    if (!subscriberCode) {
      subscriberCode = `sim-group-${group.id.slice(0, 8)}`;
      await this.prisma.businessGroup.update({
        where: { id: group.id },
        data: { hotmartSubscriberCode: subscriberCode },
      });
    }
    const buyerEmail =
      group.responsibleEmail ?? `sim-group-${group.id.slice(0, 8)}@example.com`;
    const transactionId = `SIMTX-GRP-${Date.now().toString(36).toUpperCase()}`;
    const nextChargeMs = addPlanPeriod(new Date(), group.planPeriodicity).getTime();

    const payload: HotmartWebhookPayload = {
      id: `sim-grp-${Date.now()}`,
      event: dto.event,
      data: {
        buyer: { email: buyerEmail },
        subscription: {
          subscriber: { code: subscriberCode },
          date_next_charge: nextChargeMs,
          status: dto.event === 'SUBSCRIPTION_CANCELLATION' ? 'CANCELLED' : 'ACTIVE',
        },
        purchase: {
          transaction: transactionId,
          status: dto.event === 'PURCHASE_APPROVED' ? 'APPROVED' : undefined,
          approved_date: Date.now(),
        },
      },
    };

    const result = await this.hotmart.handleEvent(payload);
    return {
      ok: true,
      simulated: dto.event,
      groupId: group.id,
      subscriberCode,
      payload,
      handlerResult: result,
    };
  }
}
