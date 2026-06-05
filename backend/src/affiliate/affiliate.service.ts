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
      user.role !== 'AFFILIATE_SOCIO' &&
      user.role !== 'AFFILIATE_VENDOR'
    ) {
      throw new ForbiddenException('No es un afiliado');
    }
  }

  /**
   * Resuelve el "scope" del afiliado autenticado. Devuelve el rol semántico
   * (INFLUENCER, AMBASSADOR, SOCIO o VENDOR), el id de SU ReferralCode y
   * — si aplica — los ids de los códigos descendientes (vendors si es
   * embajador, embajadores si es influencer). Toda query del panel
   * scoped pasa por este helper para evitar fugas cross-afiliado.
   *
   * El scope semántico no depende del role del User (que puede estar
   * desincronizado) sino del role del ReferralCode con ownerUserId = me.
   */
  async resolveAffiliateScope(user: AuthUser): Promise<{
    scope: 'INFLUENCER' | 'AMBASSADOR' | 'SOCIO' | 'VENDOR' | 'UNKNOWN';
    myCodeId: string | null;
    /** Solo INFLUENCER: ids de embajadores debajo (no incluye SUS vendors). */
    ambassadorCodeIds: string[];
    /** Solo AMBASSADOR: ids de vendors debajo (todos, activos e inactivos). */
    vendorCodeIds: string[];
    /** Conjunto completo de codeIds bajo este afiliado: él mismo +
     *  todos los descendientes directos e indirectos. */
    allDescendantCodeIds: string[];
  }> {
    const myCode = await this.prisma.referralCode.findFirst({
      where: { ownerUserId: user.id },
      include: {
        ambassadors: { select: { id: true } },
        childVendors: { select: { id: true } },
      },
    });
    if (!myCode) {
      return {
        scope: 'UNKNOWN',
        myCodeId: null,
        ambassadorCodeIds: [],
        vendorCodeIds: [],
        allDescendantCodeIds: [],
      };
    }
    if (myCode.role === 'INFLUENCER') {
      const ambIds = myCode.ambassadors.map((a) => a.id);
      // Para influencer queremos también los vendors de SUS embajadores
      // (atribución indirecta de 2 niveles). Los traemos en una segunda
      // query — pequeña y simple, evita una recursión más compleja.
      const vendorsUnderAmb = ambIds.length
        ? await this.prisma.referralCode.findMany({
            where: { role: 'VENDOR', parentEmbajadorCodeId: { in: ambIds } },
            select: { id: true },
          })
        : [];
      return {
        scope: 'INFLUENCER',
        myCodeId: myCode.id,
        ambassadorCodeIds: ambIds,
        vendorCodeIds: vendorsUnderAmb.map((v) => v.id),
        allDescendantCodeIds: [
          myCode.id,
          ...ambIds,
          ...vendorsUnderAmb.map((v) => v.id),
        ],
      };
    }
    if (myCode.role === 'AMBASSADOR') {
      const vendIds = myCode.childVendors.map((v) => v.id);
      return {
        scope: 'AMBASSADOR',
        myCodeId: myCode.id,
        ambassadorCodeIds: [],
        vendorCodeIds: vendIds,
        allDescendantCodeIds: [myCode.id, ...vendIds],
      };
    }
    if (myCode.role === 'VENDOR') {
      return {
        scope: 'VENDOR',
        myCodeId: myCode.id,
        ambassadorCodeIds: [],
        vendorCodeIds: [],
        allDescendantCodeIds: [myCode.id],
      };
    }
    // SOCIO o cualquier otro caso: solo su propio code.
    return {
      scope: 'SOCIO',
      myCodeId: myCode.id,
      ambassadorCodeIds: [],
      vendorCodeIds: [],
      allDescendantCodeIds: [myCode.id],
    };
  }

  /**
   * Devuelve TODOS los códigos del afiliado: su código directo + (si es
   * influencer) los códigos de sus embajadores + (si es embajador) los
   * códigos de sus vendedores. Para vendor solo su propio code.
   *
   * Centraliza el "alcance" del afiliado — todas las queries scoped
   * filtran por estos codeIds para nunca exponer datos cross-afiliado.
   */
  private async myCodes(userId: string) {
    return this.prisma.referralCode.findMany({
      where: {
        OR: [
          { ownerUserId: userId },
          // Si es influencer, también incluye sus embajadores (parent === su code).
          { parentCode: { ownerUserId: userId } },
          // Si es embajador, también incluye sus vendors.
          { parentEmbajadorCode: { ownerUserId: userId } },
        ],
      },
      include: { parentCode: true, parentEmbajadorCode: true, ownerOfCampaign: true },
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
    // Para VENDOR: el parentName/parentEmbajador es a quien reporta. Para
    // AMBASSADOR sigue siendo el influencer parent (parentCode). Hacemos
    // fallback explícito al parentEmbajadorCode para vendors.
    const parentForVendor =
      myCode?.role === 'VENDOR' ? myCode.parentEmbajadorCode : null;
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
            parentCode:
              parentForVendor?.code ?? myCode.parentCode?.code ?? null,
            parentName:
              parentForVendor?.ownerName ?? myCode.parentCode?.ownerName ?? null,
            campaignName: myCode.ownerOfCampaign?.name ?? null,
            // FASE B1 vendors: el embajador necesita saber si tiene
            // habilitado el módulo y cuál es su comisión máxima para
            // mostrar / esconder /affiliate/team y validar el form.
            allowVendors: Boolean(myCode.allowVendors),
            maxCommissionPercent: myCode.maxCommissionPercent
              ? Number(myCode.maxCommissionPercent)
              : 25,
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
      // Lista de vendors directos (para AFFILIATE_AMBASSADOR). El frontend
      // muestra esta lista en "Mi equipo".
      vendors:
        user.role === 'AFFILIATE_AMBASSADOR'
          ? codes
              .filter((c) => c.role === 'VENDOR')
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
    const scope = await this.resolveAffiliateScope(user);
    const codeIds = scope.allDescendantCodeIds;
    if (!codeIds.length) return [];
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
    const scope = await this.resolveAffiliateScope(user);
    if (!scope.myCodeId) {
      return {
        totals: { pendingUsd: 0, approvedUsd: 0, paidUsd: 0, count: 0 },
        items: [],
      };
    }
    // Scope CORRECTO: usamos recipientCodeId (la columna del 3-way split que
    // identifica a la persona que recibe el dinero). Sin esto un vendor
    // vería las commissions del embajador y viceversa. Para rows viejas
    // pre-3way (recipientCodeId=null) hacemos fallback al referralUse.
    // Solo el OWNER del code recibido es elegible.
    const recipientCodeIds = scope.allDescendantCodeIds;
    const items = await this.prisma.commission.findMany({
      where: {
        OR: [
          { recipientCodeId: { in: recipientCodeIds } },
          // Backwards-compat: rows sin recipientCodeId se atribuyen via use.
          {
            recipientCodeId: null,
            referralUse: { referralCodeId: { in: recipientCodeIds } },
          },
        ],
      },
      include: {
        referralUse: {
          include: {
            tenant: { select: { brandName: true } },
            referralCode: { select: { code: true, ownerName: true, ownerUserId: true } },
          },
        },
        recipientCode: { select: { id: true, code: true, ownerName: true, role: true } },
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
        // "via": cómo se llegó al cliente. Para mostrar a vendor: "directa"
        // si la venta fue por su propio code. Para embajador con vendor:
        // "vendor X" si el code original es VENDOR de los suyos. Para
        // influencer: "embajador Y" si vino por uno de sus embajadores.
        const sourceCode = c.referralUse?.referralCode;
        const sourceCodeId = sourceCode?.ownerUserId;
        const isMine = sourceCodeId === user.id;
        let via = 'directa';
        if (!isMine && sourceCode) {
          if (scope.scope === 'INFLUENCER') {
            via = `embajador ${sourceCode.ownerName ?? ''}`;
          } else if (scope.scope === 'AMBASSADOR') {
            via = `vendor ${sourceCode.ownerName ?? ''}`;
          } else {
            via = `vía ${sourceCode.ownerName ?? sourceCode.code ?? ''}`;
          }
        }
        return {
          id: c.id,
          amount: Number(c.amount),
          status: c.status,
          createdAt: c.createdAt,
          paidAt: c.paidAt,
          tenantBrand: c.referralUse?.tenant?.brandName ?? '—',
          via,
          codeText: c.referralUse?.referralCode?.code ?? '',
        };
      }),
    };
  }

  // ============================================================
  // FASE B4 — Projected renewals + Team view
  // ============================================================

  /**
   * Proyección de comisiones de próximas renovaciones.
   *
   * Toma los tenants ACTIVE atribuidos al scope del afiliado con
   * `currentPeriodEnd` futuro y calcula:
   *   renovación = plan.priceMonthly × MY_commissionPercent / 100
   *
   * Donde MY_commissionPercent es el % del usuario logueado para ese
   * cliente:
   *   - VENDOR: el % del code del vendor (sin descuentos).
   *   - AMBASSADOR: su % MENOS el % del vendor (si la venta fue por un
   *     vendor de los suyos). Sin vendor → todo el % del embajador.
   *   - INFLUENCER: su % (la indirecta sale separado del embajador).
   *   - SOCIO: el % del code del socio.
   *
   * IMPORTANTE: el resultado es proyección, NO crea Commission rows.
   * El disclaimer "Proyección, no contractual" va en la respuesta y se
   * muestra siempre en la card del frontend.
   */
  async projectedRenewals(user: AuthUser) {
    this.assertAffiliate(user);
    const scope = await this.resolveAffiliateScope(user);
    if (!scope.myCodeId) {
      return {
        disclaimer:
          'Proyección, no contractual. Se confirma al pago real.',
        totalProjectedUsd: 0,
        rows: [],
      };
    }

    const now = new Date();
    // Tomamos hasta 90 días por adelantado — suficiente para visualizar
    // la pipeline del próximo ciclo (mensual, trimestral, semestral
    // todavía caen en este radio para el siguiente cobro próximo).
    const horizon = new Date(now.getTime() + 90 * 86400_000);

    // Cargamos info del code del usuario para conocer su %.
    const myCode = await this.prisma.referralCode.findUnique({
      where: { id: scope.myCodeId },
      include: { childVendors: { select: { id: true, commissionPercent: true } } },
    });
    const myPct = Number(myCode?.commissionPercent ?? 0);

    // Para resolver "% del vendor que cae a este embajador", indexamos
    // vendors por id para lookups O(1) abajo.
    const vendorsById = new Map<string, number>();
    if (scope.scope === 'AMBASSADOR') {
      for (const v of myCode?.childVendors ?? []) {
        vendorsById.set(v.id, Number(v.commissionPercent ?? 0));
      }
    }

    // Tenants atribuidos al scope + con próximo billing. Incluimos plan
    // para calcular monto, y referralCode para resolver el % efectivo.
    const uses = await this.prisma.referralUse.findMany({
      where: {
        referralCodeId: { in: scope.allDescendantCodeIds },
        status: { in: ['PAYING', 'ACTIVE'] },
        tenant: {
          status: 'ACTIVE',
          currentPeriodEnd: { gt: now, lte: horizon },
        },
      },
      include: {
        tenant: {
          select: {
            id: true,
            brandName: true,
            currentPeriodEnd: true,
            plan: { select: { name: true, priceMonthly: true } },
          },
        },
        referralCode: {
          select: { id: true, code: true, ownerName: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    let total = 0;
    const rows = uses
      .filter((u) => u.tenant?.currentPeriodEnd)
      .map((u) => {
        const planPrice = Number(u.tenant?.plan?.priceMonthly ?? 0);
        const sourceCodeId = u.referralCode.id;
        // Calcular el % efectivo para el usuario logueado.
        let effectivePct = 0;
        if (scope.scope === 'VENDOR') {
          // El vendor solo cobra cuando la atribución es SU propio code.
          if (sourceCodeId === scope.myCodeId) effectivePct = myPct;
        } else if (scope.scope === 'AMBASSADOR') {
          // Si la fuente es el code del embajador → recibe todo su %.
          if (sourceCodeId === scope.myCodeId) {
            effectivePct = myPct;
          } else if (vendorsById.has(sourceCodeId)) {
            // Fuente es un vendor de los suyos → recibe (myPct - vendorPct).
            const vendorPct = vendorsById.get(sourceCodeId) ?? 0;
            effectivePct = Math.max(0, myPct - vendorPct);
          }
        } else if (scope.scope === 'INFLUENCER') {
          // Influencer cobra su % directo cuando la fuente es su code.
          // Si la fuente es un embajador suyo o un vendor de uno de sus
          // embajadores, hay una comisión indirecta (típicamente 5%).
          // Esa indirecta vive en config global; para la proyección la
          // pintamos como 0 (la mostramos en una segunda iteración si el
          // setting está expuesto). Por defecto solo aplicamos myPct si
          // la fuente es directa.
          if (sourceCodeId === scope.myCodeId) effectivePct = myPct;
        } else {
          // SOCIO o caso UNKNOWN: usamos myPct.
          if (sourceCodeId === scope.myCodeId) effectivePct = myPct;
        }
        const projected = Math.round(planPrice * effectivePct) / 100;
        total += projected;
        return {
          tenantId: u.tenant?.id,
          tenantBrand: u.tenant?.brandName ?? '—',
          plan: u.tenant?.plan?.name ?? '—',
          nextRenewalAt: u.tenant?.currentPeriodEnd ?? null,
          planPriceUsd: planPrice,
          effectivePercent: effectivePct,
          projectedCommissionUsd: projected,
          sourceCode: u.referralCode.code,
          sourceOwnerName: u.referralCode.ownerName,
        };
      })
      .filter((r) => r.projectedCommissionUsd > 0)
      .sort((a, b) => {
        if (!a.nextRenewalAt || !b.nextRenewalAt) return 0;
        return (
          new Date(a.nextRenewalAt).getTime() -
          new Date(b.nextRenewalAt).getTime()
        );
      });

    return {
      disclaimer:
        'Proyección, no contractual. Se confirma al pago real.',
      totalProjectedUsd: Math.round(total * 100) / 100,
      rows,
    };
  }

  /**
   * "Mi equipo" para AFFILIATE_AMBASSADOR — lista sus vendors con
   * métricas agregadas (clientes, conversiones, revenue, comisiones).
   *
   * SUPER_ADMIN puede ver este endpoint si está impersonando a un
   * embajador (su scope se resuelve via ownerReferralCode = me como
   * cualquier otro afiliado).
   */
  async teamForEmbajador(user: AuthUser) {
    this.assertAffiliate(user);
    const scope = await this.resolveAffiliateScope(user);
    if (scope.scope !== 'AMBASSADOR') {
      throw new ForbiddenException(
        'Solo los embajadores tienen equipo de vendedores.',
      );
    }

    const vendors = await this.prisma.referralCode.findMany({
      where: { parentEmbajadorCodeId: scope.myCodeId! },
      include: {
        uses: {
          include: {
            tenant: { select: { brandName: true, status: true } },
            commissions: true,
          },
        },
        receivedCommissions: { select: { amount: true, status: true } },
      },
      orderBy: [{ isActive: 'desc' }, { ownerName: 'asc' }],
    });

    const round = (n: number) => Math.round(n * 100) / 100;

    // Métricas del equipo: total revenue generado por las ventas de los
    // vendors (revenue del cliente, no comisión del vendor).
    let teamRevenue = 0;
    let teamCommissions = 0;
    let teamClients = 0;
    let teamActiveClients = 0;

    const rows = vendors.map((v) => {
      const directUses = v.uses;
      teamClients += directUses.length;
      const active = directUses.filter(
        (u) => u.status === 'PAYING' || u.status === 'ACTIVE',
      ).length;
      teamActiveClients += active;
      const useRevenue = directUses
        .flatMap((u) => u.commissions)
        .filter((c) => c.status !== 'REJECTED')
        .reduce((s, c) => s + Number(c.amount), 0);
      teamRevenue += useRevenue;
      const vendorCommissions = v.receivedCommissions.reduce(
        (s, c) => s + Number(c.amount),
        0,
      );
      teamCommissions += vendorCommissions;
      return {
        id: v.id,
        code: v.code,
        slug: v.slug ?? v.code.toLowerCase(),
        ownerName: v.ownerName,
        ownerEmail: v.ownerEmail,
        commissionPercent: Number(v.commissionPercent ?? 0),
        isActive: v.isActive,
        createdAt: v.createdAt,
        clients: directUses.length,
        activeClients: active,
        revenueUsd: round(useRevenue),
        commissionsUsd: round(vendorCommissions),
      };
    });

    // Ranking: vendors top por revenue (los 3 primeros).
    const topVendors = [...rows]
      .sort((a, b) => b.revenueUsd - a.revenueUsd)
      .slice(0, 3);

    return {
      kpis: {
        vendorsCount: vendors.length,
        activeVendorsCount: vendors.filter((v) => v.isActive).length,
        teamClients,
        teamActiveClients,
        teamRevenueUsd: round(teamRevenue),
        teamCommissionsUsd: round(teamCommissions),
      },
      vendors: rows,
      topVendors,
    };
  }

  /**
   * Detalle read-only de un vendor del equipo del embajador logueado.
   * Devuelve sus ventas + commissions. El embajador no puede editar al
   * vendor desde aquí — solo verlo. Para edit usa /referrals/vendors/*.
   */
  async teamVendorDetail(user: AuthUser, vendorCodeId: string) {
    this.assertAffiliate(user);
    const scope = await this.resolveAffiliateScope(user);
    if (scope.scope !== 'AMBASSADOR') {
      throw new ForbiddenException('Solo los embajadores ven detalle de vendors.');
    }
    const vendor = await this.prisma.referralCode.findUnique({
      where: { id: vendorCodeId },
      include: {
        uses: {
          include: {
            tenant: {
              select: {
                brandName: true,
                status: true,
                plan: { select: { name: true } },
              },
            },
            commissions: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        receivedCommissions: {
          include: {
            referralUse: {
              include: { tenant: { select: { brandName: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!vendor) throw new ForbiddenException('Vendor no encontrado.');
    // Defensa anti cross-team: el vendor TIENE que ser hijo del embajador
    // logueado (parentEmbajadorCodeId === scope.myCodeId).
    if (vendor.parentEmbajadorCodeId !== scope.myCodeId) {
      throw new ForbiddenException('Este vendor no es de tu equipo.');
    }

    const round = (n: number) => Math.round(n * 100) / 100;

    return {
      vendor: {
        id: vendor.id,
        code: vendor.code,
        ownerName: vendor.ownerName,
        ownerEmail: vendor.ownerEmail,
        ownerWhatsapp: vendor.ownerWhatsapp,
        commissionPercent: Number(vendor.commissionPercent ?? 0),
        isActive: vendor.isActive,
      },
      clients: vendor.uses.map((u) => ({
        id: u.id,
        tenantBrand: u.tenant?.brandName ?? '—',
        plan: u.tenant?.plan?.name ?? '—',
        status: u.status,
        signedUpAt: u.createdAt,
        convertedAt: u.convertedAt,
        commissionsCount: u.commissions.length,
        commissionsTotalUsd: round(
          u.commissions.reduce((s, c) => s + Number(c.amount), 0),
        ),
      })),
      commissions: vendor.receivedCommissions.map((c) => ({
        id: c.id,
        amount: Number(c.amount),
        status: c.status,
        createdAt: c.createdAt,
        paidAt: c.paidAt,
        tenantBrand: c.referralUse?.tenant?.brandName ?? '—',
      })),
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
