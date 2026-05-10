import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Servicio scoped al usuario autenticado: nunca expone datos de OTRO
 * influencer/embajador. Toda query parte de los `ReferralCode` cuyo
 * `ownerUserId` es el usuario actual.
 */
@Injectable()
export class AffiliateService {
  constructor(private prisma: PrismaService) {}

  private assertAffiliate(user: AuthUser) {
    if (
      user.role !== 'AFFILIATE_INFLUENCER' &&
      user.role !== 'AFFILIATE_AMBASSADOR'
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
