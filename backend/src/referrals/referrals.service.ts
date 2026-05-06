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
  source?: string;
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
    const cleanSource = dto.source?.trim().slice(0, 60) || null;
    const referral = await this.prisma.referralCode.create({
      data: {
        code,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? 25,
        source: cleanSource,
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

  /**
   * Leaderboard: agrega por afiliado (matcheado por email del code), suma
   * inscritos / conversiones / revenue generado / comisiones pagadas y
   * pendientes. Ordenado por conversiones desc.
   */
  async leaderboard(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const codes = await this.prisma.referralCode.findMany({
      include: {
        uses: {
          include: { commissions: true },
        },
      },
    });

    type Row = {
      ownerName: string;
      ownerEmail: string;
      ownerWhatsapp: string;
      codes: string[];
      totalReferrals: number;
      paidConversions: number;
      commissionsPaidUsd: number;
      commissionsPendingUsd: number;
      revenueGeneratedUsd: number;
    };

    const map = new Map<string, Row>();
    for (const c of codes) {
      const key = c.ownerEmail.toLowerCase();
      const row = map.get(key) ?? {
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        codes: [],
        totalReferrals: 0,
        paidConversions: 0,
        commissionsPaidUsd: 0,
        commissionsPendingUsd: 0,
        revenueGeneratedUsd: 0,
      };
      row.codes.push(c.code);
      row.totalReferrals += c.uses.length;
      for (const u of c.uses) {
        if (u.status === 'PAYING' || u.status === 'ACTIVE') row.paidConversions++;
        for (const com of u.commissions) {
          const amt = Number(com.amount);
          row.revenueGeneratedUsd += amt;
          if (com.status === 'PAID') row.commissionsPaidUsd += amt;
          else if (com.status === 'PENDING' || com.status === 'APPROVED')
            row.commissionsPendingUsd += amt;
        }
      }
      map.set(key, row);
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    return Array.from(map.values())
      .map((r) => ({
        ...r,
        commissionsPaidUsd: round(r.commissionsPaidUsd),
        commissionsPendingUsd: round(r.commissionsPendingUsd),
        revenueGeneratedUsd: round(r.revenueGeneratedUsd),
      }))
      .sort((a, b) => {
        if (b.paidConversions !== a.paidConversions)
          return b.paidConversions - a.paidConversions;
        if (b.totalReferrals !== a.totalReferrals)
          return b.totalReferrals - a.totalReferrals;
        return b.commissionsPaidUsd - a.commissionsPaidUsd;
      });
  }

  /**
   * Payouts: comisiones con regla de 30 días de hold.
   * - Si una comisión PENDING ya cumplió 30 días desde createdAt, se
   *   auto-promueve a APPROVED ("disponible para pagar") antes de devolver.
   * - Filtros: status, dateFrom/dateTo (sobre createdAt), q (busca por
   *   nombre/email del owner o brand del tenant).
   * - Devuelve los items más totales agregados.
   */
  async payouts(
    user: AuthUser,
    opts: {
      status?: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED' | 'AVAILABLE_OR_PENDING';
      dateFrom?: string;
      dateTo?: string;
      q?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const HOLD_DAYS = 30;
    const cutoff = new Date(Date.now() - HOLD_DAYS * 24 * 60 * 60 * 1000);

    // Auto-promover PENDING → APPROVED si cumplió 30 días
    await this.prisma.commission.updateMany({
      where: {
        status: 'PENDING',
        createdAt: { lte: cutoff },
      },
      data: { status: 'APPROVED' },
    });

    const where: any = {};
    if (opts.status === 'AVAILABLE_OR_PENDING') {
      where.status = { in: ['PENDING', 'APPROVED'] };
    } else if (opts.status) {
      where.status = opts.status;
    }
    if (opts.dateFrom || opts.dateTo) {
      where.createdAt = {};
      if (opts.dateFrom) where.createdAt.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.createdAt.lte = new Date(opts.dateTo);
    }

    const all = await this.prisma.commission.findMany({
      where,
      include: {
        referralUse: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            referralCode: {
              select: { ownerName: true, ownerEmail: true, ownerWhatsapp: true, code: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Filtro por texto en server (sobre los joins)
    const term = opts.q?.trim().toLowerCase();
    const filtered = term
      ? all.filter((c) => {
          const r = c.referralUse?.referralCode;
          const t = c.referralUse?.tenant;
          const hay = `${r?.ownerName ?? ''} ${r?.ownerEmail ?? ''} ${r?.code ?? ''} ${t?.brandName ?? ''}`.toLowerCase();
          return hay.includes(term);
        })
      : all;

    const items = filtered.map((c) => {
      const r = c.referralUse?.referralCode;
      const t = c.referralUse?.tenant;
      const availableAt = new Date(
        new Date(c.createdAt).getTime() + HOLD_DAYS * 24 * 60 * 60 * 1000,
      );
      return {
        id: c.id,
        amount: Number(c.amount),
        currency: c.currency,
        status: c.status,
        createdAt: c.createdAt,
        availableAt,
        paidAt: c.paidAt,
        ownerName: r?.ownerName ?? '—',
        ownerEmail: r?.ownerEmail ?? '',
        ownerWhatsapp: r?.ownerWhatsapp ?? '',
        codeText: r?.code ?? '',
        tenantBrand: t?.brandName ?? '—',
      };
    });

    // Agregados sobre TODA la base (no filtrada) para que los KPIs no
    // dependan del filtro actual del UI.
    const allRaw = await this.prisma.commission.findMany();
    const round = (n: number) => Math.round(n * 100) / 100;
    let availableUsd = 0;
    let pendingUsd = 0;
    let paidUsd = 0;
    for (const c of allRaw) {
      const amt = Number(c.amount);
      if (c.status === 'APPROVED') availableUsd += amt;
      else if (c.status === 'PENDING') pendingUsd += amt;
      else if (c.status === 'PAID') paidUsd += amt;
    }

    return {
      items,
      totals: {
        availableUsd: round(availableUsd),
        pendingUsd: round(pendingUsd),
        paidUsd: round(paidUsd),
        count: items.length,
      },
      holdDays: HOLD_DAYS,
    };
  }
}
