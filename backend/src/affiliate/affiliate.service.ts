import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);

/**
 * Servicio scoped al usuario autenticado: nunca expone datos de OTRO
 * influencer/embajador. Toda query parte de los `ReferralCode` cuyo
 * `ownerUserId` es el usuario actual.
 */
@Injectable()
export class AffiliateService {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  private assertAffiliate(user: AuthUser) {
    if (
      user.role !== 'AFFILIATE_INFLUENCER' &&
      user.role !== 'AFFILIATE_AMBASSADOR' &&
      user.role !== 'AFFILIATE_SOCIO'
    ) {
      throw new ForbiddenException('No es un afiliado');
    }
  }

  /**
   * Devuelve TODOS los códigos del afiliado: su código directo + (si es
   * influencer) los códigos de sus embajadores.
   */
  private async myCodes(userId: string) {
    return this.prisma.referralCode.findMany({
      where: {
        OR: [
          { ownerUserId: userId },
          // Si es influencer, también incluye sus embajadores (parent === su code).
          { parentCode: { ownerUserId: userId } },
        ],
      },
      include: { parentCode: true, ownerOfCampaign: true },
    });
  }

  async me(user: AuthUser) {
    this.assertAffiliate(user);
    const userRow = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, fullName: true, phone: true, role: true, lastLoginAt: true },
    });
    const codes = await this.myCodes(user.id);
    const myCode = codes.find((c) => c.ownerUserId === user.id) ?? null;
    return {
      user: userRow,
      role: user.role,
      myCode: myCode
        ? {
            id: myCode.id,
            code: myCode.code,
            commissionPercent: Number(myCode.commissionPercent),
            role: myCode.role,
            parentCode: myCode.parentCode?.code ?? null,
            parentName: myCode.parentCode?.ownerName ?? null,
            campaignName: myCode.ownerOfCampaign?.name ?? null,
          }
        : null,
      ambassadors:
        user.role === 'AFFILIATE_INFLUENCER'
          ? codes
              .filter((c) => c.role === 'AMBASSADOR')
              .map((c) => ({
                id: c.id,
                code: c.code,
                ownerName: c.ownerName,
                commissionPercent: Number(c.commissionPercent),
                isActive: c.isActive,
              }))
          : [],
    };
  }

  async clients(user: AuthUser) {
    this.assertAffiliate(user);
    const codes = await this.myCodes(user.id);
    const codeIds = codes.map((c) => c.id);
    const uses = await this.prisma.referralUse.findMany({
      where: { referralCodeId: { in: codeIds } },
      include: {
        tenant: { select: { brandName: true, status: true, plan: { select: { name: true } } } },
        referralCode: { select: { code: true, role: true, ownerName: true } },
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return uses.map((u) => ({
      id: u.id,
      tenantBrand: u.tenant?.brandName ?? '—',
      plan: u.tenant?.plan?.name ?? '—',
      status: u.status,
      attribution: {
        code: u.referralCode.code,
        role: u.referralCode.role,
        ownerName: u.referralCode.ownerName,
      },
      signedUpAt: u.createdAt,
      convertedAt: u.convertedAt,
      commissionsCount: u.commissions.length,
      commissionsTotalUsd:
        Math.round(u.commissions.reduce((s, c) => s + Number(c.amount), 0) * 100) / 100,
    }));
  }

  async updateProfile(
    user: AuthUser,
    patch: { fullName?: string; phone?: string },
  ) {
    this.assertAffiliate(user);
    const data: any = {};
    if (patch.fullName?.trim()) data.fullName = patch.fullName.trim();
    if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
    if (!Object.keys(data).length) {
      throw new BadRequestException('Sin cambios');
    }
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data,
      select: { id: true, email: true, fullName: true, phone: true, role: true },
    });
    // También actualizamos los campos en su ReferralCode (usados por
    // notificaciones y panel del admin) para que queden consistentes.
    if (data.fullName || data.phone !== undefined) {
      await this.prisma.referralCode.updateMany({
        where: { ownerUserId: user.id },
        data: {
          ...(data.fullName ? { ownerName: data.fullName } : {}),
          ...(data.phone !== undefined ? { ownerWhatsapp: data.phone ?? '' } : {}),
        },
      });
    }
    return updated;
  }

  /**
   * Endpoint que permite al INFLUENCER crear sus propios embajadores
   * desde su panel. Requiere que el toggle global
   * `referrals.allowInfluencerCreatesAmbassadors` esté en 'true'.
   *
   * Si `referrals.requireAmbassadorApproval` = 'true', el embajador queda
   * con `approvedAt = null` hasta que un super admin lo apruebe — sus
   * comisiones se generan igual pero el panel admin las marca como
   * "pendientes de aprobación".
   */
  async createAmbassadorAsInfluencer(
    user: AuthUser,
    dto: { fullName: string; email: string; whatsapp: string; commissionPercent?: number },
  ) {
    if (user.role !== 'AFFILIATE_INFLUENCER') {
      throw new ForbiddenException('Solo influencers pueden crear embajadores');
    }
    const allowSetting = await this.prisma.setting.findUnique({
      where: { key: 'referrals.allowInfluencerCreatesAmbassadors' },
    });
    if (allowSetting?.value !== 'true') {
      throw new ForbiddenException(
        'El admin no habilitó la creación de embajadores por influencer',
      );
    }
    // Encontrar mi código de influencer (debería ser único).
    const myCode = await this.prisma.referralCode.findFirst({
      where: { ownerUserId: user.id, role: 'INFLUENCER' },
      include: { ownerOfCampaign: true },
    });
    if (!myCode) throw new ForbiddenException('No tienes código de influencer');

    const requireApproval = await this.prisma.setting.findUnique({
      where: { key: 'referrals.requireAmbassadorApproval' },
    });
    const needsApproval = requireApproval?.value === 'true';

    // Generar código único.
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }

    const email = dto.email.trim().toLowerCase();
    const ambassador = await this.prisma.referralCode.create({
      data: {
        code,
        ownerName: dto.fullName.trim(),
        ownerEmail: email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? 25,
        role: 'AMBASSADOR',
        parentCodeId: myCode.id,
        campaignId: myCode.campaignId ?? myCode.ownerOfCampaign?.id ?? null,
        approvedAt: needsApproval ? null : new Date(),
      },
    });

    // Auto-invite al embajador.
    await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName,
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: ambassador.id,
        phone: dto.whatsapp,
      })
      .catch(() => null);

    return ambassador;
  }

  async commissions(user: AuthUser) {
    this.assertAffiliate(user);
    const codes = await this.myCodes(user.id);
    const codeIds = codes.map((c) => c.id);
    const items = await this.prisma.commission.findMany({
      where: { referralUse: { referralCodeId: { in: codeIds } } },
      include: {
        referralUse: {
          include: {
            tenant: { select: { brandName: true } },
            referralCode: { select: { code: true, ownerName: true, ownerUserId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    let pendingUsd = 0;
    let approvedUsd = 0;
    let paidUsd = 0;
    for (const c of items) {
      const a = Number(c.amount);
      if (c.status === 'PAID') paidUsd += a;
      else if (c.status === 'APPROVED') approvedUsd += a;
      else if (c.status === 'PENDING') pendingUsd += a;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      totals: {
        pendingUsd: round(pendingUsd),
        approvedUsd: round(approvedUsd),
        paidUsd: round(paidUsd),
        count: items.length,
      },
      items: items.map((c) => {
        const isMine = c.referralUse?.referralCode?.ownerUserId === user.id;
        return {
          id: c.id,
          amount: Number(c.amount),
          status: c.status,
          createdAt: c.createdAt,
          paidAt: c.paidAt,
          tenantBrand: c.referralUse?.tenant?.brandName ?? '—',
          via: isMine
            ? 'directa'
            : `embajador ${c.referralUse?.referralCode?.ownerName ?? ''}`,
          codeText: c.referralUse?.referralCode?.code ?? '',
        };
      }),
    };
  }
}
