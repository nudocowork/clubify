import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WhiteLabelStatus, CreditTransactionType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export type WhiteLabelDto = {
  name: string;
  slug?: string;
  domain?: string;
  appDomain?: string;
  primaryColor?: string;
  initial?: string;
  adminEmail?: string;
};

export type HotmartLinkDto = {
  credits: number;
  label: string;
  url: string;
  price?: number | null;
  currency?: string;
  position?: number;
  isActive?: boolean;
};

export type CreditAdjustDto = {
  whiteLabelId: string;
  amount: number; // positivo agrega, negativo descuenta
  note?: string;
  type?: CreditTransactionType;
};

/**
 * SuperAdminService — capa de datos del panel global (Nivel 1).
 *
 * Operaciones agregadas sobre TODA la plataforma: marcas blancas,
 * créditos, módulos, integraciones. Nunca modifica datos internos de
 * los tenants (Nivel 3) — solo gestiona la metadata de nivel de marca.
 */
@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService) {}

  /** Panorama global para el dashboard. Totales + alertas. */
  async dashboard() {
    const [whiteLabels, tenants, suspendedTenants, pendingTenants, creditsAgg, renewals7d] = await Promise.all([
      this.prisma.whiteLabel.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          initial: true,
          primaryColor: true,
          status: true,
          creditsAvailable: true,
          creditsCommitted: true,
          creditsUsed: true,
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      // "Pendiente de activación" = trial expirado o sin currentPeriodEnd
      this.prisma.tenant.count({
        where: {
          OR: [
            { status: 'TRIAL', trialEndsAt: { lt: new Date() } },
            { status: 'ACTIVE', currentPeriodEnd: { lt: new Date() } },
          ],
        },
      }),
      this.prisma.whiteLabel.aggregate({
        _sum: {
          creditsAvailable: true,
          creditsCommitted: true,
          creditsUsed: true,
        },
      }),
      // Próximas renovaciones a 7 días = tenants con currentPeriodEnd
      // dentro de [now, now+7d] y status ACTIVE
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const activeWl = whiteLabels.filter((w) => w.status === 'ACTIVE').length;
    const suspendedWl = whiteLabels.filter((w) => w.status === 'SUSPENDED').length;

    // Alertas
    const alerts: any[] = [];
    if (pendingTenants > 0) {
      alerts.push({
        type: 'ALERTA',
        title: `${pendingTenants} negocio${pendingTenants === 1 ? '' : 's'} pendiente${pendingTenants === 1 ? '' : 's'} de activación`,
        body: 'Marcas con créditos insuficientes para activarlos.',
        link: '/superadmin/cobros',
        kind: 'warning',
      });
    }
    const lowCreditsBrands = whiteLabels.filter(
      (w) => w.status === 'ACTIVE' && w.creditsAvailable < w.creditsCommitted,
    );
    if (lowCreditsBrands.length > 0) {
      alerts.push({
        type: 'SUGERENCIA',
        title: `${lowCreditsBrands.length} marca${lowCreditsBrands.length === 1 ? '' : 's'} con créditos bajos`,
        body: lowCreditsBrands
          .slice(0, 2)
          .map((w) => w.name)
          .join(' y ') + ' están por debajo de sus créditos comprometidos.',
        link: '/superadmin/creditos',
        kind: 'success',
      });
    }

    return {
      summary: {
        whiteLabels: whiteLabels.length,
        whiteLabelsActive: activeWl,
        whiteLabelsSuspended: suspendedWl,
        tenantsActive: tenants,
        tenantsSuspended: suspendedTenants,
        tenantsPending: pendingTenants,
        creditsAvailable: creditsAgg._sum.creditsAvailable ?? 0,
        creditsCommitted: creditsAgg._sum.creditsCommitted ?? 0,
        creditsUsed: creditsAgg._sum.creditsUsed ?? 0,
        renewals7d,
      },
      alerts,
      whiteLabels,
    };
  }

  // ============================================================
  //                       MARCAS BLANCAS
  // ============================================================

  async listWhiteLabels() {
    const items = await this.prisma.whiteLabel.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { tenants: true },
        },
        modules: true,
      },
    });

    // Sub-conteos por marca: tenants activos / suspendidos / admins
    const enriched = await Promise.all(
      items.map(async (w) => {
        const [active, suspended, admins] = await Promise.all([
          this.prisma.tenant.count({ where: { whiteLabelId: w.id, status: 'ACTIVE' } }),
          this.prisma.tenant.count({ where: { whiteLabelId: w.id, status: 'SUSPENDED' } }),
          this.prisma.user.count({
            where: {
              role: { in: ['SUPER_ADMIN', 'TENANT_OWNER'] },
              tenant: { whiteLabelId: w.id },
            },
          }),
        ]);
        return {
          ...w,
          tenantsActive: active,
          tenantsSuspended: suspended,
          adminsCount: admins,
        };
      }),
    );
    return enriched;
  }

  async getWhiteLabel(id: string) {
    const wl = await this.prisma.whiteLabel.findUnique({
      where: { id },
      include: {
        modules: { orderBy: { module: 'asc' } },
        tenants: {
          select: { id: true, brandName: true, slug: true, status: true },
          orderBy: { brandName: 'asc' },
          take: 50,
        },
      },
    });
    if (!wl) throw new NotFoundException();
    const admins = await this.prisma.user.findMany({
      where: {
        role: { in: ['SUPER_ADMIN', 'TENANT_OWNER'] },
        tenant: { whiteLabelId: wl.id },
      },
      select: { id: true, email: true, fullName: true, role: true },
      take: 20,
    });
    return { ...wl, admins };
  }

  async createWhiteLabel(dto: WhiteLabelDto) {
    if (!dto.name?.trim()) throw new BadRequestException('Nombre requerido');
    const slug = (dto.slug || dto.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) throw new BadRequestException('Slug inválido');
    try {
      return await this.prisma.whiteLabel.create({
        data: {
          name: dto.name.trim(),
          slug,
          domain: dto.domain?.trim() || null,
          appDomain: dto.appDomain?.trim() || null,
          primaryColor: dto.primaryColor || '#16a34a',
          initial: (dto.initial || dto.name.trim()[0] || 'M').toUpperCase().slice(0, 1),
          adminEmail: dto.adminEmail?.trim().toLowerCase() || null,
          modules: {
            create: [
              { module: 'REFERRALS', enabled: true },
              { module: 'ORDERS', enabled: true },
              { module: 'GROW_BUSINESS_SMS', enabled: true },
            ],
          },
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('Slug ya en uso');
      }
      throw e;
    }
  }

  async updateWhiteLabel(id: string, patch: Partial<WhiteLabelDto>) {
    const existing = await this.prisma.whiteLabel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    return this.prisma.whiteLabel.update({
      where: { id },
      data: {
        name: patch.name?.trim() ?? existing.name,
        domain: patch.domain === undefined ? undefined : patch.domain?.trim() || null,
        appDomain: patch.appDomain === undefined ? undefined : patch.appDomain?.trim() || null,
        primaryColor: patch.primaryColor ?? undefined,
        initial: patch.initial ? patch.initial.toUpperCase().slice(0, 1) : undefined,
        adminEmail: patch.adminEmail === undefined ? undefined : patch.adminEmail?.trim().toLowerCase() || null,
      },
    });
  }

  /** Suspende o reactiva la marca. Las marcas NO se eliminan (regla PRD). */
  async setStatus(id: string, status: WhiteLabelStatus) {
    const existing = await this.prisma.whiteLabel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    return this.prisma.whiteLabel.update({
      where: { id },
      data: { status },
    });
  }

  // ============================================================
  //                           CRÉDITOS
  // ============================================================

  /** Datos para /superadmin/creditos: KPIs globales + breakdown por
   *  marca + consumidos del mes y del año. */
  async creditsCenter() {
    const [agg, whiteLabels, monthAgg, yearAgg, pendingTenants] = await Promise.all([
      this.prisma.whiteLabel.aggregate({
        _sum: {
          creditsAvailable: true,
          creditsCommitted: true,
          creditsUsed: true,
        },
      }),
      this.prisma.whiteLabel.findMany({
        orderBy: { creditsAvailable: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          initial: true,
          primaryColor: true,
          status: true,
          creditsAvailable: true,
          creditsCommitted: true,
          creditsUsed: true,
        },
      }),
      this.prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: {
          type: 'CONSUME',
          createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      this.prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: {
          type: 'CONSUME',
          createdAt: { gte: new Date(new Date().getFullYear(), 0, 1) },
        },
      }),
      this.prisma.tenant.count({
        where: {
          OR: [
            { status: 'TRIAL', trialEndsAt: { lt: new Date() } },
            { status: 'ACTIVE', currentPeriodEnd: { lt: new Date() } },
          ],
        },
      }),
    ]);

    return {
      summary: {
        available: agg._sum.creditsAvailable ?? 0,
        committed: agg._sum.creditsCommitted ?? 0,
        usedMonth: Math.abs(monthAgg._sum.amount ?? 0),
        usedYear: Math.abs(yearAgg._sum.amount ?? 0),
        pendingTenants,
      },
      whiteLabels,
    };
  }

  /** Ajuste manual de créditos: agrega o descuenta. Crea CreditTransaction
   *  de tipo PURCHASE (positivo) / ADJUSTMENT (negativo) o el tipo explícito. */
  async adjustCredits(dto: CreditAdjustDto) {
    if (!dto.amount || dto.amount === 0) {
      throw new BadRequestException('amount distinto de 0 requerido');
    }
    const wl = await this.prisma.whiteLabel.findUnique({ where: { id: dto.whiteLabelId } });
    if (!wl) throw new NotFoundException('Marca no encontrada');

    const newAvailable = Math.max(0, wl.creditsAvailable + dto.amount);
    const newUsed = dto.amount < 0 ? wl.creditsUsed + Math.abs(dto.amount) : wl.creditsUsed;

    const [, updated] = await this.prisma.$transaction([
      this.prisma.creditTransaction.create({
        data: {
          whiteLabelId: dto.whiteLabelId,
          type: dto.type ?? (dto.amount > 0 ? 'PURCHASE' : 'ADJUSTMENT'),
          amount: dto.amount,
          note: dto.note?.trim() || null,
        },
      }),
      this.prisma.whiteLabel.update({
        where: { id: dto.whiteLabelId },
        data: {
          creditsAvailable: newAvailable,
          creditsUsed: newUsed,
        },
      }),
    ]);
    return updated;
  }

  // ============================================================
  //                       HOTMART CREDIT LINKS
  // ============================================================

  listHotmartLinks() {
    return this.prisma.hotmartCreditLink.findMany({
      orderBy: [{ position: 'asc' }, { credits: 'asc' }],
    });
  }

  async createHotmartLink(dto: HotmartLinkDto) {
    if (!dto.credits || dto.credits < 1) throw new BadRequestException('credits >= 1');
    if (!dto.label?.trim()) throw new BadRequestException('label requerido');
    if (!dto.url?.trim()) throw new BadRequestException('url requerida');
    return this.prisma.hotmartCreditLink.create({
      data: {
        credits: dto.credits,
        label: dto.label.trim(),
        url: dto.url.trim(),
        price: dto.price !== null && dto.price !== undefined ? new Prisma.Decimal(dto.price) : null,
        currency: dto.currency ?? 'MXN',
        position: dto.position ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateHotmartLink(id: string, patch: Partial<HotmartLinkDto>) {
    const existing = await this.prisma.hotmartCreditLink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    const data: any = {
      label: patch.label?.trim(),
      url: patch.url?.trim(),
      credits: patch.credits,
      currency: patch.currency,
      position: patch.position,
      isActive: patch.isActive,
    };
    if (patch.price !== undefined) {
      data.price = patch.price === null ? null : new Prisma.Decimal(patch.price);
    }
    return this.prisma.hotmartCreditLink.update({ where: { id }, data });
  }

  async removeHotmartLink(id: string) {
    await this.prisma.hotmartCreditLink.delete({ where: { id } });
    return { ok: true };
  }
}
