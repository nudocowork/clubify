import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
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
  // Si está presente, auto-creamos User con role=AFFILIATE_INFLUENCER
  // y esta password, así el aplicante puede entrar a /login → /app/referrals
  // sin esperar al admin.
  password?: string;
};

@Injectable()
export class ReferralsService {
  private logger = new Logger(ReferralsService.name);

  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private jwt: JwtService,
  ) {}

  /**
   * SUPER_ADMIN entra al panel /affiliate de un influencer/embajador como
   * si fuera el dueño. Mismo patrón que `tenants.impersonate`: firma un
   * JWT con `impersonatedBy` y devuelve el user para que el frontend lo
   * guarde en sesión. El acceso queda registrado en logs por ese campo.
   */
  async impersonateAffiliate(codeId: string, superAdminId: string) {
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: {
        id: true,
        code: true,
        ownerName: true,
        ownerEmail: true,
        ownerUserId: true,
        role: true,
      },
    });
    if (!code) throw new NotFoundException('Código no encontrado');
    if (!code.ownerUserId) {
      throw new BadRequestException(
        'Este código no tiene un usuario afiliado vinculado todavía.',
      );
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: code.ownerUserId },
      select: { id: true, email: true, fullName: true, role: true, tenantId: true, isActive: true },
    });
    if (!owner || !owner.isActive) {
      throw new BadRequestException('El usuario del afiliado no está activo.');
    }
    if (!owner.role.startsWith('AFFILIATE_')) {
      throw new BadRequestException(
        'El usuario vinculado al código no es un afiliado.',
      );
    }

    const payload = {
      sub: owner.id,
      email: owner.email,
      role: owner.role,
      tenantId: owner.tenantId,
      impersonatedBy: superAdminId,
    };
    const accessToken = this.jwt.sign(payload);

    return {
      accessToken,
      user: {
        id: owner.id,
        email: owner.email,
        fullName: owner.fullName,
        role: owner.role,
        tenantId: owner.tenantId,
      },
      affiliate: {
        codeId: code.id,
        code: code.code,
        ownerName: code.ownerName,
        ownerEmail: code.ownerEmail,
        role: code.role,
      },
    };
  }

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

    // Si el aplicante tipeó password, auto-creamos cuenta AFFILIATE_INFLUENCER
    // así puede entrar inmediatamente a /login. Si falla (email duplicado,
    // etc), no rompemos la creación del referralCode — admin lo arregla.
    let createdAccount = false;
    if (dto.password && dto.password.trim().length >= 8) {
      const inviteResult = await this.auth
        .inviteAffiliate({
          email: dto.email,
          fullName: dto.fullName,
          role: 'AFFILIATE_INFLUENCER',
          referralCodeId: referral.id,
          phone: dto.whatsapp,
          presetPassword: dto.password.trim(),
        })
        .catch(() => null);
      createdAccount = !!inviteResult?.password;
    }

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    return {
      ...referral,
      shareLink: `${appUrl}/ref/${slug}`,
      legacyShareLink: `${appUrl}/?ref=${code}`,
      // Si creamos cuenta, el frontend muestra el CTA "Entrar al panel".
      accountReady: createdAccount,
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
    const [campaigns, codes, uses, commByStatus, mrrAgg] = await Promise.all([
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

  /**
   * Summary de visitas en /ref/<slug> (últimos N días). Agrega por slug
   * (matcheado o no a un ReferralCode) con conteos de visitas y unique
   * UAs aproximadas (proxy de "clicks únicos"). El conversion rate se
   * calcula contra ReferralUses cuyo viaSlug coincide.
   */
  async visitsSummary(user: AuthUser, days = 30) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const since = new Date(Date.now() - days * 86400_000);

    const [visits, uses] = await Promise.all([
      this.prisma.referralVisit.findMany({
        where: { createdAt: { gte: since } },
        include: {
          referralCode: { select: { code: true, ownerName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.referralUse.findMany({
        where: { createdAt: { gte: since }, viaSlug: { not: null } },
        select: { viaSlug: true, status: true },
      }),
    ]);

    type Row = {
      slug: string;
      code: string | null;
      ownerName: string | null;
      visits: number;
      uniqueUAs: number;
      signups: number;
      conversions: number;
    };
    const map = new Map<string, Row & { uaSet: Set<string> }>();
    for (const v of visits) {
      const row =
        map.get(v.slug) ??
        ({
          slug: v.slug,
          code: v.referralCode?.code ?? null,
          ownerName: v.referralCode?.ownerName ?? null,
          visits: 0,
          uniqueUAs: 0,
          signups: 0,
          conversions: 0,
          uaSet: new Set<string>(),
        } satisfies Row & { uaSet: Set<string> });
      row.visits += 1;
      if (v.userAgent) row.uaSet.add(v.userAgent.slice(0, 100));
      map.set(v.slug, row);
    }
    for (const u of uses) {
      if (!u.viaSlug) continue;
      const row = map.get(u.viaSlug);
      if (!row) continue;
      row.signups += 1;
      if (u.status === 'PAYING' || u.status === 'ACTIVE') row.conversions += 1;
    }
    const rows = Array.from(map.values())
      .map(({ uaSet, ...rest }) => ({ ...rest, uniqueUAs: uaSet.size }))
      .sort((a, b) => b.visits - a.visits);

    return {
      days,
      totals: {
        visits: rows.reduce((s, r) => s + r.visits, 0),
        signups: rows.reduce((s, r) => s + r.signups, 0),
        conversions: rows.reduce((s, r) => s + r.conversions, 0),
      },
      rows,
    };
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
      // Si AMBASSADOR no tiene parentCode (parentCodeId=null) → es un
      // "Embajador Directo Empresa" — reporta a la empresa, no a un
      // influencer. Mismo % de comisión que un embajador normal pero el
      // 5% indirecto no va a nadie (queda en la empresa).
      const isCompanyDirect = c.parentCodeId == null;
      return {
        id: c.id,
        code: c.code,
        slug: c.slug ?? c.code.toLowerCase(),
        ownerName: c.ownerName,
        ownerEmail: c.ownerEmail,
        ownerWhatsapp: c.ownerWhatsapp,
        commissionPercent: Number(c.commissionPercent),
        isActive: c.isActive,
        approvedAt: c.approvedAt,
        parentCode: c.parentCode?.code ?? null,
        parentName: c.parentCode?.ownerName ?? null,
        campaignName: c.campaign?.name ?? null,
        isCompanyDirect,
        clients: c.uses.length,
        activeClients: c.uses.filter((u) => u.status === 'PAYING' || u.status === 'ACTIVE').length,
        paidUsd: Math.round(paid * 100) / 100,
        pendingUsd: Math.round(pending * 100) / 100,
        createdAt: c.createdAt,
      };
    });
  }

  /**
   * Crea o invita un "Embajador Directo Empresa" — un AMBASSADOR sin
   * influencer parent (parentCodeId=null, campaignId=null). Gana
   * comisión sobre sus propios referidos (igual que un embajador normal),
   * pero el 5% indirecto no va a nadie porque no tiene parent — queda
   * en la empresa.
   *
   * Diferencia con SOCIO: el SOCIO gana 10% sobre TODA venta del sistema
   * sin importar qué código se use. El Embajador Directo Empresa solo
   * gana sobre los clientes que él mismo refirió.
   */
  async createCompanyDirectAmbassador(
    user: AuthUser,
    dto: {
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent?: number;
      customCode?: string;
    },
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!dto.fullName?.trim() || !dto.email?.trim() || !dto.whatsapp?.trim()) {
      throw new BadRequestException('fullName, email y whatsapp son requeridos');
    }
    const email = dto.email.trim().toLowerCase();

    // No permitir duplicado: un mismo email no puede tener 2 ReferralCode
    // como AMBASSADOR (Directo Empresa o bajo cualquier influencer). El
    // super admin debe usar scripts/merge-ambassador-accounts.mjs si quiere
    // unificar dos registros existentes.
    const dup = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'AMBASSADOR' },
      include: { parentCode: { select: { ownerName: true, code: true } } },
    });
    if (dup) {
      const scope = dup.parentCodeId
        ? `bajo ${dup.parentCode?.ownerName ?? 'otro influencer'} [${dup.parentCode?.code ?? dup.parentCodeId}]`
        : 'como Embajador Directo Empresa';
      throw new BadRequestException(
        `Ya existe un embajador con este email ${scope} (referralCodeId=${dup.id}). ` +
          `Un mismo usuario no puede ser embajador en más de un lugar.`,
      );
    }

    // Generar código único + slug a partir del nombre
    let code = dto.customCode?.trim().toUpperCase();
    if (code) {
      if (!/^[A-Z0-9]{4,16}$/.test(code)) {
        throw new BadRequestException(
          'customCode debe tener 4-16 caracteres A-Z 0-9',
        );
      }
      const codeDup = await this.prisma.referralCode.findUnique({
        where: { code },
      });
      if (codeDup) throw new BadRequestException(`Código "${code}" ya está en uso`);
    } else {
      code = codeGen();
      while (await this.prisma.referralCode.findUnique({ where: { code } })) {
        code = codeGen();
      }
    }

    const slug = await this.allocateSlug(dto.fullName, code);
    const created = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
        ownerName: dto.fullName.trim(),
        ownerEmail: email,
        ownerWhatsapp: dto.whatsapp.trim(),
        commissionPercent: dto.commissionPercent ?? 25,
        role: 'AMBASSADOR',
        parentCodeId: null,
        campaignId: null,
        approvedAt: new Date(), // pre-aprobado (no requiere flow de approval)
        source: 'company_direct',
      },
    });

    // Invitar al embajador con su panel propio (mismo flujo que un embajador
    // normal, pero scoped a sus propios datos sin parent influencer).
    await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName.trim(),
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: created.id,
        phone: dto.whatsapp.trim(),
      })
      .catch((err) => {
        this.logger.warn(
          `inviteAffiliate falló para ${email}: ${(err as Error).message}`,
        );
      });

    const appUrl = process.env.APP_URL ?? 'https://soyclubify.com';
    return {
      ...created,
      shareLink: `${appUrl}/ref/${slug}`,
      isCompanyDirect: true,
    };
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
   * Promueve un embajador a influencer. Solo SUPER_ADMIN. Preserva
   * historial, referidos y comisiones — solo cambia el rol del code +
   * el rol del User vinculado (si existe), y desvincula el parentCode
   * (un influencer no tiene parent — es independiente).
   *
   * Caso de uso: al crear una campaña, el admin elige convertir a un
   * embajador existente en influencer en vez de crear uno desde cero
   * (mantiene los referidos que ya trajo + le da el panel de influencer
   * con permiso para crear embajadores debajo suyo).
   *
   * Idempotente: si ya es influencer, devuelve OK sin tocar nada.
   */
  async promoteAmbassadorToInfluencer(user: AuthUser, codeId: string) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    const code = await this.prisma.referralCode.findUnique({
      where: { id: codeId },
      select: { id: true, role: true, ownerUserId: true, ownerName: true },
    });
    if (!code) throw new NotFoundException('Embajador no encontrado');
    if (code.role === 'INFLUENCER') {
      return { ok: true, alreadyInfluencer: true, code };
    }
    if (code.role !== 'AMBASSADOR') {
      throw new BadRequestException(
        `Solo se pueden promover códigos AMBASSADOR (este es ${code.role})`,
      );
    }
    // Transacción: cambiar role del code + desvincular parentCode + actualizar
    // role del User (si tiene uno asociado).
    const updated = await this.prisma.$transaction(async (tx) => {
      const newCode = await tx.referralCode.update({
        where: { id: codeId },
        data: { role: 'INFLUENCER', parentCodeId: null },
      });
      if (code.ownerUserId) {
        await tx.user.update({
          where: { id: code.ownerUserId },
          data: { role: 'AFFILIATE_INFLUENCER' },
        });
      }
      return newCode;
    });
    this.logger.log(
      `Ambassador promoted to INFLUENCER: codeId=${codeId} ownerName="${code.ownerName}" by ${user.email}`,
    );
    return { ok: true, alreadyInfluencer: false, code: updated };
  }

  /**
   * Demote: convierte un INFLUENCER en AMBASSADOR colgándolo de otro
   * INFLUENCER. Preserva los ReferralUse (clientes) del code — siguen
   * apuntando al mismo referralCodeId. Lo que cambia: role del code,
   * parentCodeId, campaignId (al de la campaña del nuevo parent si la
   * tiene) y rol del User vinculado.
   *
   * Validaciones:
   *   - code existe y es INFLUENCER.
   *   - newParentId existe, es INFLUENCER y ≠ codeId.
   *   - code no tiene embajadores hijos activos (sino quedarían colgando
   *     de un AMBASSADOR — modelo inválido).
   *   - code no es titular de Campaign activa (sino quedaría huérfana).
   *
   * Comisiones futuras: el siguiente pago de cada cliente va a generar
   * la indirecta 5% al newParent (antes no había indirecta porque era
   * INFLUENCER independiente).
   */
  async demoteInfluencerToAmbassador(
    user: AuthUser,
    codeId: string,
    newParentId: string,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!newParentId) throw new BadRequestException('newParentId requerido');
    if (codeId === newParentId) {
      throw new BadRequestException('codeId y newParentId no pueden ser iguales');
    }

    const [code, parent] = await Promise.all([
      this.prisma.referralCode.findUnique({
        where: { id: codeId },
        select: {
          id: true,
          role: true,
          ownerUserId: true,
          ownerName: true,
          ownerOfCampaign: { select: { id: true, name: true, status: true } },
        },
      }),
      this.prisma.referralCode.findUnique({
        where: { id: newParentId },
        select: {
          id: true,
          role: true,
          ownerName: true,
          campaignId: true,
          ownerOfCampaign: { select: { id: true } },
        },
      }),
    ]);
    if (!code) throw new NotFoundException('Code a demote no encontrado');
    if (!parent) throw new NotFoundException('Influencer parent no encontrado');
    if (code.role !== 'INFLUENCER') {
      throw new BadRequestException(
        `Solo se puede demote desde INFLUENCER (este es ${code.role})`,
      );
    }
    if (parent.role !== 'INFLUENCER') {
      throw new BadRequestException(
        `newParent debe ser INFLUENCER (este es ${parent.role})`,
      );
    }
    if (code.ownerOfCampaign && code.ownerOfCampaign.status !== 'FINISHED') {
      throw new BadRequestException(
        `Este influencer es titular de la campaña "${code.ownerOfCampaign.name}" (${code.ownerOfCampaign.status}). ` +
          `Finalizá o transferí la campaña antes de demote.`,
      );
    }
    const childAmbassadors = await this.prisma.referralCode.count({
      where: { parentCodeId: codeId, isActive: true },
    });
    if (childAmbassadors > 0) {
      throw new BadRequestException(
        `Este influencer tiene ${childAmbassadors} embajadores hijos activos. ` +
          `Reasignalos a otro influencer antes de demote.`,
      );
    }

    const targetCampaignId =
      parent.campaignId ?? parent.ownerOfCampaign?.id ?? null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const newCode = await tx.referralCode.update({
        where: { id: codeId },
        data: {
          role: 'AMBASSADOR',
          parentCodeId: newParentId,
          campaignId: targetCampaignId,
        },
      });
      if (code.ownerUserId) {
        await tx.user.update({
          where: { id: code.ownerUserId },
          data: { role: 'AFFILIATE_AMBASSADOR' },
        });
      }
      return newCode;
    });

    this.logger.log(
      `Influencer demoted to AMBASSADOR: codeId=${codeId} ownerName="${code.ownerName}" ` +
        `newParent=${newParentId} (${parent.ownerName}) by ${user.email}`,
    );
    return { ok: true, code: updated };
  }

  /**
   * Reassign: cambia el parentCodeId de un AMBASSADOR a otro INFLUENCER.
   * Preserva los clientes (ReferralUse). Las futuras comisiones indirectas
   * van al nuevo parent. Las históricas (en uses separados del antiguo
   * parent) quedan como están — son pasado consolidado.
   */
  async reassignAmbassadorParent(
    user: AuthUser,
    codeId: string,
    newParentId: string,
  ) {
    if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException();
    if (!newParentId) throw new BadRequestException('newParentId requerido');
    if (codeId === newParentId) {
      throw new BadRequestException('codeId y newParentId no pueden ser iguales');
    }

    const [code, parent] = await Promise.all([
      this.prisma.referralCode.findUnique({
        where: { id: codeId },
        select: { id: true, role: true, ownerName: true, parentCodeId: true },
      }),
      this.prisma.referralCode.findUnique({
        where: { id: newParentId },
        select: {
          id: true,
          role: true,
          ownerName: true,
          campaignId: true,
          ownerOfCampaign: { select: { id: true } },
        },
      }),
    ]);
    if (!code) throw new NotFoundException('Embajador no encontrado');
    if (!parent) throw new NotFoundException('Influencer parent no encontrado');
    if (code.role !== 'AMBASSADOR') {
      throw new BadRequestException(
        `Solo se puede reasignar parent de AMBASSADOR (este es ${code.role})`,
      );
    }
    if (parent.role !== 'INFLUENCER') {
      throw new BadRequestException(
        `newParent debe ser INFLUENCER (este es ${parent.role})`,
      );
    }
    if (code.parentCodeId === newParentId) {
      return { ok: true, alreadyAssigned: true };
    }

    const targetCampaignId =
      parent.campaignId ?? parent.ownerOfCampaign?.id ?? null;

    const updated = await this.prisma.referralCode.update({
      where: { id: codeId },
      data: {
        parentCodeId: newParentId,
        campaignId: targetCampaignId,
      },
    });

    this.logger.log(
      `Ambassador reassigned: codeId=${codeId} ownerName="${code.ownerName}" ` +
        `oldParent=${code.parentCodeId} newParent=${newParentId} (${parent.ownerName}) by ${user.email}`,
    );
    return { ok: true, code: updated };
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
