import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { CommissionRecalcService } from '../referrals/commission-recalc.service';
import { cambiarSlugConAlias } from '../referrals/slug-alias';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);

// Bloqueo de comisiones: 15 días desde la compra antes de poder cobrarlas
// (espejo de COMMISSION_HOLD_DAYS en referrals.service). Spec 2026-06-15.
const AFFILIATE_HOLD_DAYS = 15;

function affiliateDaysRemaining(createdAt: Date, status: string): number {
  if (status !== 'PENDING') return 0;
  const availableAt =
    new Date(createdAt).getTime() + AFFILIATE_HOLD_DAYS * 86400000;
  const diff = availableAt - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / 86400000);
}

// Próxima fecha de pago: día 15 o último día del mes, la primera >= `from`.
function affiliateNextPayoutDate(from: Date): Date {
  const base = new Date(from);
  base.setHours(0, 0, 0, 0);
  const c: Date[] = [];
  for (let m = 0; m <= 1; m++) {
    c.push(new Date(base.getFullYear(), base.getMonth() + m, 15));
    c.push(new Date(base.getFullYear(), base.getMonth() + m + 1, 0));
  }
  c.sort((a, b) => a.getTime() - b.getTime());
  return c.find((d) => d.getTime() >= base.getTime()) ?? c[c.length - 1];
}

/**
 * Servicio scoped al usuario autenticado: nunca expone datos de OTRO
 * influencer/embajador. Toda query parte de los `ReferralCode` cuyo
 * `ownerUserId` es el usuario actual.
 */
@Injectable()
export class AffiliateService {
  constructor(
    private prisma: PrismaService,
    private auth: AuthService,
    private recalc: CommissionRecalcService,
  ) {}

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

  /**
   * El afiliado elige la ruta de SU enlace corto `/ref/<ruta>`.
   *
   * La ruta se generaba del nombre completo y quedaba larguisima
   * (`/ref/briggit-stefany-labrador`). Esto deja ponerle la que quiera. No es
   * un redirector aparte: es la ruta real, asi que conserva codigo,
   * atribucion y registro de visita.
   *
   * Solo toca SU propio codigo — `myCodes` ya filtra por `ownerUserId`, asi
   * que un afiliado no puede reescribir la ruta de otro.
   */
  async setMySlug(user: AuthUser, nuevo: string) {
    this.assertAffiliate(user);
    const codes = await this.myCodes(user.id);
    const mio = codes.find((c) => c.ownerUserId === user.id);
    if (!mio) throw new NotFoundException('No tenes un codigo propio.');

    // Toda la logica vive en un solo sitio: normalizacion, reservadas,
    // unicidad contra rutas vivas Y contra alias de otros, y el registro de
    // la ruta anterior para que los enlaces ya compartidos no se caigan.
    const slug = await cambiarSlugConAlias(this.prisma, {
      codeId: mio.id,
      slugActual: mio.slug,
      nuevo,
    });
    return { slug };
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

    // LA MARCA del afiliado. Sin esto el panel pintaba el logo de Clubify y
    // decia "Academia Clubify" / "Clubify Lab" a un afiliado de Sellea.
    // Sale del ReferralCode, que es donde vive la marca de un afiliado (no
    // tiene tenantId). Ver [[clubify-fugas-de-marca]] y [[clubify-afiliados-y-roles]].
    const wl = myCode?.whiteLabelId
      ? await this.prisma.whiteLabel
          .findUnique({
            where: { id: myCode.whiteLabelId },
            select: {
              slug: true,
              name: true,
              logoUrl: true,
              primaryColor: true,
              academiaUrl: true,
              domain: true,
            },
          })
          .catch(() => null)
      : null;

    return {
      user: userRow,
      role: user.role,
      // null = marca sin resolver. El panel NO debe inventar un nombre: un pie
      // ausente no delata a nadie, uno equivocado si.
      brand: wl
        ? {
            slug: wl.slug,
            name: wl.name,
            logoUrl: wl.logoUrl,
            primaryColor: wl.primaryColor,
            academiaUrl: wl.academiaUrl,
            // Dominio de marketing de la marca: los enlaces de prueba que
            // comparte el afiliado tenian soyclubify.com escrito a mano.
            baseUrl: wl.domain ? `https://${wl.domain.replace(/^https?:\/\//, '')}` : null,
            // El Lab es un feed GLOBAL, comun a todas las marcas. Mostrarselo
            // a un afiliado de Sellea seria ensenarle la comunidad de Clubify
            // bajo el nombre de Sellea. Solo para la plataforma hasta que el
            // Lab se acote por marca.
            labEnabled: wl.slug === 'clubify',
          }
        : null,
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
            // Self-register: % por defecto que se aplica a los vendedores
            // que entran por `/seller/register/<myCode>`. null = usar
            // fallback (10%).
            defaultVendorCommissionPercent:
              myCode.defaultVendorCommissionPercent !== null &&
              myCode.defaultVendorCommissionPercent !== undefined
                ? Number(myCode.defaultVendorCommissionPercent)
                : null,
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
        // B2: tenantId para poder entrar (drill-in) a las comisiones del negocio.
        tenant: {
          select: {
            id: true,
            brandName: true,
            planPeriodicity: true,
            status: true,
            plan: { select: { name: true } },
          },
        },
        referralCode: { select: { code: true, role: true, ownerName: true } },
        // B1: las CANCELADAS no cuentan ni suman en el panel del embajador.
        commissions: { where: { status: { not: 'REJECTED' } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return uses.map((u) => ({
      id: u.id,
      tenantId: u.tenant?.id ?? null,
      tenantBrand: u.tenant?.brandName ?? '—',
      plan: u.tenant?.plan?.name ?? '—',
      planPeriodicity: u.tenant?.planPeriodicity ?? null,
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
        topVendors: [] as TopVendorRow[],
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

    // HOTFIX 2026-06-05 (bug #8): pasamos `allCodeIds` para filtrar
    // commissions por recipient. Sin esto, un AMBASSADOR con vendors
    // veía revenueUsd 3× inflado (sumaba también la commission del
    // influencer + del vendor — que NO son suyas).
    const directs = aggregateKpis(directsUses, myCodeId ? [myCodeId] : []);
    const indirects = aggregateKpis(indirectsUses, allCodeIds);
    const totalKpis = aggregateKpis(uses, allCodeIds);

    // Ranking embajadores: solo aplica a INFLUENCER que tiene embajadores.
    const ambassadors: AmbassadorRow[] = codes
      .filter((c) => c.ownerUserId !== user.id)
      .map((c) => {
        const myUses = uses.filter((u) => u.referralCodeId === c.id);
        const kpi = aggregateKpis(myUses, [c.id]);
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

    // Top vendedores GLOBAL del INFLUENCER (item Fase C 2026-06-07):
    // todos los vendors que pertenecen a CUALQUIERA de sus embajadores,
    // ordenados por revenue. Para AMBASSADOR/SOCIO/VENDOR este array
    // queda vacío (sus vendors ya viven en el panel /affiliate/team).
    const topVendors = await this.computeTopVendorsForInfluencer(
      user.id,
      ambassadorCodeIds,
    );

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
      topVendors,
      timeline,
      sources,
    };
  }

  /**
   * Top vendedores del influencer — agrega los vendors hijos de TODOS sus
   * embajadores y los ordena por revenue desc. Para no-influencers
   * devuelve []. Top 10 por defecto.
   */
  private async computeTopVendorsForInfluencer(
    userId: string,
    ambassadorCodeIds: string[],
  ): Promise<TopVendorRow[]> {
    if (!ambassadorCodeIds.length) return [];
    const vendors = await this.prisma.referralCode.findMany({
      where: { parentEmbajadorCodeId: { in: ambassadorCodeIds } },
      include: {
        parentEmbajadorCode: {
          select: { id: true, code: true, ownerName: true },
        },
        uses: { include: { commissions: true } },
      },
    });
    const rows: TopVendorRow[] = vendors.map((v) => {
      const kpi = aggregateKpis(v.uses, [v.id]);
      return {
        id: v.id,
        code: v.code,
        slug: v.slug ?? v.code.toLowerCase(),
        ownerName: v.ownerName,
        commissionPercent: Number(v.commissionPercent ?? 0),
        isActive: v.isActive,
        referrals: kpi.referrals,
        conversions: kpi.conversions,
        revenueUsd: kpi.revenueUsd,
        embajador: v.parentEmbajadorCode
          ? {
              id: v.parentEmbajadorCode.id,
              code: v.parentEmbajadorCode.code,
              ownerName: v.parentEmbajadorCode.ownerName,
            }
          : null,
      };
    });
    return rows
      .sort(
        (a, b) =>
          b.revenueUsd - a.revenueUsd ||
          b.conversions - a.conversions ||
          b.referrals - a.referrals,
      )
      .slice(0, 10);
  }

  /**
   * Vendedores de un embajador específico, accesible al INFLUENCER padre
   * del embajador (drill-down). Mismo shape que las rows de
   * teamForEmbajador para reuso visual.
   */
  async ambassadorVendorsForInfluencer(
    user: AuthUser,
    ambassadorCodeId: string,
  ) {
    this.assertAffiliate(user);
    const ambassador = await this.prisma.referralCode.findUnique({
      where: { id: ambassadorCodeId },
      include: { parentCode: { select: { ownerUserId: true } } },
    });
    if (!ambassador || ambassador.role !== 'AMBASSADOR') {
      throw new NotFoundException('Embajador no encontrado');
    }
    if (ambassador.parentCode?.ownerUserId !== user.id) {
      throw new ForbiddenException(
        'No tenés acceso a este embajador',
      );
    }
    const vendors = await this.prisma.referralCode.findMany({
      where: { parentEmbajadorCodeId: ambassadorCodeId },
      include: { uses: { include: { commissions: true } } },
      orderBy: [{ isActive: 'desc' }, { ownerName: 'asc' }],
    });
    return vendors.map((v) => {
      const kpi = aggregateKpis(v.uses, [v.id]);
      return {
        id: v.id,
        code: v.code,
        slug: v.slug ?? v.code.toLowerCase(),
        ownerName: v.ownerName,
        commissionPercent: Number(v.commissionPercent ?? 0),
        isActive: v.isActive,
        referrals: kpi.referrals,
        conversions: kpi.conversions,
        revenueUsd: kpi.revenueUsd,
      };
    });
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
        // PDF Soft(9) B1: las comisiones CANCELADAS (REJECTED) NO se muestran al
        // embajador/influencer. Solo disponibles/bloqueadas/pagadas/retenidas.
        status: { not: 'REJECTED' },
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
            tenant: {
              select: {
                id: true,
                brandName: true,
                // C3: fecha de la 1ª comisión = fecha "de negocio".
                // PDF Soft 10: purchasedAt (compra real) manda sobre createdAt.
                createdAt: true,
                purchasedAt: true,
                planPeriodicity: true,
                subscriptionPriceUsd: true,
              },
            },
            referralCode: { select: { code: true, ownerName: true, ownerUserId: true } },
          },
        },
        recipientCode: { select: { id: true, code: true, ownerName: true, role: true } },
        // Punto 2: comisión de grupo empresarial (sin tenant) → mostramos el grupo.
        businessGroup: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // PDF Soft(9) C3 + B3: fecha "de negocio" de cada comisión, IGUAL que el
    // panel admin (100% sincronizado). El primer cobro de cada empresa (min
    // availableAt efectivo sobre TODO su historial no anulado, no solo lo que ve
    // este afiliado) → fecha de REGISTRO; las recompras → fecha del cobro real.
    const effAvail = (c: { availableAt?: Date | null; createdAt: Date }) =>
      c.availableAt
        ? new Date(c.availableAt)
        : new Date(
            new Date(c.createdAt).getTime() + AFFILIATE_HOLD_DAYS * 86400000,
          );
    const tenantIdsForDate = Array.from(
      new Set(
        items
          .map((c) => c.referralUse?.tenant?.id)
          .filter((x): x is string => !!x),
      ),
    );
    const firstChargeMsByTenant = new Map<string, number>();
    if (tenantIdsForDate.length) {
      const mins = await this.prisma.commission.findMany({
        where: {
          status: { not: 'REJECTED' },
          referralUse: { tenantId: { in: tenantIdsForDate } },
        },
        select: {
          availableAt: true,
          createdAt: true,
          referralUse: { select: { tenantId: true } },
        },
      });
      for (const m of mins) {
        const tid = m.referralUse?.tenantId;
        if (!tid) continue;
        const ms = effAvail(m).getTime();
        const cur = firstChargeMsByTenant.get(tid);
        if (cur === undefined || ms < cur) firstChargeMsByTenant.set(tid, ms);
      }
    }

    // Base de comisión por tenant (precio real ?? canónico) para derivar el
    // % aplicado a cada comisión (amount / base). Una sola resolución por
    // tenant para no repetir lecturas de Settings.
    const baseByTenant = new Map<string, number>();
    for (const c of items) {
      const t = c.referralUse?.tenant;
      if (!t || baseByTenant.has(t.id)) continue;
      baseByTenant.set(
        t.id,
        await this.recalc.getCommissionBase(
          t.subscriptionPriceUsd ?? null,
          t.planPeriodicity ?? null,
        ),
      );
    }

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
        const amount = Number(c.amount);
        const tenantId = c.referralUse?.tenant?.id;
        const base = tenantId ? baseByTenant.get(tenantId) ?? 0 : 0;
        // PDF 2026-06-30: el % mostrado usa el appliedPercent CONGELADO de la
        // comisión (la verdad), NO amount/base recalculada. Antes, si el
        // subscriptionPriceUsd del negocio cambiaba (o quedaba distinto del
        // bruto real), amount/base daba porcentajes falsos (ej. "directa 2%"
        // cuando en realidad es 10%). Fallback a amount/base solo para filas
        // legacy sin appliedPercent.
        const snapPct =
          c.appliedPercent != null && Number(c.appliedPercent) > 0
            ? Number(c.appliedPercent)
            : null;
        const percent =
          snapPct ?? (base > 0 ? Math.round((amount / base) * 100) : null);
        // B3: usar el availableAt GUARDADO (igual que admin), no createdAt+hold,
        // para que días restantes / próximo pago coincidan 100% con el panel admin.
        const availableAt = effAvail(c);
        const daysRemaining =
          c.status === 'PENDING'
            ? Math.max(
                0,
                Math.ceil((availableAt.getTime() - Date.now()) / 86400000),
              )
            : 0;
        // C3 + FIX 2026-08-14 (R1/Fable): fecha de negocio. 1ª comisión CON
        // purchasedAt real → esa; resto (recompras y 1ª sin purchasedAt) → la
        // fecha del cobro de ESTA comisión (createdAt ≈ webhook/pago). Antes la
        // 1ª sin purchasedAt caía a tenant.createdAt (REGISTRO ≠ compra) →
        // fecha equivocada + flip entre renders. Sincronizado con
        // referrals.service.ts (listAdminCommissions).
        const tenantForDate = c.referralUse?.tenant;
        const firstMs = tenantForDate?.id
          ? firstChargeMsByTenant.get(tenantForDate.id)
          : undefined;
        // FECHA DURABLE: si la fila tiene businessDate congelado, se usa tal
        // cual (estable). Si no, fallback a la heurística (igual que admin).
        let commissionDate: Date;
        if (c.businessDate) {
          commissionDate = new Date(c.businessDate);
        } else if (
          tenantForDate?.purchasedAt &&
          firstMs !== undefined &&
          availableAt.getTime() === firstMs &&
          // GUARD R1 (Fable): purchasedAt no puede ser muy posterior a la 1ª
          // comisión (Bug B pudo estampar fecha de renovación). Paridad backfill.
          new Date(tenantForDate.purchasedAt).getTime() <=
            new Date(c.createdAt).getTime() + 86400000
        ) {
          commissionDate = new Date(tenantForDate.purchasedAt);
        } else {
          commissionDate = new Date(c.createdAt);
        }
        return {
          id: c.id,
          amount,
          status: c.status,
          // % aplicado de la comisión sobre el pago del cliente (25, 5, etc).
          percent,
          createdAt: c.createdAt,
          commissionDate,
          paidAt: c.paidAt,
          // B2: id del negocio para agrupar/entrar (drill-in) por marca.
          tenantId: c.referralUse?.tenant?.id ?? null,
          tenantBrand:
            c.referralUse?.tenant?.brandName ??
            (c.businessGroup?.name ? `Grupo: ${c.businessGroup.name}` : '—'),
          via: c.businessGroup ? 'grupo empresarial' : via,
          codeText: c.referralUse?.referralCode?.code ?? '',
          // Bloqueo de 15 días: días que faltan para desbloquear (0 = lista).
          daysRemaining,
          availableAt,
          // Próxima fecha posible de cobro (día 15 o último del mes).
          nextPayoutDate: affiliateNextPayoutDate(
            new Date(Math.max(Date.now(), availableAt.getTime())),
          ),
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
            planPeriodicity: true,
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
        // HOTFIX 2026-06-05 (bug #5 CRÍTICO): el precio se calcula a
        // partir de la periodicidad efectiva del tenant. Antes usábamos
        // priceMonthly directo, lo que subestimaba 3×/6×/12× para
        // tenants Trimestral/Semestral/Anual.
        const monthlyPrice = Number(u.tenant?.plan?.priceMonthly ?? 0);
        const periodMultiplier = (() => {
          switch (u.tenant?.planPeriodicity) {
            case 'TRIMESTRAL':
              return 3;
            case 'SEMESTRAL':
              return 6;
            case 'ANUAL':
              return 12;
            case 'MENSUAL':
            default:
              return 1;
          }
        })();
        const planPrice = monthlyPrice * periodMultiplier;
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

    // HOTFIX 2026-06-05 (bug #16): el "revenue" del vendor antes era
    // sum de TODAS las commissions del use (3-way: influencer + embajador
    // + vendor) — NO era revenue real del cliente. Lo renombramos para
    // que el embajador no se confunda. El campo se llama
    // teamGeneratedCommissionsUsd ahora. El revenue real al cliente
    // requeriría mirar tenant.plan.priceMonthly × periodMult × renovaciones,
    // que es otro nivel de cálculo. La métrica útil del embajador es
    // "cuánta plata generaron mis vendors en commissions totales" — eso
    // sigue siendo informativo aunque NO sea revenue del cliente.
    let teamGeneratedCommissions = 0;
    let teamVendorCommissions = 0;
    let teamClients = 0;
    let teamActiveClients = 0;

    const rows = vendors.map((v) => {
      const directUses = v.uses;
      teamClients += directUses.length;
      const active = directUses.filter(
        (u) => u.status === 'PAYING' || u.status === 'ACTIVE',
      ).length;
      teamActiveClients += active;
      const useGeneratedComm = directUses
        .flatMap((u) => u.commissions)
        .filter((c) => c.status !== 'REJECTED')
        .reduce((s, c) => s + Number(c.amount), 0);
      teamGeneratedCommissions += useGeneratedComm;
      const vendorCommissions = v.receivedCommissions.reduce(
        (s, c) => s + Number(c.amount),
        0,
      );
      teamVendorCommissions += vendorCommissions;
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
        // generatedCommissionsUsd: total de commissions atadas a las
        // sales que el vendor trajo (incluye influencer + embajador +
        // vendor). NO es revenue del cliente.
        generatedCommissionsUsd: round(useGeneratedComm),
        commissionsUsd: round(vendorCommissions),
      };
    });

    // Ranking: vendors top por commissions generadas (los 3 primeros).
    const topVendors = [...rows]
      .sort((a, b) => b.generatedCommissionsUsd - a.generatedCommissionsUsd)
      .slice(0, 3);

    return {
      kpis: {
        vendorsCount: vendors.length,
        activeVendorsCount: vendors.filter((v) => v.isActive).length,
        teamClients,
        teamActiveClients,
        // Total de commissions generadas por las sales que los vendors
        // trajeron. Incluye todas las personas en la chain.
        teamGeneratedCommissionsUsd: round(teamGeneratedCommissions),
        // Total de commissions que recibieron los vendors directamente.
        teamVendorCommissionsUsd: round(teamVendorCommissions),
      },
      vendors: rows,
      topVendors,
    };
  }

  /**
   * Métricas + detalle de trials atribuidos al afiliado logueado.
   * Item 4 (2026-06-05) — sistema de prueba 5d con atribución per rol.
   *
   * Scope:
   *   - INFLUENCER: trials de su code + de sus embajadores + de sus vendors.
   *   - AMBASSADOR: trials de su code + de sus vendors.
   *   - VENDOR: solo trials de su propio code.
   *   - SOCIO: solo trials de su propio code.
   *
   * KPIs:
   *   - trialsGenerated: count tenants con ReferralUse de cualquier code
   *     bajo este scope (cualquier tenant que se registró como TRIAL).
   *   - trialsActive: status=TRIAL y trialEndsAt > now.
   *   - trialsExpired: status=TRIAL y trialEndsAt <= now (todavía no convertido).
   *   - trialsConverted: status=ACTIVE (pagó, conversión exitosa).
   *   - conversionRate: trialsConverted / trialsGenerated (0..1).
   *
   * Tabla "Detalle de clientes" — 1 row por tenant con:
   *   brandName, createdAt, trialState, trialEndsAt, plan, conversionDate.
   */
  async trialStats(user: AuthUser) {
    this.assertAffiliate(user);
    const scope = await this.resolveAffiliateScope(user);
    const codeIds = scope.allDescendantCodeIds;
    if (!codeIds.length) {
      return {
        kpis: {
          trialsGenerated: 0,
          trialsActive: 0,
          trialsExpired: 0,
          trialsConverted: 0,
          conversionRate: 0,
        },
        rows: [] as Array<Record<string, unknown>>,
        shareCode: null as string | null,
      };
    }

    // Tomamos los uses con tenant — un afiliado solo ve clientes (tenant).
    // El use es la fuente de verdad para "este tenant fue atribuido a mí".
    // status del use no afecta — un tenant ACTIVE pero con use SIGNED_UP
    // sigue siendo conversión (pasó por el funnel del afiliado).
    const uses = await this.prisma.referralUse.findMany({
      where: {
        referralCodeId: { in: codeIds },
        tenantId: { not: null },
        // Solo trials atribuidos al afiliado — los signups normales
        // (Hotmart sin trial) también pasan por aquí, pero los excluimos
        // del foco de esta vista filtrando por tenant.trialStartedAt
        // not-null + trialEndsAt not-null. Esos tenants pasaron por
        // /prueba o /trial.
        tenant: {
          is: {
            trialStartedAt: { not: null },
            trialEndsAt: { not: null },
          },
        },
      },
      include: {
        tenant: {
          select: {
            id: true,
            brandName: true,
            status: true,
            createdAt: true,
            trialStartedAt: true,
            trialEndsAt: true,
            trialSource: true,
            currentPeriodEnd: true,
            planPeriodicity: true,
            plan: { select: { name: true } },
            // El afiliado quiere ver si el cliente convirtió. La conversión
            // se marca con tenant.status=ACTIVE — pero también con
            // referralUse.convertedAt si existe (más fiable temporalmente).
          },
        },
        referralCode: {
          select: { code: true, role: true, ownerName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    let trialsActive = 0;
    let trialsExpired = 0;
    let trialsConverted = 0;
    // Dedup: si por error de migración un tenant tiene 2 uses, contamos
    // 1 sola vez (FIRST REFERRAL WINS). Tomamos el use con createdAt más
    // antiguo como "el ganador" — el .orderBy desc + Map fallback nos da
    // exactamente eso (el último write gana, que es el más antiguo).
    const byTenant = new Map<string, (typeof uses)[number]>();
    for (const u of uses) {
      if (!u.tenant) continue;
      const existing = byTenant.get(u.tenant.id);
      if (!existing || u.createdAt < existing.createdAt) {
        byTenant.set(u.tenant.id, u);
      }
    }
    const unique = Array.from(byTenant.values());

    const rows = unique.map((u) => {
      const t = u.tenant!;
      const isTrial = t.status === 'TRIAL';
      const trialEndsAt = t.trialEndsAt;
      const trialExpired =
        isTrial && trialEndsAt ? trialEndsAt <= now : false;
      const trialActive = isTrial && !trialExpired;
      const converted = t.status === 'ACTIVE';

      if (trialActive) trialsActive += 1;
      if (trialExpired) trialsExpired += 1;
      if (converted) trialsConverted += 1;

      // Días restantes del trial (negativo si ya venció).
      const daysLeft = trialEndsAt
        ? Math.ceil(
            (trialEndsAt.getTime() - now.getTime()) / (24 * 3600 * 1000),
          )
        : null;

      // "Estado de pago" — derivado del estado del tenant.
      // ACTIVE = pagó. SUSPENDED = pagó alguna vez pero ahora suspendido.
      // TRIAL = sin pago todavía.
      let paymentStatus: 'PENDING' | 'PAID' | 'SUSPENDED' = 'PENDING';
      if (t.status === 'ACTIVE') paymentStatus = 'PAID';
      else if (t.status === 'SUSPENDED') paymentStatus = 'SUSPENDED';

      return {
        tenantId: t.id,
        brandName: t.brandName,
        createdAt: t.createdAt,
        trialState: isTrial
          ? trialExpired
            ? 'EXPIRED'
            : 'ACTIVE'
          : t.status === 'ACTIVE'
            ? 'CONVERTED'
            : 'SUSPENDED',
        trialEndsAt,
        daysLeft,
        paymentStatus,
        planName: t.plan?.name ?? null,
        planPeriodicity: t.planPeriodicity ?? null,
        // Fecha de conversión: si pagó, usamos currentPeriodEnd menos 1 ciclo
        // (aproximado) o referralUse.convertedAt si está. Preferimos convertedAt.
        convertedAt: u.convertedAt ?? null,
        attributionCode: u.referralCode.code,
        attributionRole: u.referralCode.role,
        attributionOwnerName: u.referralCode.ownerName,
        trialSource: t.trialSource ?? null,
      };
    });

    const trialsGenerated = unique.length;
    const conversionRate =
      trialsGenerated > 0
        ? Math.round((trialsConverted / trialsGenerated) * 10000) / 10000
        : 0;

    // shareCode: el code propio del afiliado, para construir el link de
    // trial en el frontend ({LANDING}/trial?ref=<code>). Solo lo
    // devolvemos si tiene code activo — los SOCIO también pueden compartir
    // su link de trial (aunque la atribución no le pague indirecto extra,
    // sí le suma a sus métricas).
    let shareCode: string | null = null;
    if (scope.myCodeId) {
      const myCode = await this.prisma.referralCode.findUnique({
        where: { id: scope.myCodeId },
        select: { code: true, isActive: true },
      });
      if (myCode?.isActive) shareCode = myCode.code;
    }

    return {
      kpis: {
        trialsGenerated,
        trialsActive,
        trialsExpired,
        trialsConverted,
        conversionRate,
      },
      rows,
      shareCode,
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

type TopVendorRow = AmbassadorRow & {
  embajador: { id: string; code: string; ownerName: string } | null;
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

// HOTFIX 2026-06-05 (bug #8 CRÍTICO): aceptamos opcional `myCodeIds`
// para filtrar las commissions por recipientCodeId. Antes la función
// sumaba TODAS las commissions del use sin distinguir el destinatario,
// lo que para sales con 3-way split (foundation 2026-06-05) inflaba
// el revenueUsd / pendingUsd / paidUsd del afiliado en 2-3×.
function aggregateKpis(
  uses: UseWithCommissions[],
  myCodeIds?: string[],
): Kpis {
  const k = emptyKpis();
  k.referrals = uses.length;
  const codeSet = myCodeIds ? new Set(myCodeIds) : null;
  for (const u of uses) {
    if (u.status === 'PAYING' || u.status === 'ACTIVE') k.conversions += 1;
    for (const c of u.commissions ?? []) {
      // PDF Soft(9) B1: las comisiones CANCELADAS (REJECTED) no cuentan en
      // revenue/pending/paid del embajador (antes seguían sumando aunque el
      // admin las anulara → el panel no reflejaba el cambio).
      if (c.status === 'REJECTED') continue;
      // Si pasaron myCodeIds, filtramos: solo cuentan las commissions
      // cuyo recipient está en mi set. Backwards-compat con rows
      // legacy: si recipientCodeId es null (pre-3-way), aceptamos
      // como "del use direct" (no podemos discriminar).
      if (codeSet) {
        const recipient = (c as any).recipientCodeId as string | null | undefined;
        if (recipient && !codeSet.has(recipient)) continue;
      }
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
