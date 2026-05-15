import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { Roles } from '../common/decorators/roles.decorator';
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
  'SWITCH_PLAN',
] as const satisfies readonly HotmartEventType[];

class SimulateWebhookDto {
  @IsUUID()
  tenantId!: string;

  @IsIn(SIMULATABLE_EVENTS as unknown as string[])
  event!: (typeof SIMULATABLE_EVENTS)[number];

  /** Solo para SWITCH_PLAN: nombre del plan al que cambiar (ej. "Pro"). */
  @IsOptional()
  @IsString()
  switchToPlan?: string;
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
    // @Roles + el guard explícito acá).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: dto.tenantId },
      select: {
        id: true,
        brandName: true,
        hotmartSubscriberCode: true,
        hotmartTransactionId: true,
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
    const planName =
      dto.event === 'SWITCH_PLAN'
        ? dto.switchToPlan ?? tenant.plan?.name
        : tenant.plan?.name;

    // Default `date_next_charge` = +30 días para PURCHASE_APPROVED y
    // UPDATE_SUBSCRIPTION_CHARGE_DATE. Para los demás no aplica.
    const nextChargeMs = Date.now() + 30 * 24 * 60 * 60 * 1000;

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
}
