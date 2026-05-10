import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
  private logger = new Logger(ReferralsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Cron diario que reconcilia comisiones recurrentes. Defensa en
   * profundidad por si el webhook Hotmart no llegó en algún ciclo
   * (problemas de red, payload distinto, etc).
   *
   * Lógica:
   *   1. Para cada ReferralUse en estado PAYING/ACTIVE
   *   2. Cuyo tenant esté ACTIVE y currentPeriodEnd > now (sigue suscrito)
   *   3. Cuya última Commission sea > 28 días (próximo ciclo)
   *   4. Crea una nueva Commission PENDING con el plan.priceMonthly *
   *      referralCode.commissionPercent / 100.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async reconcileRecurringCommissions() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 28 * 86400_000);

    const candidates = await this.prisma.referralUse.findMany({
      where: {
        status: { in: ['PAYING', 'ACTIVE'] },
        tenantId: { not: null },
        tenant: {
          status: 'ACTIVE',
          currentPeriodEnd: { gt: now },
        },
      },
      include: {
        referralCode: { select: { commissionPercent: true } },
        tenant: { select: { plan: { select: { priceMonthly: true } } } },
        commissions: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    let created = 0;
    for (const use of candidates) {
      const last = use.commissions[0];
      if (last && new Date(last.createdAt) > cutoff) continue;
      const price = Number(use.tenant?.plan?.priceMonthly ?? 0);
      if (price <= 0) continue;
      const pct = Number(use.referralCode.commissionPercent ?? 25);
      const amount = Math.round((price * pct) / 100 * 100) / 100;
      await this.prisma.commission.create({
        data: { referralUseId: use.id, amount, status: 'PENDING' },
      });
      created += 1;
    }

    if (created > 0) {
      this.logger.log(`Reconciled recurring commissions: created=${created}`);
    }
  }

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

  // ============================================================
  //              FASE 4 — Admin: dashboard + listas
  // ============================================================

  /**
   * Resumen global del módulo. Agrega TODO lo que necesita el tab
   * "Resumen" del admin: KPIs, top campañas, top influencers, top
   * embajadores, breakdown por estado de comisiones.
   */
  async adminSummary(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();

    const [campaigns, codes, uses, commissions, coupons] = await Promise.all([
      this.prisma.campaign.findMany({
        include: {
          ownerCode: { include: { uses: { include: { commissions: true } } } },
          codes: { include: { uses: { include: { commissions: true } } } },
        },
      }),
      this.prisma.referralCode.findMany({ where: { isActive: true } }),
      this.prisma.referralUse.findMany({
        include: {
          referralCode: { select: { role: true, ownerName: true, code: true } },
        },
      }),
      this.prisma.commission.findMany(),
      this.prisma.coupon.findMany({
        select: { id: true, status: true, useCount: true, discountPercent: true },
      }),
    ]);

    const round = (n: number) => Math.round(n * 100) / 100;
    let mrrUsd = 0;
    let commPaidUsd = 0;
    let commPendingUsd = 0;
    let commApprovedUsd = 0;
    let commRejectedUsd = 0;
    for (const c of commissions) {
      const a = Number(c.amount);
      if (c.status === 'PAID') commPaidUsd += a;
      else if (c.status === 'APPROVED') commApprovedUsd += a;
      else if (c.status === 'PENDING') commPendingUsd += a;
      else if (c.status === 'REJECTED') commRejectedUsd += a;
    }
    // MRR estimado: comisiones del último mes calendárico de uses PAYING/ACTIVE.
    const oneMonthAgo = Date.now() - 30 * 86400_000;
    for (const c of commissions) {
      if (new Date(c.createdAt).getTime() >= oneMonthAgo && c.status !== 'REJECTED') {
        mrrUsd += Number(c.amount);
      }
    }

    const activeUses = uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE');
    const churnedUses = uses.filter((u) => u.status === 'CHURNED');
    const trialUses = uses.filter((u) => u.status === 'SIGNED_UP');

    const influencerCount = codes.filter((c) => c.role === 'INFLUENCER').length;
    const ambassadorCount = codes.filter((c) => c.role === 'AMBASSADOR').length;

    // Discount aplicado: suma de discountPercent * useCount * priceMonthly aprox.
    // Nivel de detalle suficiente para el dashboard, no para contabilidad.
    const discountUsedUsd = coupons.reduce(
      (s, c) => s + Number(c.discountPercent) * c.useCount,
      0,
    );

    // Top campañas por MRR generado (últimos 30d).
    const campaignRows = campaigns.map((camp) => {
      const allUses = [
        ...camp.ownerCode.uses,
        ...camp.codes.flatMap((c) => c.uses),
      ];
      const recentMrr = allUses
        .flatMap((u) => u.commissions)
        .filter(
          (c) =>
            c.status !== 'REJECTED' &&
            new Date(c.createdAt).getTime() >= oneMonthAgo,
        )
        .reduce((s, c) => s + Number(c.amount), 0);
      return {
        id: camp.id,
        name: camp.name,
        ownerCode: camp.ownerCode.code,
        ownerName: camp.ownerCode.ownerName,
        status: camp.status,
        ambassadors: camp.codes.length,
        activeClients: allUses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        mrrUsd: round(recentMrr),
      };
    });

    // Comisión socio: suma de comisiones del use cuyo code tiene role=SOCIO.
    const socioCommissions = uses
      .filter((u) => u.referralCode.role === 'SOCIO')
      .flatMap(() => []);
    const socioRows = uses.filter((u) => u.referralCode.role === 'SOCIO');
    let socioPaidUsd = 0;
    let socioPendingUsd = 0;
    for (const u of socioRows) {
      const ucs = commissions.filter((c) => c.referralUseId === u.id);
      for (const c of ucs) {
        const a = Number(c.amount);
        if (c.status === 'PAID') socioPaidUsd += a;
        else if (c.status === 'PENDING' || c.status === 'APPROVED') socioPendingUsd += a;
      }
    }

    return {
      kpis: {
        activeCampaigns: campaigns.filter((c) => c.status === 'ACTIVE').length,
        totalCampaigns: campaigns.length,
        influencerCount,
        ambassadorCount,
        totalReferredClients: uses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        activeClients: activeUses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        churnedClients: churnedUses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        trialClients: trialUses.filter((u) => u.referralCode.role !== 'SOCIO').length,
        mrrUsd: round(mrrUsd),
        commPaidUsd: round(commPaidUsd),
        commPendingUsd: round(commPendingUsd + commApprovedUsd),
        commRejectedUsd: round(commRejectedUsd),
        socioPaidUsd: round(socioPaidUsd),
        socioPendingUsd: round(socioPendingUsd),
        discountUsedUsd: round(discountUsedUsd),
        netoEmpresaUsd: round(commissions.length === 0 ? 0 : 0), // placeholder; F5 calcula real
      },
      topCampaigns: campaignRows
        .sort((a, b) => b.mrrUsd - a.mrrUsd)
        .slice(0, 5),
    };
  }

  async listInfluencers(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const codes = await this.prisma.referralCode.findMany({
      where: { role: 'INFLUENCER' },
      include: {
        ownerOfCampaign: true,
        ambassadors: { select: { id: true, isActive: true } },
        uses: { include: { commissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return codes.map((c) => {
      const directUses = c.uses;
      const directActive = directUses.filter(
        (u) => u.status === 'PAYING' || u.status === 'ACTIVE',
      ).length;
      const allComm = directUses.flatMap((u) => u.commissions);
      const paid = allComm.filter((x) => x.status === 'PAID').reduce((s, x) => s + Number(x.amount), 0);
      const pending = allComm
        .filter((x) => x.status === 'PENDING' || x.status === 'APPROVED')
        .reduce((s, x) => s + Number(x.amount), 0);
      return {
        id: c.id,
        code: c.code,
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        campaignName: c.ownerOfCampaign?.name ?? null,
        ambassadorsCount: c.ambassadors.filter((a) => a.isActive).length,
        directClients: directUses.length,
        directActiveClients: directActive,
        paidUsd: Math.round(paid * 100) / 100,
        pendingUsd: Math.round(pending * 100) / 100,
        createdAt: c.createdAt,
      };
    });
  }

  async listAmbassadors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const codes = await this.prisma.referralCode.findMany({
      where: { role: 'AMBASSADOR' },
      include: {
        parentCode: { select: { code: true, ownerName: true } },
        campaign: { select: { name: true } },
        uses: { include: { commissions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return codes.map((c) => {
      const allComm = c.uses.flatMap((u) => u.commissions);
      const paid = allComm.filter((x) => x.status === 'PAID').reduce((s, x) => s + Number(x.amount), 0);
      const pending = allComm
        .filter((x) => x.status === 'PENDING' || x.status === 'APPROVED')
        .reduce((s, x) => s + Number(x.amount), 0);
      return {
        id: c.id,
        code: c.code,
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        parentCode: c.parentCode?.code ?? null,
        parentName: c.parentCode?.ownerName ?? null,
        campaignName: c.campaign?.name ?? null,
        clients: c.uses.length,
        activeClients: c.uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        paidUsd: Math.round(paid * 100) / 100,
        pendingUsd: Math.round(pending * 100) / 100,
        createdAt: c.createdAt,
      };
    });
  }

  async listClients(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const uses = await this.prisma.referralUse.findMany({
      where: { tenantId: { not: null } },
      include: {
        tenant: {
          select: {
            brandName: true,
            status: true,
            currentPeriodEnd: true,
            plan: { select: { name: true } },
          },
        },
        referralCode: {
          select: { code: true, ownerName: true, role: true, parentCode: { select: { code: true, ownerName: true } } },
        },
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return uses
      .filter((u) => u.referralCode.role !== 'SOCIO')
      .map((u) => ({
        id: u.id,
        tenantBrand: u.tenant?.brandName ?? '—',
        tenantStatus: u.tenant?.status ?? '—',
        plan: u.tenant?.plan?.name ?? '—',
        currentPeriodEnd: u.tenant?.currentPeriodEnd ?? null,
        attribution: {
          role: u.referralCode.role,
          code: u.referralCode.code,
          ownerName: u.referralCode.ownerName,
          parentCode: u.referralCode.parentCode?.code ?? null,
          parentName: u.referralCode.parentCode?.ownerName ?? null,
        },
        status: u.status,
        signedUpAt: u.createdAt,
        convertedAt: u.convertedAt,
        commissionsCount: u.commissions.length,
        commissionsTotalUsd:
          Math.round(
            u.commissions.reduce((s, c) => s + Number(c.amount), 0) * 100,
          ) / 100,
      }));
  }

  /**
   * GET configuración del módulo. Lee los Setting keys
   * `referrals.*` y los devuelve con defaults.
   */
  async getConfig(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const keys = [
      'referrals.socioCodeId',
      'referrals.indirectPercent',
      'referrals.defaultInfluencerPercent',
      'referrals.defaultAmbassadorPercent',
      'referrals.holdDays',
      'referrals.minPayoutUsd',
      'referrals.notifyPaymentFailed',
      'referrals.notifyChurn',
    ];
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const socioId = map.get('referrals.socioCodeId') ?? '';
    const socio = socioId
      ? await this.prisma.referralCode.findUnique({
          where: { id: socioId },
          select: { id: true, code: true, ownerName: true, commissionPercent: true, role: true },
        })
      : null;
    return {
      socioCodeId: socioId,
      socio,
      indirectPercent: Number(map.get('referrals.indirectPercent') ?? 5),
      defaultInfluencerPercent: Number(
        map.get('referrals.defaultInfluencerPercent') ?? 30,
      ),
      defaultAmbassadorPercent: Number(
        map.get('referrals.defaultAmbassadorPercent') ?? 25,
      ),
      holdDays: Number(map.get('referrals.holdDays') ?? 30),
      minPayoutUsd: Number(map.get('referrals.minPayoutUsd') ?? 0),
      notifyPaymentFailed: map.get('referrals.notifyPaymentFailed') !== 'false',
      notifyChurn: map.get('referrals.notifyChurn') !== 'false',
    };
  }

  async setConfig(
    user: AuthUser,
    patch: Partial<{
      socioCodeId: string | null;
      indirectPercent: number;
      defaultInfluencerPercent: number;
      defaultAmbassadorPercent: number;
      holdDays: number;
      minPayoutUsd: number;
      notifyPaymentFailed: boolean;
      notifyChurn: boolean;
    }>,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const upserts: Array<Promise<any>> = [];
    const writeKey = (key: string, value: string | null) => {
      if (value === null) {
        upserts.push(this.prisma.setting.delete({ where: { key } }).catch(() => null));
      } else {
        upserts.push(
          this.prisma.setting.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          }),
        );
      }
    };
    if ('socioCodeId' in patch) writeKey('referrals.socioCodeId', patch.socioCodeId ?? null);
    if ('indirectPercent' in patch)
      writeKey('referrals.indirectPercent', String(patch.indirectPercent ?? 5));
    if ('defaultInfluencerPercent' in patch)
      writeKey('referrals.defaultInfluencerPercent', String(patch.defaultInfluencerPercent ?? 30));
    if ('defaultAmbassadorPercent' in patch)
      writeKey('referrals.defaultAmbassadorPercent', String(patch.defaultAmbassadorPercent ?? 25));
    if ('holdDays' in patch) writeKey('referrals.holdDays', String(patch.holdDays ?? 30));
    if ('minPayoutUsd' in patch)
      writeKey('referrals.minPayoutUsd', String(patch.minPayoutUsd ?? 0));
    if ('notifyPaymentFailed' in patch)
      writeKey('referrals.notifyPaymentFailed', patch.notifyPaymentFailed ? 'true' : 'false');
    if ('notifyChurn' in patch)
      writeKey('referrals.notifyChurn', patch.notifyChurn ? 'true' : 'false');
    await Promise.all(upserts);
    return this.getConfig(user);
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
