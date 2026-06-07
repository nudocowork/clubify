import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CommissionRecalcService } from '../referrals/commission-recalc.service';

/**
 * Excepciones de comisión por cliente (item 6 sprint).
 *
 * El SUPER_ADMIN puede sobreescribir el % de comisión para un tenant
 * específico en cualquier nivel de la cadena (influencer/embajador/
 * vendedor). El cálculo de comisión nuevo lo lee vía `resolvePercent()`
 * en hotmart/referrals; las commissions ya pagadas no se tocan.
 */
@Injectable()
export class CommissionExceptionsService {
  private logger = new Logger(CommissionExceptionsService.name);

  constructor(
    private prisma: PrismaService,
    private recalc: CommissionRecalcService,
  ) {}

  /**
   * Recalcula commissions PENDING/APPROVED del (tenant, recipientCode)
   * después de un cambio de excepción. Inyección directa (era
   * ModuleRef.get + require inline que fallaba silenciosamente porque
   * AdminModule no tenía ReferralsModule en su árbol).
   */
  private async recalcAfterChange(
    tenantId: string,
    recipientCodeId: string,
    actorId: string | null | undefined,
    reason: string,
  ) {
    try {
      const summary = await this.recalc.recalcForRecipientCode({
        recipientCodeId,
        tenantId,
        actorId: actorId ?? null,
        reason,
      });
      this.logger.log(
        `Recalc OK tenant=${tenantId} code=${recipientCodeId} updated=${summary.updated} skippedPaid=${summary.skippedPaid}`,
      );
    } catch (e: any) {
      this.logger.warn(`Recalc after exception change failed: ${e?.message}`);
    }
  }

  /**
   * Lista los tenants atribuidos a una campaña (uses del ownerCode + uses
   * de cualquier embajador/vendedor descendiente) junto con las
   * excepciones activas que cada uno tenga.
   *
   * Devuelve 1 row por tenant — agrega las excepciones por nivel.
   * `query` filtra por brandName del tenant (case-insensitive).
   */
  async listForCampaign(campaignId: string, query?: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, ownerCodeId: true },
    });
    if (!campaign) throw new NotFoundException('Campaña no encontrada');

    // Todos los ReferralCode "tocables" por esta campaña: el owner +
    // cualquier embajador con parentCodeId = owner + cualquier vendedor
    // con parentEmbajadorCodeId entre los embajadores.
    const ambassadors = await this.prisma.referralCode.findMany({
      where: { parentCodeId: campaign.ownerCodeId },
      select: { id: true },
    });
    const ambassadorIds = ambassadors.map((a) => a.id);
    const vendors = ambassadorIds.length
      ? await this.prisma.referralCode.findMany({
          where: { parentEmbajadorCodeId: { in: ambassadorIds } },
          select: { id: true },
        })
      : [];
    const allCodeIds = [
      campaign.ownerCodeId,
      ...ambassadorIds,
      ...vendors.map((v) => v.id),
    ];

    const uses = await this.prisma.referralUse.findMany({
      where: {
        referralCodeId: { in: allCodeIds },
        tenantId: { not: null },
      },
      include: {
        tenant: {
          select: { id: true, brandName: true, status: true, email: true },
        },
        referralCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            role: true,
            commissionPercent: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Agrupar por tenantId — cada tenant puede tener varios uses si rotó
    // de afiliado o atribuye a múltiples niveles de la cadena.
    type Attribution = {
      codeId: string;
      code: string;
      ownerName: string;
      role: string;
      defaultPercent: number;
    };
    const byTenant = new Map<
      string,
      {
        tenantId: string;
        brandName: string;
        status: string;
        email: string | null;
        attributions: Attribution[];
      }
    >();
    for (const u of uses) {
      if (!u.tenant) continue;
      const entry = byTenant.get(u.tenant.id) ?? {
        tenantId: u.tenant.id,
        brandName: u.tenant.brandName,
        status: u.tenant.status,
        email: u.tenant.email,
        attributions: [],
      };
      if (!entry.attributions.find((a) => a.codeId === u.referralCode.id)) {
        entry.attributions.push({
          codeId: u.referralCode.id,
          code: u.referralCode.code,
          ownerName: u.referralCode.ownerName,
          role: u.referralCode.role,
          defaultPercent: Number(u.referralCode.commissionPercent ?? 0),
        });
      }
      byTenant.set(u.tenant.id, entry);
    }

    let tenantList = Array.from(byTenant.values());
    if (query && query.trim()) {
      const needle = query.trim().toLowerCase();
      tenantList = tenantList.filter(
        (t) =>
          t.brandName.toLowerCase().includes(needle) ||
          (t.email ?? '').toLowerCase().includes(needle),
      );
    }

    // Para cada tenant, traer sus excepciones activas y mergear.
    const tenantIds = tenantList.map((t) => t.tenantId);
    const exceptions = tenantIds.length
      ? await this.prisma.commissionException.findMany({
          where: { tenantId: { in: tenantIds } },
        })
      : [];
    const excByTenant = new Map<string, typeof exceptions>();
    for (const e of exceptions) {
      const list = excByTenant.get(e.tenantId) ?? [];
      list.push(e);
      excByTenant.set(e.tenantId, list);
    }

    return tenantList.map((t) => ({
      ...t,
      exceptions: (excByTenant.get(t.tenantId) ?? []).map((e) => ({
        id: e.id,
        recipientCodeId: e.recipientCodeId,
        customPercent: Number(e.customPercent),
        reason: e.reason,
        isActive: e.isActive,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      })),
    }));
  }

  async listForTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, brandName: true },
    });
    if (!tenant) throw new NotFoundException('Cliente no encontrado');

    const rows = await this.prisma.commissionException.findMany({
      where: { tenantId },
      include: {
        recipientCode: {
          select: {
            id: true,
            code: true,
            ownerName: true,
            role: true,
            commissionPercent: true,
          },
        },
        createdBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      recipientCodeId: r.recipientCodeId,
      recipientCode: {
        id: r.recipientCode.id,
        code: r.recipientCode.code,
        ownerName: r.recipientCode.ownerName,
        role: r.recipientCode.role,
        defaultPercent: Number(r.recipientCode.commissionPercent),
      },
      customPercent: Number(r.customPercent),
      reason: r.reason,
      isActive: r.isActive,
      createdBy: r.createdBy
        ? { id: r.createdBy.id, fullName: r.createdBy.fullName, email: r.createdBy.email }
        : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Crea o actualiza la excepción para (tenantId, recipientCodeId).
   * Si el percent o el flag cambian, registra una row en history con
   * los valores previos. Devuelve `hasPaidCommissions` para que el
   * frontend pueda mostrar la alerta correspondiente.
   */
  async upsert(args: {
    tenantId: string;
    recipientCodeId: string;
    customPercent: number;
    reason?: string | null;
    isActive?: boolean;
    createdById?: string | null;
  }) {
    this.assertValidPercent(args.customPercent);

    const code = await this.prisma.referralCode.findUnique({
      where: { id: args.recipientCodeId },
      select: { id: true, role: true },
    });
    if (!code) throw new BadRequestException('ReferralCode no existe');
    // Solo niveles de la cadena de afiliados pueden recibir excepción.
    // SOCIO queda fuera (es global), pero los 3 roles AFFILIATE-like sí.
    if (!['INFLUENCER', 'AMBASSADOR', 'VENDOR'].includes(code.role)) {
      throw new BadRequestException(
        'El nivel seleccionado no admite excepciones de comisión',
      );
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { id: true },
    });
    if (!tenant) throw new BadRequestException('Cliente no existe');

    const isActive = args.isActive ?? true;
    const reason = args.reason?.trim() ? args.reason.trim().slice(0, 500) : null;

    const existing = await this.prisma.commissionException.findUnique({
      where: {
        tenantId_recipientCodeId: {
          tenantId: args.tenantId,
          recipientCodeId: args.recipientCodeId,
        },
      },
    });

    // Detección de comisiones PAID: para el feedback al admin antes/
    // después del cambio. No bloquea — solo informa.
    const paidCount = await this.prisma.commission.count({
      where: {
        recipientCodeId: args.recipientCodeId,
        status: 'PAID',
        referralUse: { tenantId: args.tenantId },
      },
    });
    const hasPaidCommissions = paidCount > 0;

    let result;
    if (existing) {
      const prevPercent = Number(existing.customPercent);
      const percentChanged = prevPercent !== args.customPercent;
      const activeChanged = existing.isActive !== isActive;
      result = await this.prisma.commissionException.update({
        where: { id: existing.id },
        data: {
          customPercent: args.customPercent,
          reason,
          isActive,
        },
      });
      if (percentChanged || activeChanged) {
        await this.prisma.commissionExceptionHistory.create({
          data: {
            exceptionId: existing.id,
            previousPercent: existing.customPercent,
            newPercent: args.customPercent,
            previousActive: existing.isActive,
            newActive: isActive,
            reason,
            changedById: args.createdById ?? null,
          },
        });
      }
    } else {
      result = await this.prisma.commissionException.create({
        data: {
          tenantId: args.tenantId,
          recipientCodeId: args.recipientCodeId,
          customPercent: args.customPercent,
          reason,
          isActive,
          createdById: args.createdById ?? null,
        },
      });
      await this.prisma.commissionExceptionHistory.create({
        data: {
          exceptionId: result.id,
          previousPercent: null,
          newPercent: args.customPercent,
          previousActive: null,
          newActive: isActive,
          reason,
          changedById: args.createdById ?? null,
        },
      });
    }

    // Fase E 2026-06-07: recálculo inmediato de comisiones PENDING/
    // APPROVED para el (tenant, recipientCode). Best-effort — si falla
    // el cambio igual queda persistido.
    await this.recalcAfterChange(
      args.tenantId,
      args.recipientCodeId,
      args.createdById,
      `Excepción ${existing ? 'editada' : 'creada'}: ${args.customPercent}%`,
    );

    return {
      exception: {
        id: result.id,
        tenantId: result.tenantId,
        recipientCodeId: result.recipientCodeId,
        customPercent: Number(result.customPercent),
        reason: result.reason,
        isActive: result.isActive,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
      hasPaidCommissions,
      paidCommissionCount: paidCount,
    };
  }

  /**
   * Patch parcial — el endpoint PATCH /:id solo modifica un row existente.
   * Para upserts (cuando no hay row) usar `upsert()`.
   */
  async patch(
    id: string,
    patch: {
      customPercent?: number;
      reason?: string | null;
      isActive?: boolean;
    },
    changedById?: string | null,
  ) {
    const existing = await this.prisma.commissionException.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Excepción no encontrada');

    if (patch.customPercent !== undefined) {
      this.assertValidPercent(patch.customPercent);
    }

    const newPercent =
      patch.customPercent !== undefined
        ? patch.customPercent
        : Number(existing.customPercent);
    const newActive = patch.isActive ?? existing.isActive;
    const newReason =
      patch.reason !== undefined
        ? patch.reason?.trim()
          ? patch.reason.trim().slice(0, 500)
          : null
        : existing.reason;

    const updated = await this.prisma.commissionException.update({
      where: { id },
      data: {
        customPercent: newPercent,
        isActive: newActive,
        reason: newReason,
      },
    });

    const percentChanged = Number(existing.customPercent) !== newPercent;
    const activeChanged = existing.isActive !== newActive;
    if (percentChanged || activeChanged) {
      await this.prisma.commissionExceptionHistory.create({
        data: {
          exceptionId: id,
          previousPercent: existing.customPercent,
          newPercent,
          previousActive: existing.isActive,
          newActive,
          reason: newReason,
          changedById: changedById ?? null,
        },
      });
      await this.recalcAfterChange(
        updated.tenantId,
        updated.recipientCodeId,
        changedById,
        `Excepción patcheada: ${newPercent}%`,
      );
    }

    return {
      id: updated.id,
      tenantId: updated.tenantId,
      recipientCodeId: updated.recipientCodeId,
      customPercent: Number(updated.customPercent),
      reason: updated.reason,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async disable(id: string, changedById: string | null, reason?: string | null) {
    const existing = await this.prisma.commissionException.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Excepción no encontrada');
    if (!existing.isActive) {
      return { ok: true, alreadyDisabled: true };
    }
    await this.prisma.commissionException.update({
      where: { id },
      data: { isActive: false },
    });
    await this.prisma.commissionExceptionHistory.create({
      data: {
        exceptionId: id,
        previousPercent: existing.customPercent,
        newPercent: existing.customPercent,
        previousActive: true,
        newActive: false,
        reason: reason?.trim()?.slice(0, 500) ?? null,
        changedById: changedById ?? null,
      },
    });
    await this.recalcAfterChange(
      existing.tenantId,
      existing.recipientCodeId,
      changedById,
      'Excepción desactivada — vuelve al % default',
    );
    return { ok: true, alreadyDisabled: false };
  }

  async getHistoryForException(id: string) {
    const exists = await this.prisma.commissionException.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Excepción no encontrada');
    const rows = await this.prisma.commissionExceptionHistory.findMany({
      where: { exceptionId: id },
      include: {
        changedBy: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { changedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      previousPercent: r.previousPercent !== null ? Number(r.previousPercent) : null,
      newPercent: Number(r.newPercent),
      previousActive: r.previousActive,
      newActive: r.newActive,
      reason: r.reason,
      changedBy: r.changedBy
        ? { id: r.changedBy.id, fullName: r.changedBy.fullName, email: r.changedBy.email }
        : null,
      changedAt: r.changedAt,
    }));
  }

  private assertValidPercent(value: number) {
    if (!Number.isFinite(value) || value < 0.01 || value > 100) {
      throw new BadRequestException(
        'El porcentaje debe estar entre 0.01 y 100',
      );
    }
  }

  /**
   * Resuelve el % efectivo para un (tenant, recipientCode):
   * si existe una excepción activa, ese % gana; sino, fallback.
   * Helper compartido — antes vivía duplicado en hotmart.service y
   * referrals.service con nombres distintos (riesgo de drift).
   */
  async resolvePercent(
    tenantId: string,
    recipientCodeId: string,
    fallbackPercent: number,
  ): Promise<number> {
    const exc = await this.prisma.commissionException.findUnique({
      where: { tenantId_recipientCodeId: { tenantId, recipientCodeId } },
      select: { customPercent: true, isActive: true },
    });
    if (exc && exc.isActive) return Number(exc.customPercent);
    return fallbackPercent;
  }

  /**
   * Recalcula commissions PENDING/APPROVED para TODAS las excepciones
   * activas. Útil para corregir registros históricos cuando el recalc
   * automático no corrió (bug pre-2026-06-07 con ModuleRef silencioso).
   */
  async forceRecalcAllActive(actorId: string | null) {
    const exceptions = await this.prisma.commissionException.findMany({
      where: { isActive: true },
      select: {
        id: true,
        tenantId: true,
        recipientCodeId: true,
        customPercent: true,
      },
    });
    this.logger.log(
      `forceRecalcAllActive: ${exceptions.length} excepciones activas`,
    );
    let totalUpdated = 0;
    let totalPaidSkipped = 0;
    for (const e of exceptions) {
      const summary = await this.recalc.recalcForRecipientCode({
        recipientCodeId: e.recipientCodeId,
        tenantId: e.tenantId,
        actorId,
        reason: `Recalc retroactivo manual — excepción ${e.id} (${Number(e.customPercent)}%)`,
      });
      totalUpdated += summary.updated;
      totalPaidSkipped += summary.skippedPaid;
    }
    return {
      exceptionsProcessed: exceptions.length,
      commissionsUpdated: totalUpdated,
      paidSkipped: totalPaidSkipped,
    };
  }
}
