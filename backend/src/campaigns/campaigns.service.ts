import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { CampaignStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);

export type CreateCampaignDto = {
  name: string;
  // Datos del influencer titular. Si no existe ReferralCode con ese
  // email, se crea uno nuevo con role=INFLUENCER. Si existe, se reusa
  // y solo se valida que sea INFLUENCER y no tenga otra campaña.
  influencerName: string;
  influencerEmail: string;
  influencerWhatsapp: string;
  influencerCommissionPercent?: number; // default 30
  influencerCustomCode?: string; // ej: "JUAN30" — si no, se genera
  discountAbsorption?: 'ORIGINAL_PRICE' | 'PAID_PRICE' | 'EMPRESA_ABSORBS' | 'PROPORTIONAL';
};

export type CreateAmbassadorDto = {
  fullName: string;
  email: string;
  whatsapp: string;
  commissionPercent?: number; // default 25
  customCode?: string;
};

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  private assertAdmin(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Solo super admin puede gestionar campañas');
    }
  }

  /**
   * Genera un código único. Si `preferred` viene, lo intenta; si choca o
   * no es válido, cae al random. Códigos siempre upper-case y alfanum.
   */
  private async resolveCode(preferred?: string): Promise<string> {
    if (preferred) {
      const clean = preferred.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length >= 3 && clean.length <= 24) {
        const exists = await this.prisma.referralCode.findUnique({
          where: { code: clean },
        });
        if (!exists) return clean;
      }
    }
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }
    return code;
  }

  async create(user: AuthUser, dto: CreateCampaignDto) {
    this.assertAdmin(user);
    if (!dto.name?.trim()) throw new BadRequestException('Falta nombre de campaña');

    // Match-or-create del influencer.
    const email = dto.influencerEmail.trim().toLowerCase();
    let influencerCode = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'INFLUENCER' },
      include: { ownerOfCampaign: true },
    });

    if (influencerCode?.ownerOfCampaign) {
      throw new BadRequestException(
        `Este influencer ya tiene la campaña "${influencerCode.ownerOfCampaign.name}". Crea otra cuenta o reúsala.`,
      );
    }

    if (!influencerCode) {
      const code = await this.resolveCode(dto.influencerCustomCode);
      influencerCode = await this.prisma.referralCode.create({
        data: {
          code,
          ownerName: dto.influencerName,
          ownerEmail: email,
          ownerWhatsapp: dto.influencerWhatsapp,
          commissionPercent: dto.influencerCommissionPercent ?? 30,
          role: 'INFLUENCER',
        },
        include: { ownerOfCampaign: true },
      });
    }

    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name.trim(),
        ownerCodeId: influencerCode.id,
        status: 'ACTIVE',
        discountAbsorption: dto.discountAbsorption ?? 'PROPORTIONAL',
      },
      include: {
        ownerCode: true,
        codes: { where: { role: 'AMBASSADOR' } },
      },
    });

    // Auto-invitar al influencer al panel de afiliado.
    await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.influencerName,
        role: 'AFFILIATE_INFLUENCER',
        referralCodeId: influencerCode.id,
        phone: dto.influencerWhatsapp,
      })
      .catch(() => null);

    return campaign;
  }

  async list(user: AuthUser) {
    this.assertAdmin(user);
    const campaigns = await this.prisma.campaign.findMany({
      include: {
        ownerCode: {
          include: {
            uses: {
              where: { status: { in: ['PAYING', 'ACTIVE'] } },
              select: { id: true },
            },
          },
        },
        codes: {
          where: { role: 'AMBASSADOR' },
          include: {
            uses: {
              where: { status: { in: ['PAYING', 'ACTIVE'] } },
              include: { commissions: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return campaigns.map((c) => {
      const directClients = c.ownerCode.uses.length;
      const indirectClients = c.codes.reduce((s, a) => s + a.uses.length, 0);
      const ambassadorCommissions = c.codes
        .flatMap((a) => a.uses.flatMap((u) => u.commissions))
        .reduce((s, x) => s + Number(x.amount), 0);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        discountAbsorption: c.discountAbsorption,
        createdAt: c.createdAt,
        ownerCode: {
          id: c.ownerCode.id,
          code: c.ownerCode.code,
          ownerName: c.ownerCode.ownerName,
          commissionPercent: Number(c.ownerCode.commissionPercent),
        },
        ambassadorsCount: c.codes.length,
        directClients,
        indirectClients,
        totalActiveClients: directClients + indirectClients,
        ambassadorCommissionsUsd: Math.round(ambassadorCommissions * 100) / 100,
      };
    });
  }

  async get(user: AuthUser, id: string) {
    this.assertAdmin(user);
    const c = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        ownerCode: {
          include: {
            uses: {
              include: {
                tenant: { select: { brandName: true, status: true } },
                commissions: true,
              },
            },
          },
        },
        codes: {
          where: { role: 'AMBASSADOR' },
          include: {
            uses: {
              include: {
                tenant: { select: { brandName: true, status: true } },
                commissions: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!c) throw new NotFoundException('Campaña');
    return c;
  }

  async update(
    user: AuthUser,
    id: string,
    patch: { name?: string; status?: CampaignStatus; discountAbsorption?: string },
  ) {
    this.assertAdmin(user);
    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: patch.name?.trim(),
        status: patch.status,
        discountAbsorption: patch.discountAbsorption,
      },
    });
  }

  async addAmbassador(user: AuthUser, campaignId: string, dto: CreateAmbassadorDto) {
    this.assertAdmin(user);
    const camp = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { ownerCode: true },
    });
    if (!camp) throw new NotFoundException('Campaña');

    const email = dto.email.trim().toLowerCase();
    const dup = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'AMBASSADOR', parentCodeId: camp.ownerCodeId },
    });
    if (dup) {
      throw new BadRequestException('Ya existe un embajador con ese email en esta campaña');
    }

    const code = await this.resolveCode(dto.customCode);
    const ambassadorCode = await this.prisma.referralCode.create({
      data: {
        code,
        ownerName: dto.fullName.trim(),
        ownerEmail: email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? 25,
        role: 'AMBASSADOR',
        parentCodeId: camp.ownerCodeId,
        campaignId: camp.id,
      },
    });

    await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName,
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: ambassadorCode.id,
        phone: dto.whatsapp,
      })
      .catch(() => null);

    return ambassadorCode;
  }

  async removeAmbassador(user: AuthUser, ambassadorId: string) {
    this.assertAdmin(user);
    const code = await this.prisma.referralCode.findUnique({
      where: { id: ambassadorId },
    });
    if (!code || code.role !== 'AMBASSADOR') {
      throw new NotFoundException('Embajador');
    }
    // Soft-delete: marcamos isActive=false. No borramos para preservar
    // historial de comisiones y atribución.
    await this.prisma.referralCode.update({
      where: { id: ambassadorId },
      data: { isActive: false },
    });
    return { ok: true };
  }
}
