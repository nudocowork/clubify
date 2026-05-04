import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);

export type CreateReferralDto = {
  fullName: string;
  email: string;
  whatsapp: string;
  commissionPercent?: number;
};

@Injectable()
export class ReferralsService {
  constructor(private prisma: PrismaService) {}

  async createCode(dto: CreateReferralDto) {
    if (!dto.fullName || !dto.email || !dto.whatsapp) {
      throw new BadRequestException('fullName, email and whatsapp required');
    }
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    const referral = await this.prisma.referralCode.create({
      data: {
        code,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? 20,
      },
    });

    return {
      ...referral,
      shareLink: `${process.env.APP_URL ?? 'http://localhost:3000'}/?ref=${code}`,
    };
  }

  async list(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.referralCode.findMany({
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Devuelve los códigos del usuario autenticado (matcheando por email),
   * sus usos y comisiones, listos para el panel /app/referrals.
   */
  async listMine(user: AuthUser) {
    if (!user.email) return { codes: [], totals: { signedUp: 0, converted: 0, paidUsd: 0, pendingUsd: 0 } };

    const codes = await this.prisma.referralCode.findMany({
      where: { ownerEmail: user.email },
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';

    let signedUp = 0;
    let converted = 0;
    let paidUsd = 0;
    let pendingUsd = 0;

    const enriched = codes.map((c) => {
      const uses = c.uses ?? [];
      signedUp += uses.length;
      converted += uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length;
      for (const u of uses) {
        for (const com of u.commissions ?? []) {
          const amount = Number(com.amount);
          if (com.status === 'PAID') paidUsd += amount;
          else if (com.status === 'PENDING' || com.status === 'APPROVED') pendingUsd += amount;
        }
      }
      return {
        id: c.id,
        code: c.code,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        createdAt: c.createdAt,
        shareLink: `${appUrl}/?ref=${c.code}`,
        usesCount: uses.length,
        convertedCount: uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        uses: uses.map((u) => ({
          id: u.id,
          status: u.status,
          createdAt: u.createdAt,
          convertedAt: u.convertedAt,
          tenantBrand: u.tenant?.brandName ?? null,
          tenantStatus: u.tenant?.status ?? null,
          commissionsTotal: (u.commissions ?? []).reduce((s, x) => s + Number(x.amount), 0),
        })),
      };
    });

    return {
      codes: enriched,
      totals: {
        signedUp,
        converted,
        paidUsd: Math.round(paidUsd * 100) / 100,
        pendingUsd: Math.round(pendingUsd * 100) / 100,
      },
    };
  }

  async getByCode(code: string) {
    const r = await this.prisma.referralCode.findUnique({
      where: { code },
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
        },
      },
    });
    if (!r) throw new NotFoundException();
    return r;
  }

  async createCommission(useId: string, amount: number) {
    return this.prisma.commission.create({
      data: { referralUseId: useId, amount, status: 'PENDING' },
    });
  }

  async setCommissionStatus(id: string, status: CommissionStatus) {
    return this.prisma.commission.update({
      where: { id },
      data: {
        status,
        paidAt: status === 'PAID' ? new Date() : null,
      },
    });
  }
}
