import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, WhiteLabelStatus, CreditTransactionType, ModuleKey } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'crypto';

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
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private email: EmailService,
  ) {}

  /** PLATFORM_OWNER entra al panel de una marca blanca como su SUPER_ADMIN.
   *  Estrategia: buscar el primer User SUPER_ADMIN cuyo tenant esté
   *  vinculado a la marca; si no hay, intentar por adminEmail; si
   *  tampoco, error. */
  async impersonateWhiteLabel(whiteLabelId: string, platformOwnerId: string) {
    const wl = await this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId } });
    if (!wl) throw new NotFoundException('Marca no encontrada');
    if (wl.status === 'SUSPENDED') {
      throw new BadRequestException('La marca está suspendida. Reactivá antes de entrar.');
    }

    // 0) Mejor opción: SUPER_ADMIN dedicado de la marca (User.whiteLabelId
    //    apuntando directo a la marca, sin tenant). Es el patrón
    //    canónico introducido en 2026-06-13.
    let admin = await this.prisma.user.findFirst({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true,
        whiteLabelId,
      },
      orderBy: { createdAt: 'asc' },
    });

    // 1) Fallback histórico: SUPER_ADMIN ligado a un tenant de la marca.
    if (!admin) {
      admin = await this.prisma.user.findFirst({
        where: {
          role: 'SUPER_ADMIN',
          isActive: true,
          tenant: { whiteLabelId },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // 2) Fallback: User cuyo email matchee adminEmail de la marca con
    //    rol SUPER_ADMIN o TENANT_OWNER (no PLATFORM_OWNER porque éste
    //    es el propio operador del Master Admin).
    if (!admin && wl.adminEmail) {
      admin = await this.prisma.user.findFirst({
        where: {
          email: { equals: wl.adminEmail, mode: 'insensitive' },
          isActive: true,
          role: { in: ['SUPER_ADMIN', 'TENANT_OWNER'] },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // 3) Fallback final: cualquier TENANT_OWNER de cualquier tenant
    //    de la marca. Útil cuando el adminEmail original fue promovido
    //    a PLATFORM_OWNER (como en el caso de Clubify después de la
    //    migración inicial) y no quedó ningún SUPER_ADMIN de respaldo.
    if (!admin) {
      admin = await this.prisma.user.findFirst({
        where: {
          role: 'TENANT_OWNER',
          isActive: true,
          tenant: { whiteLabelId },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    if (!admin) {
      throw new BadRequestException(
        `Esta marca no tiene ningún SUPER_ADMIN ni TENANT_OWNER activo para entrar. Crea uno antes.`,
      );
    }

    const payload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
      impersonatedBy: platformOwnerId,
    };
    const accessToken = this.jwt.sign(payload);

    this.audit.log({
      actorId: platformOwnerId,
      tenantId: admin.tenantId ?? undefined,
      action: 'superadmin.impersonate_white_label',
      resource: `whiteLabel:${wl.id}`,
      metadata: {
        whiteLabelName: wl.name,
        userImpersonated: admin.id,
      },
    });

    return {
      accessToken,
      user: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
        tenantId: admin.tenantId,
      },
      whiteLabel: {
        id: wl.id,
        name: wl.name,
        primaryColor: wl.primaryColor,
      },
    };
  }

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
        OR: [
          { whiteLabelId: wl.id, role: 'SUPER_ADMIN' },
          { role: { in: ['SUPER_ADMIN', 'TENANT_OWNER'] }, tenant: { whiteLabelId: wl.id } },
        ],
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, whiteLabelId: true },
      orderBy: [{ whiteLabelId: 'desc' }, { createdAt: 'asc' }],
      take: 30,
    });
    return { ...wl, admins };
  }

  // ============================================================
  //               ADMINS DEDICADOS DE UNA MARCA
  // ============================================================

  async listWhiteLabelAdminInvites(whiteLabelId: string) {
    const wl = await this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId } });
    if (!wl) throw new NotFoundException('Marca no encontrada');
    const invites = await this.prisma.whiteLabelAdminInvite.findMany({
      where: { whiteLabelId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { id: true, email: true, fullName: true } } },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      fullName: i.fullName,
      invitedBy: i.invitedBy ? { email: i.invitedBy.email, fullName: i.invitedBy.fullName } : null,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    }));
  }

  async inviteWhiteLabelAdmin(
    whiteLabelId: string,
    dto: { email: string; fullName: string },
    actorId: string,
  ) {
    const wl = await this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId } });
    if (!wl) throw new NotFoundException('Marca no encontrada');
    const email = dto.email.trim().toLowerCase();
    const fullName = dto.fullName.trim();
    if (!email || !fullName) throw new BadRequestException('Email y nombre son requeridos');

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, whiteLabelId: true, isActive: true },
    });
    if (existing && existing.role === 'SUPER_ADMIN' && existing.whiteLabelId === whiteLabelId && existing.isActive) {
      throw new ConflictException('Este usuario ya es admin de la marca');
    }
    if (existing && existing.role === 'PLATFORM_OWNER') {
      throw new ConflictException('Este usuario es PLATFORM_OWNER, no se puede degradar a admin de marca');
    }

    const pending = await this.prisma.whiteLabelAdminInvite.findFirst({
      where: { whiteLabelId, email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pending) {
      throw new ConflictException('Ya hay una invitación pendiente para ese email en esta marca');
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.whiteLabelAdminInvite.create({
      data: { whiteLabelId, email, fullName, tokenHash, invitedById: actorId, expiresAt },
    });

    const cfg = await this.getPlatformConfig();
    const platformName = cfg.name || 'Fidelia';
    const baseUrl = wl.appDomain
      ? `https://${wl.appDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
      : (cfg.consoleDomain
          ? `https://${cfg.consoleDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
          : (process.env.PUBLIC_APP_URL || 'https://app.soyclubify.com'));
    const acceptUrl = `${baseUrl}/aceptar-invitacion-marca/${token}`;

    await this.email.send({
      to: email,
      subject: `Te invitaron a administrar ${wl.name}`,
      html: whiteLabelInviteEmailHtml({
        fullName,
        whiteLabelName: wl.name,
        primaryColor: wl.primaryColor,
        platformName,
        acceptUrl,
        expiresAt,
      }),
      text: `Hola ${fullName}, te invitaron a administrar ${wl.name}. Aceptá tu invitación acá: ${acceptUrl}. El enlace vence el ${expiresAt.toLocaleDateString('es-MX')}.`,
    });

    await this.logAction(actorId, 'superadmin.white_label_admin_invite.create', `whiteLabel:${whiteLabelId}`, {
      whiteLabelName: wl.name, email, fullName,
    });

    return { id: invite.id, email, fullName, expiresAt };
  }

  async revokeWhiteLabelAdminInvite(inviteId: string, actorId: string) {
    const invite = await this.prisma.whiteLabelAdminInvite.findUnique({ where: { id: inviteId } });
    if (!invite) throw new NotFoundException('Invitación no encontrada');
    if (invite.acceptedAt) throw new BadRequestException('La invitación ya fue aceptada');
    if (invite.revokedAt) return { ok: true, alreadyRevoked: true };
    await this.prisma.whiteLabelAdminInvite.update({
      where: { id: inviteId },
      data: { revokedAt: new Date() },
    });
    await this.logAction(actorId, 'superadmin.white_label_admin_invite.revoke', `whiteLabel:${invite.whiteLabelId}`, {
      email: invite.email,
    });
    return { ok: true };
  }

  async toggleWhiteLabelAdminActive(userId: string, isActive: boolean, actorId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isActive: true, whiteLabelId: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.role !== 'SUPER_ADMIN' || !user.whiteLabelId) {
      throw new BadRequestException('Solo se puede toggle SUPER_ADMINs dedicados de una marca');
    }
    if (user.isActive === isActive) return { ok: true, noop: true };

    await this.prisma.user.update({ where: { id: userId }, data: { isActive } });
    await this.logAction(actorId, 'superadmin.white_label_admin.toggle', `user:${userId}`, {
      email: user.email,
      whiteLabelId: user.whiteLabelId,
      to: isActive ? 'active' : 'inactive',
    });
    return { ok: true };
  }

  async lookupWhiteLabelAdminInvite(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.whiteLabelAdminInvite.findUnique({
      where: { tokenHash },
      include: { whiteLabel: { select: { name: true, primaryColor: true } } },
    });
    if (!invite) throw new NotFoundException('Invitación inválida o ya usada');
    if (invite.acceptedAt) throw new BadRequestException('Invitación ya aceptada');
    if (invite.revokedAt) throw new BadRequestException('Invitación revocada');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invitación vencida');
    return {
      email: invite.email,
      fullName: invite.fullName,
      expiresAt: invite.expiresAt,
      whiteLabel: invite.whiteLabel,
    };
  }

  async acceptWhiteLabelAdminInvite(token: string, password: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.whiteLabelAdminInvite.findUnique({
      where: { tokenHash },
    });
    if (!invite) throw new NotFoundException('Invitación inválida');
    if (invite.acceptedAt) throw new BadRequestException('Invitación ya aceptada');
    if (invite.revokedAt) throw new BadRequestException('Invitación revocada');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invitación vencida');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: invite.email } });
      if (existing && existing.role === 'PLATFORM_OWNER') {
        throw new ConflictException('Este email ya pertenece a un PLATFORM_OWNER');
      }
      const u = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              role: 'SUPER_ADMIN',
              whiteLabelId: invite.whiteLabelId,
              tenantId: null,
              isActive: true,
              passwordHash,
              passwordChangedAt: new Date(),
              fullName: existing.fullName || invite.fullName,
            },
          })
        : await tx.user.create({
            data: {
              email: invite.email,
              fullName: invite.fullName,
              role: 'SUPER_ADMIN',
              whiteLabelId: invite.whiteLabelId,
              passwordHash,
              isActive: true,
            },
          });
      await tx.whiteLabelAdminInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: u.id },
      });
      return u;
    });

    await this.logAction(invite.invitedById, 'superadmin.white_label_admin_invite.accept', `whiteLabel:${invite.whiteLabelId}`, {
      email: invite.email, userId: user.id,
    });

    return { ok: true, email: user.email };
  }

  /** Historial de eventos del Master Admin. Filtra el AuditLog global
   *  para mostrar sólo las acciones que el PLATFORM_OWNER hizo (action
   *  empieza con "superadmin.") */
  async history(filter: { actorId?: string; limit?: number } = {}) {
    const items = await this.prisma.auditLog.findMany({
      where: {
        action: { startsWith: 'superadmin.' },
        ...(filter.actorId ? { actorId: filter.actorId } : {}),
      },
      include: {
        actor: { select: { id: true, email: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, filter.limit ?? 100),
    });
    return items;
  }

  /** Audit helper para que cualquier acción del módulo quede trackeada
   *  sin tener que pasar el actorId explícito desde cada método. */
  private async logAction(actorId: string | undefined, action: string, resource: string, metadata: any = {}) {
    if (!actorId) return;
    try {
      await this.audit.log({ actorId, action, resource, metadata });
    } catch (e) {
      // No bloquear la operación si falla el audit.
      console.warn('audit log fail', (e as Error).message);
    }
  }

  async createWhiteLabel(dto: WhiteLabelDto, actorId?: string) {
    if (!dto.name?.trim()) throw new BadRequestException('Nombre requerido');
    const slug = (dto.slug || dto.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slug) throw new BadRequestException('Slug inválido');
    try {
      const created = await this.prisma.whiteLabel.create({
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
      await this.logAction(actorId, 'superadmin.white_label.create', `whiteLabel:${created.id}`, {
        whiteLabelName: created.name,
        slug: created.slug,
        adminEmail: created.adminEmail,
      });
      return created;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new ConflictException('Slug ya en uso');
      }
      throw e;
    }
  }

  async updateWhiteLabel(id: string, patch: Partial<WhiteLabelDto>, actorId?: string) {
    const existing = await this.prisma.whiteLabel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    const updated = await this.prisma.whiteLabel.update({
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
    await this.logAction(actorId, 'superadmin.white_label.update', `whiteLabel:${id}`, {
      whiteLabelName: existing.name,
      changes: patch,
    });
    return updated;
  }

  /** Suspende o reactiva la marca. Las marcas NO se eliminan (regla PRD). */
  async setStatus(id: string, status: WhiteLabelStatus, actorId?: string) {
    const existing = await this.prisma.whiteLabel.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    const updated = await this.prisma.whiteLabel.update({
      where: { id },
      data: { status },
    });
    await this.logAction(actorId, 'superadmin.white_label.status', `whiteLabel:${id}`, {
      whiteLabelName: existing.name,
      from: existing.status,
      to: status,
    });
    return updated;
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
  async adjustCredits(dto: CreditAdjustDto, actorId?: string) {
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
    await this.logAction(actorId, 'superadmin.credits.adjust', `whiteLabel:${wl.id}`, {
      whiteLabelName: wl.name,
      amount: dto.amount,
      type: dto.type ?? (dto.amount > 0 ? 'PURCHASE' : 'ADJUSTMENT'),
      note: dto.note,
    });
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

  // ============================================================
  //                           MÓDULOS
  // ============================================================

  /** Matriz para /superadmin/modulos: filas = marcas, columnas =
   *  los 3 módulos. Si la marca no tiene una fila de
   *  WhiteLabelModule para un módulo, asumimos enabled=false. */
  async modulesMatrix() {
    const ALL_MODULES: ModuleKey[] = ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS'];
    const whiteLabels = await this.prisma.whiteLabel.findMany({
      orderBy: { name: 'asc' },
      include: {
        modules: true,
      },
    });
    const rows = whiteLabels.map((w) => {
      const flags: Record<string, boolean> = {};
      for (const k of ALL_MODULES) {
        const m = w.modules.find((x) => x.module === k);
        flags[k] = m?.enabled ?? false;
      }
      return {
        id: w.id,
        name: w.name,
        initial: w.initial,
        primaryColor: w.primaryColor,
        status: w.status,
        modules: flags,
      };
    });
    return { modules: ALL_MODULES, rows };
  }

  async toggleModule(whiteLabelId: string, module: ModuleKey, enabled: boolean, actorId?: string) {
    const wl = await this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId } });
    if (!wl) throw new NotFoundException();
    const updated = await this.prisma.whiteLabelModule.upsert({
      where: { whiteLabelId_module: { whiteLabelId, module } },
      update: { enabled },
      create: { whiteLabelId, module, enabled },
    });
    await this.logAction(actorId, 'superadmin.module.toggle', `whiteLabel:${whiteLabelId}`, {
      whiteLabelName: wl.name,
      module,
      enabled,
    });
    return updated;
  }

  // ============================================================
  //                          CENTRO DE COBROS
  // ============================================================

  /** KPIs + tabla de próximas renovaciones para /superadmin/cobros.
   *  Por ahora cada Tenant activo cuenta como 1 crédito por renovación
   *  (1 crédito = 30 días). En el futuro: derivar del plan/periodicidad. */
  async billingCenter() {
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const in14d = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const minus5d = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);

    const [upcoming, pending, inGrace, suspended] = await Promise.all([
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: { gte: now, lte: in7d },
        },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: { lt: now },
        },
      }),
      this.prisma.tenant.count({
        where: {
          status: 'ACTIVE',
          currentPeriodEnd: { gte: minus5d, lt: now },
        },
      }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    ]);

    const renewals = await this.prisma.tenant.findMany({
      where: {
        currentPeriodEnd: { lte: in14d },
        status: { in: ['ACTIVE'] },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      take: 50,
      select: {
        id: true,
        brandName: true,
        slug: true,
        status: true,
        currentPeriodEnd: true,
        whiteLabel: {
          select: { id: true, name: true, primaryColor: true, initial: true },
        },
      },
    });

    const rows = renewals.map((t) => {
      const due = t.currentPeriodEnd ? new Date(t.currentPeriodEnd) : null;
      let state: 'POR_RENOVAR' | 'PENDIENTE' | 'EN_GRACIA' = 'POR_RENOVAR';
      if (due) {
        if (due < now && due >= minus5d) state = 'EN_GRACIA';
        else if (due < minus5d) state = 'PENDIENTE';
      }
      return {
        id: t.id,
        brandName: t.brandName,
        slug: t.slug,
        whiteLabel: t.whiteLabel
          ? { id: t.whiteLabel.id, name: t.whiteLabel.name, primaryColor: t.whiteLabel.primaryColor, initial: t.whiteLabel.initial }
          : null,
        currentPeriodEnd: t.currentPeriodEnd,
        creditsRequired: 1,
        state,
      };
    });

    return {
      summary: { upcoming, pending, inGrace, suspended },
      renewals: rows,
    };
  }

  /** Contadores para los badges del sidebar (sin payload pesado). */
  async sidebarBadges() {
    const now = new Date();
    const minus5d = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const [whiteLabels, billingNeedsAttention] = await Promise.all([
      this.prisma.whiteLabel.count(),
      this.prisma.tenant.count({
        where: {
          OR: [
            { status: 'ACTIVE', currentPeriodEnd: { lt: now, gte: minus5d } },
            { status: 'ACTIVE', currentPeriodEnd: { lt: minus5d } },
          ],
        },
      }),
    ]);
    return { whiteLabels, billing: billingNeedsAttention };
  }

  // ============================================================
  //                       INTEGRACIONES
  // ============================================================

  /** Default catalog: si no existen filas en DB para una integración
   *  conocida, las pre-creamos al hacer list. Permite que el dueño
   *  configure desde el panel sin un seed inicial. */
  private static readonly DEFAULT_INTEGRATIONS = [
    {
      key: 'grow_business',
      name: 'GrowBusiness',
      description:
        'Envío de SMS, notificaciones y recordatorios. No es una marca blanca — es una integración global activada desde MasterAdmin.',
    },
  ];

  async listIntegrations() {
    const existing = await this.prisma.platformIntegration.findMany({
      orderBy: { name: 'asc' },
    });
    const existingKeys = new Set(existing.map((i) => i.key));
    for (const def of SuperAdminService.DEFAULT_INTEGRATIONS) {
      if (!existingKeys.has(def.key)) {
        await this.prisma.platformIntegration.create({
          data: { ...def, status: 'DISCONNECTED', config: {} },
        });
      }
    }
    const all = await this.prisma.platformIntegration.findMany({
      orderBy: { name: 'asc' },
    });
    return all.map((i) => ({
      ...i,
      config: maskSensitiveConfig(i.config as any),
    }));
  }

  async updateIntegration(key: string, patch: { config?: any; status?: string }) {
    const existing = await this.prisma.platformIntegration.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException();
    const data: any = {};
    if (patch.status) data.status = patch.status;
    if (patch.config) {
      // Merge config con el existente para no perder valores que no
      // se mandaron en el patch.
      data.config = {
        ...((existing.config as any) || {}),
        ...(patch.config || {}),
      };
    }
    const updated = await this.prisma.platformIntegration.update({
      where: { key },
      data,
    });
    return { ...updated, config: maskSensitiveConfig(updated.config as any) };
  }

  /** "Probar conexión" — por ahora marca como CONNECTED si tiene apiKey
   *  configurada, sin pegarle al endpoint real. En PR posterior se
   *  puede conectar al servicio real. */
  async testIntegration(key: string) {
    const existing = await this.prisma.platformIntegration.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException();
    const cfg = (existing.config as any) || {};
    const ok = !!cfg.apiKey;
    await this.prisma.platformIntegration.update({
      where: { key },
      data: { status: ok ? 'CONNECTED' : 'DISCONNECTED' },
    });
    return {
      ok,
      message: ok
        ? 'Conexión simulada exitosa. Falta wire al endpoint real.'
        : 'Falta API Key — completá el campo y vuelve a probar.',
    };
  }

  // ============================================================
  //                  CONFIGURACIÓN DE PLATAFORMA
  // ============================================================
  //
  // Branding global de Fidelia (nombre/logo/color) editable desde
  // /superadmin/configuracion. Vive en la tabla Setting como key/value
  // bajo el prefijo `platform.`. El frontend lo expone vía un endpoint
  // público mínimo (solo lectura).

  private static readonly PLATFORM_KEYS = [
    'platform.name',
    'platform.tagline',
    'platform.logoUrl',
    'platform.primaryColor',
    'platform.consoleDomain',
    'platform.supportEmail',
  ];

  private static readonly PLATFORM_DEFAULTS: Record<string, string> = {
    'platform.name': 'Fidelia',
    'platform.tagline': 'Software de Fidelización',
    'platform.logoUrl': '',
    'platform.primaryColor': '#16a34a',
    'platform.consoleDomain': '',
    'platform.supportEmail': '',
  };

  async getPlatformConfig() {
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: SuperAdminService.PLATFORM_KEYS } },
    });
    const map = new Map(settings.map((s) => [s.key, s.value]));
    const out: Record<string, string> = {};
    for (const k of SuperAdminService.PLATFORM_KEYS) {
      const short = k.replace('platform.', '');
      out[short] = map.get(k) ?? SuperAdminService.PLATFORM_DEFAULTS[k] ?? '';
    }
    return out;
  }

  async updatePlatformConfig(
    body: Partial<Record<'name' | 'tagline' | 'logoUrl' | 'primaryColor' | 'consoleDomain' | 'supportEmail', string>>,
    actorId?: string,
  ) {
    const changed: string[] = [];
    for (const [short, val] of Object.entries(body)) {
      const key = `platform.${short}`;
      if (!SuperAdminService.PLATFORM_KEYS.includes(key)) continue;
      const value = (val ?? '').toString().trim();
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
      changed.push(short);
    }
    await this.logAction(actorId, 'superadmin.platform_config.update', 'platform_config', {
      changed,
    });
    return this.getPlatformConfig();
  }

  // ============================================================
  //                  PLATFORM_OWNERS + INVITACIONES
  // ============================================================

  async listPlatformOwners() {
    const owners = await this.prisma.user.findMany({
      where: { role: 'PLATFORM_OWNER' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return owners;
  }

  async listOwnerInvites() {
    const invites = await this.prisma.platformOwnerInvite.findMany({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { id: true, email: true, fullName: true } } },
    });
    return invites.map((i) => ({
      id: i.id,
      email: i.email,
      fullName: i.fullName,
      invitedBy: i.invitedBy ? { email: i.invitedBy.email, fullName: i.invitedBy.fullName } : null,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
    }));
  }

  async createOwnerInvite(
    dto: { email: string; fullName: string },
    actorId: string,
  ) {
    const email = dto.email.trim().toLowerCase();
    const fullName = dto.fullName.trim();
    if (!email || !fullName) throw new BadRequestException('Email y nombre son requeridos');

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.role === 'PLATFORM_OWNER') {
      throw new ConflictException('Ya existe un PLATFORM_OWNER con ese email');
    }

    const pending = await this.prisma.platformOwnerInvite.findFirst({
      where: { email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (pending) {
      throw new ConflictException('Ya hay una invitación pendiente para ese email');
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.platformOwnerInvite.create({
      data: { email, fullName, tokenHash, invitedById: actorId, expiresAt },
    });

    const cfg = await this.getPlatformConfig();
    const platformName = cfg.name || 'Fidelia';
    const consoleDomain = cfg.consoleDomain || '';
    const baseUrl = consoleDomain
      ? `https://${consoleDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
      : (process.env.PUBLIC_APP_URL || 'https://app.soyclubify.com');
    const acceptUrl = `${baseUrl}/aceptar-invitacion-plataforma/${token}`;

    await this.email.send({
      to: email,
      subject: `Te invitaron a administrar ${platformName}`,
      html: ownerInviteEmailHtml({ fullName, platformName, acceptUrl, expiresAt }),
      text: `Hola ${fullName}, te invitaron a administrar ${platformName}. Aceptá tu invitación acá: ${acceptUrl}. El enlace vence el ${expiresAt.toLocaleDateString('es-MX')}.`,
    });

    await this.logAction(actorId, 'superadmin.owner_invite.create', `invite:${invite.id}`, {
      email, fullName,
    });

    return { id: invite.id, email, fullName, expiresAt };
  }

  async revokeOwnerInvite(id: string, actorId: string) {
    const invite = await this.prisma.platformOwnerInvite.findUnique({ where: { id } });
    if (!invite) throw new NotFoundException('Invitación no encontrada');
    if (invite.acceptedAt) throw new BadRequestException('La invitación ya fue aceptada');
    if (invite.revokedAt) return { ok: true, alreadyRevoked: true };
    await this.prisma.platformOwnerInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.logAction(actorId, 'superadmin.owner_invite.revoke', `invite:${id}`, {
      email: invite.email,
    });
    return { ok: true };
  }

  async toggleOwnerActive(userId: string, isActive: boolean, actorId: string) {
    if (userId === actorId && !isActive) {
      throw new BadRequestException('No podés desactivarte a vos mismo');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, isActive: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.role !== 'PLATFORM_OWNER') {
      throw new BadRequestException('Solo se puede toggle PLATFORM_OWNERs');
    }
    if (user.isActive === isActive) return { ok: true, noop: true };

    if (!isActive) {
      // Defensa: nunca dejar la plataforma sin un único owner activo.
      const activeCount = await this.prisma.user.count({
        where: { role: 'PLATFORM_OWNER', isActive: true },
      });
      if (activeCount <= 1) {
        throw new BadRequestException('Tiene que quedar al menos un PLATFORM_OWNER activo');
      }
    }

    await this.prisma.user.update({ where: { id: userId }, data: { isActive } });
    await this.logAction(actorId, 'superadmin.owner.toggle', `user:${userId}`, {
      email: user.email,
      to: isActive ? 'active' : 'inactive',
    });
    return { ok: true };
  }

  // ============================================================
  //                  ACEPTACIÓN PÚBLICA DE INVITACIÓN
  // ============================================================

  async lookupOwnerInvite(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.platformOwnerInvite.findUnique({
      where: { tokenHash },
    });
    if (!invite) throw new NotFoundException('Invitación inválida o ya usada');
    if (invite.acceptedAt) throw new BadRequestException('Invitación ya aceptada');
    if (invite.revokedAt) throw new BadRequestException('Invitación revocada');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invitación vencida');
    return { email: invite.email, fullName: invite.fullName, expiresAt: invite.expiresAt };
  }

  async acceptOwnerInvite(token: string, password: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.platformOwnerInvite.findUnique({
      where: { tokenHash },
    });
    if (!invite) throw new NotFoundException('Invitación inválida');
    if (invite.acceptedAt) throw new BadRequestException('Invitación ya aceptada');
    if (invite.revokedAt) throw new BadRequestException('Invitación revocada');
    if (invite.expiresAt < new Date()) throw new BadRequestException('Invitación vencida');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: invite.email } });
      const u = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              role: 'PLATFORM_OWNER',
              tenantId: null,
              isActive: true,
              passwordHash,
              passwordChangedAt: new Date(),
              fullName: existing.fullName || invite.fullName,
            },
          })
        : await tx.user.create({
            data: {
              email: invite.email,
              fullName: invite.fullName,
              role: 'PLATFORM_OWNER',
              passwordHash,
              isActive: true,
            },
          });
      await tx.platformOwnerInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedById: u.id },
      });
      return u;
    });

    await this.logAction(invite.invitedById, 'superadmin.owner_invite.accept', `user:${user.id}`, {
      email: invite.email,
    });

    return { ok: true, email: user.email };
  }
}

function ownerInviteEmailHtml(opts: {
  fullName: string;
  platformName: string;
  acceptUrl: string;
  expiresAt: Date;
}) {
  const { fullName, platformName, acceptUrl, expiresAt } = opts;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f0fdf4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16241c">
  <div style="max-width:520px;margin:40px auto;background:white;border-radius:18px;overflow:hidden;border:1px solid #d1fae5">
    <div style="background:linear-gradient(135deg,#15803d,#10b981);padding:32px 28px;color:white">
      <div style="font-size:13px;font-weight:700;letter-spacing:1px;opacity:.9;text-transform:uppercase">${escapeHtml(platformName)}</div>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:800;letter-spacing:-.4px">Sos administrador de la plataforma</h1>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">Te invitaron a administrar <strong>${escapeHtml(platformName)}</strong>. Vas a tener acceso completo al Master Admin: marcas blancas, créditos, módulos y cobros.</p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55">Para activar tu cuenta, hacé clic acá y definí tu contraseña:</p>
      <p style="text-align:center;margin:24px 0 28px">
        <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:14px 26px;background:#15803d;color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Activar mi cuenta</a>
      </p>
      <p style="margin:0;font-size:12.5px;color:#6b7785">El enlace vence el ${expiresAt.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}. Si no esperabas esta invitación, ignorá este correo.</p>
    </div>
  </div>
</body></html>`;
}

function whiteLabelInviteEmailHtml(opts: {
  fullName: string;
  whiteLabelName: string;
  primaryColor: string;
  platformName: string;
  acceptUrl: string;
  expiresAt: Date;
}) {
  const { fullName, whiteLabelName, primaryColor, platformName, acceptUrl, expiresAt } = opts;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#16241c">
  <div style="max-width:520px;margin:40px auto;background:white;border-radius:18px;overflow:hidden;border:1px solid #e7e9ec">
    <div style="background:linear-gradient(135deg, ${escapeHtml(primaryColor)} 0%, ${escapeHtml(primaryColor)}cc 100%);padding:32px 28px;color:white">
      <div style="font-size:12.5px;font-weight:700;letter-spacing:1px;opacity:.9;text-transform:uppercase">${escapeHtml(whiteLabelName)}</div>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:800;letter-spacing:-.4px">Sos administrador de la marca</h1>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">Te invitaron a administrar <strong>${escapeHtml(whiteLabelName)}</strong>. Vas a tener acceso completo al panel: negocios, clientes, branding y todos los datos de la marca.</p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55">Para activar tu cuenta, hacé clic acá y definí tu contraseña:</p>
      <p style="text-align:center;margin:24px 0 28px">
        <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:14px 26px;background:${escapeHtml(primaryColor)};color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Activar mi cuenta</a>
      </p>
      <p style="margin:0;font-size:12.5px;color:#6b7785">El enlace vence el ${expiresAt.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}. Si no esperabas esta invitación, ignorá este correo.</p>
      <p style="margin:18px 0 0;font-size:11px;color:#9aa4af;text-align:center">Operado en ${escapeHtml(platformName)}.</p>
    </div>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as any)[c]);
}

/** Enmascara campos sensibles en config (apiKey, secret, token). */
function maskSensitiveConfig(config: any): any {
  if (!config || typeof config !== 'object') return config;
  const out: any = { ...config };
  for (const k of Object.keys(out)) {
    const lk = k.toLowerCase();
    if (
      typeof out[k] === 'string' &&
      out[k].length > 8 &&
      (lk.includes('key') || lk.includes('secret') || lk.includes('token') || lk.includes('password'))
    ) {
      out[k] = `${out[k].slice(0, 6)}${'•'.repeat(12)}${out[k].slice(-4)}`;
      out[`${k}_masked`] = true;
    }
  }
  return out;
}
