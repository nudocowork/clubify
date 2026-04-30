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
