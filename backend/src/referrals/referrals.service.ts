import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { customAlphabet } from 'nanoid';
import { CommissionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';

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

  constructor(private prisma: PrismaService, private auth: AuthService) {}

  /**
   * Slugify del nombre del afiliado para link corto `/ref/<slug>`.
   * Cae al `code` lowercase si el slug ideal está tomado o queda vacío.
   */
  private slugify(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  private async allocateSlug(ownerName: string, fallbackCode: string): Promise<string> {
    const base = this.slugify(ownerName) || fallbackCode.toLowerCase();
    let candidate = base;
    let suffix = 2;
    // Probamos hasta 50 variantes: nombre, nombre-2, nombre-3, ...
    // Si todas chocan, caemos al lowercase del código (siempre único).
    while (await this.prisma.referralCode.findUnique({ where: { slug: candidate } })) {
      candidate = `${base}-${suffix++}`;
      if (suffix > 50) {
        candidate = fallbackCode.toLowerCase();
        if (!(await this.prisma.referralCode.findUnique({ where: { slug: candidate } }))) {
          return candidate;
        }
        candidate = `${fallbackCode.toLowerCase()}-${Date.now().toString(36).slice(-4)}`;
        break;
      }
    }
    return candidate;
  }

  /**
   * Resuelve `/ref/<slug>` → ReferralCode + loguea visita (UTM, referer,
   * país, IP). Si el slug no matchea, igual loguea con referralCodeId=null
   * para análisis de slugs rotos / phishing-like.
   */
  async resolveBySlug(
    slug: string,
    ctx: {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      userAgent?: string;
      referer?: string;
      country?: string;
      ip?: string;
    },
  ) {
    const clean = (slug || '').toLowerCase().trim().slice(0, 80);
    if (!clean) throw new BadRequestException('slug required');

    const code = await this.prisma.referralCode.findUnique({
      where: { slug: clean },
      select: {
        id: true,
        code: true,
        slug: true,
        ownerName: true,
        isActive: true,
        approvedAt: true,
        role: true,
        campaign: { select: { id: true, name: true, status: true } },
      },
    });

    // Loguear visita siempre (incluso si slug no existe) — fire-and-forget.
    this.prisma.referralVisit
      .create({
        data: {
          slug: clean,
          referralCodeId: code?.id ?? null,
          ip: ctx.ip?.slice(0, 60) ?? null,
          userAgent: ctx.userAgent?.slice(0, 500) ?? null,
          country: ctx.country?.slice(0, 8) ?? null,
          referer: ctx.referer?.slice(0, 1000) ?? null,
          utmSource: ctx.utmSource?.slice(0, 80) ?? null,
          utmMedium: ctx.utmMedium?.slice(0, 80) ?? null,
          utmCampaign: ctx.utmCampaign?.slice(0, 80) ?? null,
        },
      })
      .catch((err) => {
        this.logger.warn(`Failed to log ReferralVisit for slug=${clean}: ${err.message}`);
      });

    if (!code) throw new NotFoundException('slug not found');
    return code;
  }

  /**
   * Setea o limpia el slug custom del código. SUPER_ADMIN only.
   * Si slug = null, vuelve a lowercase(code) para mantener invariante
   * "todo código tiene slug usable".
   */
  async setSlug(id: string, newSlug: string | null) {
    const target = await this.prisma.referralCode.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('code not found');

    const clean = (newSlug ?? '').toLowerCase().trim();
    const finalSlug = clean
      ? this.slugify(clean) || target.code.toLowerCase()
      : target.code.toLowerCase();

    if (finalSlug === target.slug) return target;

    const taken = await this.prisma.referralCode.findUnique({ where: { slug: finalSlug } });
    if (taken && taken.id !== id) {
      throw new BadRequestException(`slug "${finalSlug}" ya está en uso`);
    }

    return this.prisma.referralCode.update({
      where: { id },
      data: { slug: finalSlug },
    });
  }

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
    const slug = await this.allocateSlug(dto.fullName, code);
    const referral = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName,
        ownerEmail: dto.email,
        ownerWhatsapp: dto.whatsapp,
        commissionPercent: dto.commissionPercent ?? 25,
        source: cleanSource,
      },
    });

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return {
      ...referral,
      shareLink: `${appUrl}/ref/${slug}`,
      legacyShareLink: `${appUrl}/?ref=${code}`,
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

  async setCommissionNotes(
    id: string,
    patch: { notes?: string | null; markContacted?: boolean },
  ) {
    return this.prisma.commission.update({
      where: { id },
      data: {
        notes: patch.notes ?? undefined,
        clientContactedAt:
          patch.markContacted === true ? new Date() : patch.markContacted === false ? null : undefined,
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

    // Agregados de comisiones — los hacemos en SQL (groupBy + aggregate)
    // en lugar de cargar TODA la tabla a memoria. A 100k+ commissions el
    // findMany() previo bloqueaba el dashboard.
    const oneMonthAgo = new Date(Date.now() - 30 * 86400_000);
    const oneMonthAgoMs = oneMonthAgo.getTime();
    const [campaigns, codes, uses, commByStatus, mrrAgg, coupons] = await Promise.all([
      this.prisma.campaign.findMany({
        include: {
          ownerCode: { include: { uses: { include: { commissions: true } } } },
          codes: { include: { uses: { include: { commissions: true } } } },
        },
      }),
      this.prisma.referralCode.findMany({ where: { isActive: true } }),
      // Incluimos commissions embebidas en el use para evitar un segundo
      // findMany() sobre toda la tabla — los agregados por code/socio se
      // calculan en memoria sobre estas listas locales.
      this.prisma.referralUse.findMany({
        include: {
          referralCode: { select: { role: true, ownerName: true, code: true } },
          commissions: {
            select: { amount: true, status: true, referralUseId: true },
          },
        },
      }),
      this.prisma.commission.groupBy({
        by: ['status'],
        _sum: { amount: true },
      }),
      this.prisma.commission.aggregate({
        where: {
          createdAt: { gte: oneMonthAgo },
          status: { not: 'REJECTED' },
        },
        _sum: { amount: true },
      }),
      this.prisma.coupon.findMany({
        select: { id: true, status: true, useCount: true, discountPercent: true },
      }),
    ]);

    const round = (n: number) => Math.round(n * 100) / 100;
    const sumFor = (status: string) =>
      Number(commByStatus.find((r) => r.status === status)?._sum.amount ?? 0);
    const commPaidUsd = sumFor('PAID');
    const commApprovedUsd = sumFor('APPROVED');
    const commPendingUsd = sumFor('PENDING');
    const commRejectedUsd = sumFor('REJECTED');
    const mrrUsd = Number(mrrAgg._sum.amount ?? 0);

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
            new Date(c.createdAt).getTime() >= oneMonthAgoMs,
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

    // Top influencers/embajadores por revenue total generado.
    type CodeAgg = {
      code: string;
      ownerName: string;
      role: string;
      activeClients: number;
      totalClients: number;
      revenueUsd: number;
    };
    const codeAggMap = new Map<string, CodeAgg>();
    for (const u of uses) {
      if (u.referralCode.role === 'SOCIO') continue;
      const key = u.referralCode.code;
      const row = codeAggMap.get(key) ?? {
        code: u.referralCode.code,
        ownerName: u.referralCode.ownerName,
        role: u.referralCode.role,
        activeClients: 0,
        totalClients: 0,
        revenueUsd: 0,
      };
      row.totalClients += 1;
      if (u.status === 'PAYING' || u.status === 'ACTIVE') row.activeClients += 1;
      // Las commissions vienen embebidas en el include de `uses`.
      const revenue = u.commissions
        .filter((c) => c.status !== 'REJECTED')
        .reduce((s, c) => s + Number(c.amount), 0);
      row.revenueUsd += revenue;
      codeAggMap.set(key, row);
    }
    const codeAgg = Array.from(codeAggMap.values()).map((r) => ({
      ...r,
      revenueUsd: round(r.revenueUsd),
      // Conversión: % de inscritos que terminaron pagando.
      conversionRate:
        r.totalClients > 0 ? Math.round((r.activeClients / r.totalClients) * 1000) / 10 : 0,
    }));
    const topInfluencers = codeAgg
      .filter((r) => r.role === 'INFLUENCER')
      .sort((a, b) => b.revenueUsd - a.revenueUsd)
      .slice(0, 5);
    const topAmbassadors = codeAgg
      .filter((r) => r.role === 'AMBASSADOR')
      .sort((a, b) => b.revenueUsd - a.revenueUsd)
      .slice(0, 5);

    // Comisión socio: suma de comisiones del use cuyo code tiene role=SOCIO.
    const socioRows = uses.filter((u) => u.referralCode.role === 'SOCIO');
    let socioPaidUsd = 0;
    let socioPendingUsd = 0;
    for (const u of socioRows) {
      for (const c of u.commissions) {
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
        netoEmpresaUsd: 0, // placeholder; F5 calcula real
      },
      topCampaigns: campaignRows
        .sort((a, b) => b.mrrUsd - a.mrrUsd)
        .slice(0, 5),
      topInfluencers,
      topAmbassadors,
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
      'referrals.allowInfluencerCreatesAmbassadors',
      'referrals.requireAmbassadorApproval',
      'referrals.notifyChannel',
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
      allowInfluencerCreatesAmbassadors:
        map.get('referrals.allowInfluencerCreatesAmbassadors') === 'true',
      requireAmbassadorApproval:
        map.get('referrals.requireAmbassadorApproval') === 'true',
      notifyChannel: (map.get('referrals.notifyChannel') ?? 'SMS') as 'SMS' | 'EMAIL' | 'BOTH',
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
      allowInfluencerCreatesAmbassadors: boolean;
      requireAmbassadorApproval: boolean;
      notifyChannel: 'SMS' | 'EMAIL' | 'BOTH';
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
    if ('allowInfluencerCreatesAmbassadors' in patch)
      writeKey(
        'referrals.allowInfluencerCreatesAmbassadors',
        patch.allowInfluencerCreatesAmbassadors ? 'true' : 'false',
      );
    if ('requireAmbassadorApproval' in patch)
      writeKey(
        'referrals.requireAmbassadorApproval',
        patch.requireAmbassadorApproval ? 'true' : 'false',
      );
    if ('notifyChannel' in patch)
      writeKey('referrals.notifyChannel', patch.notifyChannel ?? 'SMS');
    await Promise.all(upserts);
    return this.getConfig(user);
  }

  /**
   * Crea o reutiliza el código del Socio (role=SOCIO, 10% global) y le
   * envía la invitación al panel de afiliado. Si ya existe un código
   * SOCIO con ese email, se reutiliza y solo se reenvía el invite.
   */
  async createOrInviteSocio(
    user: AuthUser,
    dto: { fullName: string; email: string; whatsapp: string; commissionPercent?: number; customCode?: string },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const email = dto.email.trim().toLowerCase();
    let code = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'SOCIO' },
    });
    if (!code) {
      const codeText =
        dto.customCode?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') ||
        codeGen();
      code = await this.prisma.referralCode.create({
        data: {
          code: codeText,
          ownerName: dto.fullName,
          ownerEmail: email,
          ownerWhatsapp: dto.whatsapp,
          commissionPercent: dto.commissionPercent ?? 10,
          role: 'SOCIO',
          approvedAt: new Date(),
        },
      });
    }
    // Setear como socio global activo.
    await this.prisma.setting.upsert({
      where: { key: 'referrals.socioCodeId' },
      create: { key: 'referrals.socioCodeId', value: code.id },
      update: { value: code.id },
    });
    // Invitar
    await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName,
        role: 'AFFILIATE_SOCIO',
        referralCodeId: code.id,
        phone: dto.whatsapp,
      })
      .catch(() => null);
    return code;
  }

  /**
   * Lista embajadores pendientes de aprobación (creados por un influencer
   * con `referrals.requireAmbassadorApproval` = true).
   */
  async listPendingAmbassadors(user: AuthUser) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.referralCode.findMany({
      where: { role: 'AMBASSADOR', approvedAt: null },
      include: {
        parentCode: { select: { code: true, ownerName: true } },
        campaign: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async approveAmbassador(user: AuthUser, id: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    return this.prisma.referralCode.update({
      where: { id },
      data: { approvedAt: new Date() },
    });
  }

  async rejectAmbassador(user: AuthUser, id: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    // Soft-delete: desactivamos para preservar historial.
    return this.prisma.referralCode.update({
      where: { id },
      data: { isActive: false },
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
        notes: c.notes,
        clientContactedAt: c.clientContactedAt,
      };
    });

    // Agregados sobre TODA la base (no filtrada) para que los KPIs no
    // dependan del filtro actual del UI. groupBy en SQL — antes
    // cargábamos TODA la tabla a memoria para sumar 3 estados.
    const totalsByStatus = await this.prisma.commission.groupBy({
      by: ['status'],
      _sum: { amount: true },
    });
    const round = (n: number) => Math.round(n * 100) / 100;
    const sumByStatus = (s: string) =>
      Number(totalsByStatus.find((r) => r.status === s)?._sum.amount ?? 0);
    const availableUsd = sumByStatus('APPROVED');
    const pendingUsd = sumByStatus('PENDING');
    const paidUsd = sumByStatus('PAID');

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
