import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessGroupStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { addPlanPeriod } from '../common/plan-period';
import { ReferralsService } from '../referrals/referrals.service';

export type CreateGroupDto = {
  name: string;
  responsibleName?: string;
  responsibleEmail?: string;
  responsiblePhone?: string;
  hotmartSubscriberCode?: string;
  planPeriodicity?: string;
  // Precio real del grupo por periodo (ej: 3 negocios × $50 = $150 MENSUAL).
  // Base de la comisión y del facturado. null = usar canónico de la periodicidad.
  priceUsd?: number | null;
  nextChargeDate?: string;
  tenantIds?: string[];
  // Punto 2: recipiente de la comisión del grupo (ReferralCode). '' o null = quitar.
  referralCodeId?: string | null;
};

export type UpdateGroupDto = Partial<CreateGroupDto>;

@Injectable()
export class BusinessGroupsService {
  private readonly logger = new Logger(BusinessGroupsService.name);
  constructor(
    private prisma: PrismaService,
    private referrals: ReferralsService,
  ) {}

  /** P1 (PDF 2026-07-01): genera la comisión del grupo (1 × bruto del plan)
   *  al recipiente asignado. Best-effort + idempotente (dedup por grupo,
   *  recipiente y periodo). Se llama al activarse/cobrarse el grupo (manual o
   *  Hotmart) y al asignarle un recipiente estando ya activo — así el flujo
   *  "asigno a Sara y Nico → aparece su comisión" funciona sin esperar al
   *  próximo webhook de Hotmart. */
  private async tryGenerateGroupCommission(groupId: string) {
    try {
      const res = await this.referrals.generateGroupCommission({ groupId });
      if (res.generated) {
        this.logger.log(`Comisión de grupo ${groupId} generada.`);
      } else {
        this.logger.log(
          `Comisión de grupo ${groupId} no generada: ${res.reason}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `generateGroupCommission(${groupId}) falló: ${(e as Error)?.message}`,
      );
    }
  }

  /** Aislamiento: el admin de marca solo ve/edita los grupos de SU marca.
   *  Clubify global (whiteLabelId null) ve los grupos sin marca. */
  private scope(user?: AuthUser) {
    return user?.whiteLabelId ?? null;
  }

  async list(user?: AuthUser) {
    const wlId = this.scope(user);
    const groups = await this.prisma.businessGroup.findMany({
      where: { deletedAt: null, whiteLabelId: wlId },
      orderBy: { createdAt: 'desc' },
      include: {
        tenants: {
          where: { deletedAt: null },
          select: { id: true, brandName: true, slug: true, status: true },
          orderBy: { brandName: 'asc' },
        },
      },
    });
    return groups.map((g) => ({
      ...g,
      tenantsCount: g.tenants.length,
      activeCount: g.tenants.filter((t) => t.status === 'ACTIVE').length,
    }));
  }

  async get(id: string, user?: AuthUser) {
    const wlId = this.scope(user);
    const group = await this.prisma.businessGroup.findFirst({
      where: { id, deletedAt: null, whiteLabelId: wlId },
      include: {
        tenants: {
          where: { deletedAt: null },
          select: {
            id: true,
            brandName: true,
            slug: true,
            status: true,
            currentPeriodEnd: true,
          },
          orderBy: { brandName: 'asc' },
        },
        // Punto 2: recipiente de la comisión del grupo (para mostrar en la UI).
        referralCode: {
          select: { id: true, code: true, ownerName: true, role: true, commissionPercent: true },
        },
      },
    });
    if (!group) throw new NotFoundException('Grupo no encontrado');
    return group;
  }

  /** Negocios de la marca que aún no pertenecen a ningún grupo (para el picker). */
  async availableTenants(user?: AuthUser) {
    const wlId = this.scope(user);
    return this.prisma.tenant.findMany({
      where: { deletedAt: null, whiteLabelId: wlId, businessGroupId: null },
      select: { id: true, brandName: true, slug: true, status: true },
      orderBy: { brandName: 'asc' },
    });
  }

  async create(dto: CreateGroupDto, user?: AuthUser) {
    const wlId = this.scope(user);
    if (!dto.name?.trim()) throw new BadRequestException('Nombre requerido');

    let currentPeriodEnd: Date | null = null;
    if (dto.nextChargeDate) {
      const d = new Date(dto.nextChargeDate);
      if (Number.isNaN(d.getTime()))
        throw new BadRequestException('Fecha de cobro inválida');
      currentPeriodEnd = d;
    }

    const group = await this.prisma.businessGroup.create({
      data: {
        whiteLabelId: wlId,
        name: dto.name.trim(),
        responsibleName: dto.responsibleName?.trim() || null,
        responsibleEmail: dto.responsibleEmail?.trim().toLowerCase() || null,
        responsiblePhone: dto.responsiblePhone?.trim() || null,
        hotmartSubscriberCode: dto.hotmartSubscriberCode?.trim() || null,
        planPeriodicity: dto.planPeriodicity || null,
        priceUsd:
          dto.priceUsd != null && Number(dto.priceUsd) > 0 ? Number(dto.priceUsd) : null,
        referralCodeId: dto.referralCodeId?.trim() || null,
        currentPeriodEnd,
        status: 'ACTIVE',
      },
    });

    if (dto.tenantIds?.length) {
      for (const tid of dto.tenantIds) {
        await this.addTenant(group.id, tid, user).catch((e) =>
          this.logger.warn(`addTenant ${tid} falló: ${(e as Error).message}`),
        );
      }
    }
    return this.get(group.id, user);
  }

  async update(id: string, dto: UpdateGroupDto, user?: AuthUser) {
    await this.get(id, user); // valida pertenencia a la marca
    const data: Prisma.BusinessGroupUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.responsibleName !== undefined)
      data.responsibleName = dto.responsibleName?.trim() || null;
    if (dto.responsibleEmail !== undefined)
      data.responsibleEmail = dto.responsibleEmail?.trim().toLowerCase() || null;
    if (dto.responsiblePhone !== undefined)
      data.responsiblePhone = dto.responsiblePhone?.trim() || null;
    if (dto.hotmartSubscriberCode !== undefined)
      data.hotmartSubscriberCode = dto.hotmartSubscriberCode?.trim() || null;
    if (dto.planPeriodicity !== undefined)
      data.planPeriodicity = dto.planPeriodicity || null;
    if (dto.priceUsd !== undefined)
      data.priceUsd =
        dto.priceUsd != null && Number(dto.priceUsd) > 0 ? Number(dto.priceUsd) : null;
    if (dto.referralCodeId !== undefined) {
      const rid = dto.referralCodeId?.trim() || null;
      data.referralCode = rid ? { connect: { id: rid } } : { disconnect: true };
    }
    if (dto.nextChargeDate !== undefined) {
      if (!dto.nextChargeDate) {
        data.currentPeriodEnd = null;
      } else {
        const d = new Date(dto.nextChargeDate);
        if (Number.isNaN(d.getTime()))
          throw new BadRequestException('Fecha de cobro inválida');
        data.currentPeriodEnd = d;
      }
    }
    await this.prisma.businessGroup.update({ where: { id }, data });
    const fresh = await this.get(id, user);
    // P1: si se asignó/actualizó el recipiente y el grupo ya está ACTIVE
    // (cobrado este periodo), genera su comisión de una vez. Idempotente.
    if (dto.referralCodeId !== undefined && dto.referralCodeId?.trim() && fresh.status === 'ACTIVE') {
      await this.tryGenerateGroupCommission(id);
    }
    return fresh;
  }

  /** Soft-delete del grupo. Los negocios NO se borran: se desvinculan (quedan
   *  individuales, sin tocar su status). */
  async remove(id: string, user?: AuthUser) {
    await this.get(id, user);
    await this.prisma.$transaction([
      this.prisma.tenant.updateMany({
        where: { businessGroupId: id },
        data: { businessGroupId: null },
      }),
      this.prisma.businessGroup.update({
        where: { id },
        data: { deletedAt: new Date() },
      }),
    ]);
    return { ok: true };
  }

  /** Agrega un negocio al grupo. Valida que sea de la misma marca y que no
   *  pertenezca ya a otro grupo. Sincroniza su status al del grupo. */
  async addTenant(groupId: string, tenantId: string, user?: AuthUser) {
    const group = await this.get(groupId, user);
    const wlId = this.scope(user);
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId, deletedAt: null, whiteLabelId: wlId },
      select: { id: true, businessGroupId: true },
    });
    if (!tenant)
      throw new NotFoundException('Negocio no encontrado en esta marca');
    if (tenant.businessGroupId && tenant.businessGroupId !== groupId) {
      throw new BadRequestException(
        'Este negocio ya pertenece a otro grupo. Quítalo primero.',
      );
    }
    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        businessGroupId: groupId,
        // Sincroniza el negocio al estado financiero del grupo.
        ...(group.status === 'SUSPENDED'
          ? { status: 'SUSPENDED', suspendedAt: new Date() }
          : {
              status: 'ACTIVE',
              suspendedAt: null,
              ...(group.currentPeriodEnd
                ? { currentPeriodEnd: group.currentPeriodEnd }
                : {}),
            }),
      },
    });
    return this.get(groupId, user);
  }

  /** Quita un negocio del grupo. NO cambia su status (sigue operando como
   *  estaba); solo lo desvincula. */
  async removeTenant(groupId: string, tenantId: string, user?: AuthUser) {
    await this.get(groupId, user);
    await this.prisma.tenant.updateMany({
      where: { id: tenantId, businessGroupId: groupId },
      data: { businessGroupId: null },
    });
    return this.get(groupId, user);
  }

  /** Cambia el estado financiero del grupo y CASCADEA a todos sus negocios.
   *  ACTIVE → negocios ACTIVE (+ periodo). SUSPENDED → negocios SUSPENDED.
   *  PAST_DUE → negocios sin cambios (gracia). Atómico. */
  async setStatus(id: string, status: BusinessGroupStatus, user?: AuthUser) {
    const group = await this.get(id, user);
    await this.applyStatus(group.id, status, {
      currentPeriodEnd: group.currentPeriodEnd,
      // Activación manual = el admin confirma que el grupo pagó → cuenta como
      // cobro (sella lastChargeAt) y genera la comisión del grupo.
      bumpCharge: status === 'ACTIVE',
    });
    if (status === 'ACTIVE') await this.tryGenerateGroupCommission(group.id);
    return this.get(id, user);
  }

  /** Núcleo de la cascada. Reusado por setStatus (manual) y por el webhook
   *  de Hotmart. Corre en una transacción para que los N negocios cambien
   *  de estado de forma atómica. */
  private async applyStatus(
    groupId: string,
    status: BusinessGroupStatus,
    opts: { currentPeriodEnd?: Date | null; bumpCharge?: boolean } = {},
  ) {
    const now = new Date();
    const groupData: Prisma.BusinessGroupUpdateInput = { status };
    if (status === 'SUSPENDED') groupData.suspendedAt = now;
    if (status === 'ACTIVE') {
      groupData.suspendedAt = null;
      groupData.failedPaymentCount = 0;
      if (opts.bumpCharge) groupData.lastChargeAt = now;
      if (opts.currentPeriodEnd !== undefined)
        groupData.currentPeriodEnd = opts.currentPeriodEnd;
    }

    const tx: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.businessGroup.update({ where: { id: groupId }, data: groupData }),
    ];

    if (status === 'SUSPENDED') {
      tx.push(
        this.prisma.tenant.updateMany({
          where: { businessGroupId: groupId, deletedAt: null },
          data: { status: 'SUSPENDED', suspendedAt: now },
        }),
      );
    } else if (status === 'ACTIVE') {
      tx.push(
        this.prisma.tenant.updateMany({
          where: { businessGroupId: groupId, deletedAt: null },
          data: {
            status: 'ACTIVE',
            suspendedAt: null,
            ...(opts.currentPeriodEnd
              ? { currentPeriodEnd: opts.currentPeriodEnd }
              : {}),
          },
        }),
      );
    }
    // PAST_DUE: los negocios siguen operando (gracia) — no se tocan.
    await this.prisma.$transaction(tx);
    this.logger.log(`BusinessGroup ${groupId} → ${status} (cascada aplicada)`);
  }

  // ============================================================
  //   Integración Hotmart (fuente de verdad del cobro del grupo)
  // ============================================================

  /** Llamado por HotmartService ANTES de buscar un tenant. Si el evento
   *  corresponde a un Grupo Empresarial (match por subscriberCode o por email
   *  del responsable en el primer pago), lo maneja y devuelve la acción; si no,
   *  devuelve null para que siga el flujo normal por tenant. */
  async tryHandleHotmartEvent(args: {
    event: string;
    subscriberCode?: string;
    buyerEmail?: string;
    nextChargeDate?: Date | null;
  }): Promise<string | null> {
    const { event, subscriberCode, buyerEmail, nextChargeDate } = args;
    const group = await this.findGroupForEvent(subscriberCode, buyerEmail);
    if (!group) return null;

    // Si vino por email en el primer pago y aún no tenía el código, lo guardamos.
    if (subscriberCode && group.hotmartSubscriberCode !== subscriberCode) {
      await this.prisma.businessGroup
        .update({
          where: { id: group.id },
          data: { hotmartSubscriberCode: subscriberCode },
        })
        .catch(() => null);
    }

    switch (event) {
      case 'PURCHASE_APPROVED':
      case 'PURCHASE_COMPLETE': {
        const periodEnd =
          nextChargeDate ??
          group.currentPeriodEnd ??
          addPlanPeriod(new Date(), group.planPeriodicity);
        await this.applyStatus(group.id, 'ACTIVE', {
          currentPeriodEnd: periodEnd,
          bumpCharge: true,
        });
        return `group_activated:${group.id}`;
      }
      case 'PURCHASE_DELAYED':
      case 'PURCHASE_PROTEST': {
        await this.prisma.businessGroup.update({
          where: { id: group.id },
          data: {
            status: 'PAST_DUE',
            failedPaymentCount: { increment: 1 },
          },
        });
        return `group_past_due:${group.id}`;
      }
      case 'PURCHASE_REFUNDED':
      case 'PURCHASE_CHARGEBACK':
      case 'SUBSCRIPTION_CANCELLATION': {
        await this.applyStatus(group.id, 'SUSPENDED', {});
        return `group_suspended:${group.id}`;
      }
      case 'UPDATE_SUBSCRIPTION_CHARGE_DATE': {
        if (nextChargeDate) {
          await this.prisma.businessGroup.update({
            where: { id: group.id },
            data: { currentPeriodEnd: nextChargeDate },
          });
        }
        return `group_charge_date_updated:${group.id}`;
      }
      default:
        // Otros eventos no aplican al grupo → que siga el flujo por tenant.
        return null;
    }
  }

  private async findGroupForEvent(subscriberCode?: string, buyerEmail?: string) {
    if (subscriberCode) {
      const g = await this.prisma.businessGroup.findFirst({
        where: { hotmartSubscriberCode: subscriberCode, deletedAt: null },
      });
      if (g) return g;
    }
    if (buyerEmail) {
      const g = await this.prisma.businessGroup.findFirst({
        where: {
          responsibleEmail: { equals: buyerEmail, mode: 'insensitive' },
          deletedAt: null,
        },
      });
      if (g) return g;
    }
    return null;
  }
}
