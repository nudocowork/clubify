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
            slug: myCode.slug ?? myCode.code.toLowerCase(),
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
                slug: c.slug ?? c.code.toLowerCase(),
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

  /**
   * Dashboard agregado del afiliado. Devuelve:
   *   - kpis: totales globales (directos + indirectos vía embajadores)
   *   - directs: KPIs solo de su propio código (separación visual exigida)
   *   - indirects: KPIs de uses generados por sus embajadores (si es INFLUENCER)
   *   - ambassadors: ranking ordenado desc por revenue (solo INFLUENCER)
   *   - timeline: serie 30 días de signups + conversiones (todos los códigos)
   *   - sources: breakdown por utmSource del usuario (atribución de fuente)
   *
   * Scoped: nunca expone datos de otros afiliados.
   */
  async dashboard(user: AuthUser) {
    this.assertAffiliate(user);
    const codes = await this.myCodes(user.id);
    if (!codes.length) {
      return {
        kpis: emptyKpis(),
        directs: emptyKpis(),
        indirects: emptyKpis(),
        ambassadors: [] as AmbassadorRow[],
        timeline: emptyTimeline(),
        sources: [] as SourceRow[],
      };
    }
    const myCodeId = codes.find((c) => c.ownerUserId === user.id)?.id ?? null;
    const ambassadorCodeIds = codes
      .filter((c) => c.ownerUserId !== user.id)
      .map((c) => c.id);
    const allCodeIds = codes.map((c) => c.id);

    const uses = await this.prisma.referralUse.findMany({
      where: { referralCodeId: { in: allCodeIds } },
      include: {
        referralCode: { select: { id: true, code: true, ownerName: true, slug: true } },
        commissions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Particionamos en directos (mi propio código) vs indirectos (códigos de
    // mis embajadores). Para AMBASSADOR/SOCIO no hay indirectos.
    const directsUses = myCodeId ? uses.filter((u) => u.referralCodeId === myCodeId) : [];
    const indirectsUses = uses.filter((u) => ambassadorCodeIds.includes(u.referralCodeId));

    const directs = aggregateKpis(directsUses);
    const indirects = aggregateKpis(indirectsUses);
    const totalKpis = aggregateKpis(uses);

    // Ranking embajadores: solo aplica a INFLUENCER que tiene embajadores.
    const ambassadors: AmbassadorRow[] = codes
      .filter((c) => c.ownerUserId !== user.id)
      .map((c) => {
        const myUses = uses.filter((u) => u.referralCodeId === c.id);
        const kpi = aggregateKpis(myUses);
        return {
          id: c.id,
          code: c.code,
          slug: c.slug ?? c.code.toLowerCase(),
          ownerName: c.ownerName,
          commissionPercent: Number(c.commissionPercent),
          isActive: c.isActive,
          referrals: kpi.referrals,
          conversions: kpi.conversions,
          revenueUsd: kpi.revenueUsd,
        };
      })
      .sort((a, b) => b.revenueUsd - a.revenueUsd || b.referrals - a.referrals);

    // Timeline 30 días: buckets diarios de signups + conversiones (PAYING/ACTIVE).
    const timeline = buildTimeline(uses, 30);

    // Sources: agregamos por utmSource del use (signup atribuido).
    const sourceMap = new Map<string, { source: string; referrals: number; conversions: number }>();
    for (const u of uses) {
      const src = (u.utmSource ?? u.viaSlug ?? 'directo').toLowerCase();
      const row = sourceMap.get(src) ?? { source: src, referrals: 0, conversions: 0 };
      row.referrals += 1;
      if (u.status === 'PAYING' || u.status === 'ACTIVE') row.conversions += 1;
      sourceMap.set(src, row);
    }
    const sources = Array.from(sourceMap.values()).sort((a, b) => b.referrals - a.referrals);

    return {
      kpis: totalKpis,
      directs,
      indirects,
      ambassadors,
      timeline,
      sources,
    };
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
    dto: {
      fullName: string;
      email: string;
      whatsapp: string;
      commissionPercent?: number;
      password?: string;
    },
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

    const email = dto.email.trim().toLowerCase();

    // Cross-flow dedupe: un mismo email no puede tener 2 ReferralCode como
    // AMBASSADOR (Directo Empresa, otra campaña, o este mismo influencer).
    // Si ya existe en cualquier scope, no creamos otro — el admin debe usar
    // scripts/merge-ambassador-accounts.mjs si quiere reasignar.
    const existing = await this.prisma.referralCode.findFirst({
      where: { ownerEmail: email, role: 'AMBASSADOR' },
      select: { id: true, parentCodeId: true, campaignId: true, isActive: true },
    });
    if (existing) {
      throw new BadRequestException(
        `Ya existe un embajador con este email (referralCodeId=${existing.id}). ` +
          `Un mismo usuario no puede ser embajador en más de un lugar. ` +
          `Si quieres reasignarlo, contacta al super admin para hacer el merge.`,
      );
    }

    // Generar código único.
    let code = codeGen();
    while (await this.prisma.referralCode.findUnique({ where: { code } })) {
      code = codeGen();
    }

    // Slug por default = lowercase(code). Sin esto el row queda con
    // slug=null y `/ref/<lowercase>` daría 404 (sin el fallback al code
    // del F4). Defensa para que el slug esté siempre seteado.
    const slug = code.toLowerCase();
    const ambassador = await this.prisma.referralCode.create({
      data: {
        code,
        slug,
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

    // Auto-invite al embajador. Si el influencer tipeó una password
    // en el form, la usamos; sino generamos readable y la incluimos en
    // la response para que el influencer la copie y comparta.
    const presetPassword =
      dto.password?.trim() || this.auth.generateReadablePassword();
    const inviteResult = await this.auth
      .inviteAffiliate({
        email,
        fullName: dto.fullName,
        role: 'AFFILIATE_AMBASSADOR',
        referralCodeId: ambassador.id,
        phone: dto.whatsapp,
        presetPassword,
      })
      .catch(() => null);

    return {
      ...ambassador,
      affiliateCredentials: inviteResult?.password
        ? { email, password: inviteResult.password, loginUrl: '/login' }
        : null,
    };
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

// ─── Helpers para dashboard() ──────────────────────────────────────────

type Kpis = {
  referrals: number;
  conversions: number;
  revenueUsd: number;
  pendingUsd: number;
  paidUsd: number;
};

type AmbassadorRow = {
  id: string;
  code: string;
  slug: string;
  ownerName: string;
  commissionPercent: number;
  isActive: boolean;
  referrals: number;
  conversions: number;
  revenueUsd: number;
};

type SourceRow = { source: string; referrals: number; conversions: number };

type UseWithCommissions = {
  status: string;
  createdAt: Date;
  commissions: Array<{ amount: any; status: string }>;
};

function emptyKpis(): Kpis {
  return { referrals: 0, conversions: 0, revenueUsd: 0, pendingUsd: 0, paidUsd: 0 };
}

function emptyTimeline() {
  const days: Array<{ date: string; signups: number; conversions: number }> = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), signups: 0, conversions: 0 });
  }
  return days;
}

function aggregateKpis(uses: UseWithCommissions[]): Kpis {
  const k = emptyKpis();
  k.referrals = uses.length;
  for (const u of uses) {
    if (u.status === 'PAYING' || u.status === 'ACTIVE') k.conversions += 1;
    for (const c of u.commissions ?? []) {
      const amt = Number(c.amount);
      k.revenueUsd += amt;
      if (c.status === 'PAID') k.paidUsd += amt;
      else if (c.status === 'PENDING' || c.status === 'APPROVED') k.pendingUsd += amt;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  k.revenueUsd = round(k.revenueUsd);
  k.pendingUsd = round(k.pendingUsd);
  k.paidUsd = round(k.paidUsd);
  return k;
}

function buildTimeline(
  uses: Array<{ createdAt: Date; convertedAt?: Date | null }>,
  days: number,
) {
  const buckets = new Map<string, { signups: number; conversions: number }>();
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    buckets.set(d.toISOString().slice(0, 10), { signups: 0, conversions: 0 });
  }
  for (const u of uses) {
    const key = u.createdAt.toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (b) b.signups += 1;
    if (u.convertedAt) {
      const ck = u.convertedAt.toISOString().slice(0, 10);
      const cb = buckets.get(ck);
      if (cb) cb.conversions += 1;
    }
  }
  return Array.from(buckets.entries()).map(([date, v]) => ({ date, ...v }));
}
