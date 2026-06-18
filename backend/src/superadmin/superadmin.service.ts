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
  creditsUnlimited?: boolean;
  logoUrl?: string;
  secondaryColor?: string;
  backgroundColor?: string;
  supportColor?: string;
  instagram?: string;
  contactEmail?: string;
};

export type HotmartLinkDto = {
  credits: number;
  label: string;
  url: string;
  price?: number | null;
  currency?: string;
  position?: number;
  isActive?: boolean;
  hotmartProductId?: string | null;
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
      throw new BadRequestException('La marca está suspendida. Reactívala antes de entrar.');
    }

    // ENTRAR a un white-label = sesión SUPER_ADMIN del panel /admin de esa
    // marca (que gestiona sus tenants), NO la cuenta de un negocio suelto.
    // Por eso la sesión emitida SIEMPRE tiene role=SUPER_ADMIN, independiente
    // de qué usuario usemos como identidad. (Fix 2026-06-15: antes, si la
    // marca no tenía un SUPER_ADMIN dedicado —caso Clubify, cuyo adminEmail
    // fue promovido a PLATFORM_OWNER— caía a un TENANT_OWNER al azar y el
    // guard de /admin lo rebotaba a /app, metiéndolo encima en un negocio
    // random.)

    // 0) Identidad preferida: SUPER_ADMIN dedicado de la marca
    //    (User.whiteLabelId directo, patrón canónico 2026-06-13).
    let identity = await this.prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN', isActive: true, whiteLabelId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true, fullName: true, tenantId: true },
    });

    // 1) SUPER_ADMIN ligado a un tenant de la marca (histórico).
    if (!identity) {
      identity = await this.prisma.user.findFirst({
        where: { role: 'SUPER_ADMIN', isActive: true, tenant: { whiteLabelId } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, fullName: true, tenantId: true },
      });
    }

    // 2) Sin SUPER_ADMIN dedicado: usamos como identidad al dueño de la marca
    //    (adminEmail, cualquier rol —incl. PLATFORM_OWNER—) o, si no existe,
    //    al propio operador del Master Admin. La sesión igual se emite con
    //    privilegios de SUPER_ADMIN de la marca.
    let synthesizedSuperAdmin = false;
    if (!identity && wl.adminEmail) {
      identity = await this.prisma.user.findFirst({
        where: { email: { equals: wl.adminEmail, mode: 'insensitive' }, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, fullName: true, tenantId: true },
      });
      if (identity) synthesizedSuperAdmin = true;
    }
    if (!identity) {
      identity = await this.prisma.user.findUnique({
        where: { id: platformOwnerId },
        select: { id: true, email: true, fullName: true, tenantId: true },
      });
      if (identity) synthesizedSuperAdmin = true;
    }

    if (!identity) {
      throw new BadRequestException(
        `No se pudo resolver una identidad para entrar a la marca ${wl.name}.`,
      );
    }

    // tenantId: para una sesión sintetizada de marca = null (admin global de
    // la marca, no atado a un negocio). Para un SUPER_ADMIN real, respetamos
    // el suyo.
    const sessionTenantId = synthesizedSuperAdmin ? null : identity.tenantId;

    const payload = {
      sub: identity.id,
      email: identity.email,
      role: 'SUPER_ADMIN' as const,
      tenantId: sessionTenantId,
      // Claim de contexto de marca (futuro scoping por white-label). Hoy
      // SUPER_ADMIN es global; el claim queda disponible sin romper nada.
      whiteLabelId: wl.id,
      impersonatedBy: platformOwnerId,
    };
    const accessToken = this.jwt.sign(payload);

    this.audit.log({
      actorId: platformOwnerId,
      tenantId: sessionTenantId ?? undefined,
      action: 'superadmin.impersonate_white_label',
      resource: `whiteLabel:${wl.id}`,
      metadata: {
        whiteLabelName: wl.name,
        userImpersonated: identity.id,
        synthesizedSuperAdmin,
      },
    });

    return {
      accessToken,
      user: {
        id: identity.id,
        email: identity.email,
        fullName: identity.fullName,
        role: 'SUPER_ADMIN' as const,
        tenantId: sessionTenantId,
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
      text: `Hola ${fullName}, te invitaron a administrar ${wl.name}. Acepta tu invitación aquí: ${acceptUrl}. El enlace vence el ${expiresAt.toLocaleDateString('es-MX')}.`,
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
      // Defensa: no convertir silenciosamente a un TENANT_OWNER/SUPER_ADMIN
      // de OTRO tenant en admin de marca — perdería acceso a su negocio.
      if (existing && existing.tenantId) {
        throw new ConflictException(
          'Este email ya está asociado a un negocio existente. Usa otro email para administrar la marca.',
        );
      }
      // Si ya es admin de OTRA marca, también bloqueamos.
      if (
        existing &&
        existing.role === 'SUPER_ADMIN' &&
        existing.whiteLabelId &&
        existing.whiteLabelId !== invite.whiteLabelId
      ) {
        throw new ConflictException(
          'Este email ya administra otra marca blanca. Usa un email distinto.',
        );
      }
      // Atomic accept: si dos POSTs llegan a la vez, sólo uno gana.
      const claim = await tx.whiteLabelAdminInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException('Invitación ya aceptada o revocada');
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
        data: { acceptedById: u.id },
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
          logoUrl: dto.logoUrl?.trim() || null,
          secondaryColor: dto.secondaryColor || null,
          backgroundColor: dto.backgroundColor || null,
          supportColor: dto.supportColor || null,
          instagram: dto.instagram?.trim() || null,
          contactEmail: dto.contactEmail?.trim().toLowerCase() || null,
          initial: (dto.initial || dto.name.trim()[0] || 'M').toUpperCase().slice(0, 1),
          adminEmail: dto.adminEmail?.trim().toLowerCase() || null,
          creditsUnlimited: dto.creditsUnlimited ?? false,
          modules: {
            create: [
              { module: 'REFERRALS', enabled: true },
              { module: 'ORDERS', enabled: true },
              { module: 'GROW_BUSINESS_SMS', enabled: true },
              { module: 'REVIEWS', enabled: true },
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
        logoUrl: patch.logoUrl === undefined ? undefined : patch.logoUrl?.trim() || null,
        secondaryColor: patch.secondaryColor === undefined ? undefined : patch.secondaryColor || null,
        backgroundColor: patch.backgroundColor === undefined ? undefined : patch.backgroundColor || null,
        supportColor: patch.supportColor === undefined ? undefined : patch.supportColor || null,
        instagram: patch.instagram === undefined ? undefined : patch.instagram?.trim() || null,
        contactEmail: patch.contactEmail === undefined ? undefined : patch.contactEmail?.trim().toLowerCase() || null,
        initial: patch.initial ? patch.initial.toUpperCase().slice(0, 1) : undefined,
        adminEmail: patch.adminEmail === undefined ? undefined : patch.adminEmail?.trim().toLowerCase() || null,
        creditsUnlimited: patch.creditsUnlimited === undefined ? undefined : patch.creditsUnlimited,
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
          creditsUnlimited: true,
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

    const committedRefreshedAt = await this.prisma.setting.findUnique({
      where: { key: 'platform.creditsCommittedRefreshedAt' },
    });

    return {
      summary: {
        available: agg._sum.creditsAvailable ?? 0,
        committed: agg._sum.creditsCommitted ?? 0,
        usedMonth: Math.abs(monthAgg._sum.amount ?? 0),
        usedYear: Math.abs(yearAgg._sum.amount ?? 0),
        pendingTenants,
        committedRefreshedAt: committedRefreshedAt?.value ?? null,
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

  // ============================================================
  //                  HOTMART CREDIT PURCHASES
  // ============================================================

  /** Lista las compras Hotmart UNASSIGNED para reasignación manual. */
  async listUnassignedCreditPurchases() {
    return this.prisma.hotmartCreditPurchase.findMany({
      where: { status: 'UNASSIGNED' },
      include: { creditLink: { select: { label: true, credits: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Lista todas las compras (assigned + unassigned) — paginado simple. */
  async listAllCreditPurchases(limit = 50) {
    return this.prisma.hotmartCreditPurchase.findMany({
      include: {
        creditLink: { select: { label: true, credits: true } },
        whiteLabel: { select: { name: true, slug: true, primaryColor: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, limit),
    });
  }

  /** Asigna una compra UNASSIGNED a una marca: acredita los créditos
   *  + crea CreditTransaction + marca la compra como ASSIGNED. */
  async assignCreditPurchase(purchaseId: string, whiteLabelId: string, actorId?: string) {
    const purchase = await this.prisma.hotmartCreditPurchase.findUnique({
      where: { id: purchaseId },
    });
    if (!purchase) throw new NotFoundException('Compra no encontrada');
    if (purchase.status === 'ASSIGNED') {
      throw new BadRequestException('Esta compra ya fue asignada');
    }
    const wl = await this.prisma.whiteLabel.findUnique({ where: { id: whiteLabelId } });
    if (!wl) throw new NotFoundException('Marca no encontrada');

    if (wl.status === 'SUSPENDED') {
      throw new BadRequestException('No se puede asignar créditos a una marca suspendida. Reactívala primero.');
    }

    // Atomic claim: solo un PLATFORM_OWNER puede asignar esta compra.
    // updateMany WHERE status != 'ASSIGNED' devuelve count=0 si otro ya
    // la asignó entre el findUnique y este update.
    const claim = await this.prisma.hotmartCreditPurchase.updateMany({
      where: { id: purchaseId, status: { not: 'ASSIGNED' } },
      data: { whiteLabelId, status: 'ASSIGNED', assignedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictException('Otra operación ya asignó esta compra');
    }
    // Marcas con créditos ilimitados: registramos la compra como ASSIGNED
    // (para auditoría) pero NO incrementamos creditsAvailable ni creamos
    // CreditTransaction. La marca sigue ilimitada.
    if (!wl.creditsUnlimited) {
      await this.prisma.$transaction([
        this.prisma.whiteLabel.update({
          where: { id: whiteLabelId },
          data: { creditsAvailable: { increment: purchase.credits } },
        }),
        this.prisma.creditTransaction.create({
          data: {
            whiteLabelId,
            type: 'PURCHASE',
            amount: purchase.credits,
            note: `Compra Hotmart reasignada · tx=${purchase.transactionId}`,
          },
        }),
      ]);
    }
    await this.logAction(actorId, 'superadmin.hotmart_purchase.assign', `hotmartPurchase:${purchaseId}`, {
      transactionId: purchase.transactionId,
      whiteLabelName: wl.name,
      credits: purchase.credits,
    });
    return { ok: true };
  }

  /** Resuelve un host (dominio propio) a la marca blanca dueña. Usado por el
   *  middleware Next para servir el panel /admin en app.<marca>.com. Compara
   *  contra appDomain/domain (normalizados, sin www). Pocas marcas → findMany
   *  + match en memoria es suficiente y robusto. */
  async resolveWhiteLabelByHost(host: string): Promise<{ slug: string | null }> {
    const norm = (s?: string | null) =>
      (s ?? '').trim().toLowerCase().replace(/^www\./, '');
    const h = norm(host);
    if (!h) return { slug: null };
    const wls = await this.prisma.whiteLabel.findMany({
      where: { status: 'ACTIVE' },
      select: { slug: true, domain: true, appDomain: true },
    });
    const match = wls.find(
      (w) => norm(w.appDomain) === h || norm(w.domain) === h,
    );
    return { slug: match?.slug ?? null };
  }

  /** Branding público de una marca blanca por slug (nombre + color), para que
   *  el panel /admin/<slug> se pinte con la identidad de la marca incluso en
   *  login directo (sin pila de impersonación). */
  async getWhiteLabelBrandingBySlug(slug: string) {
    const s = (slug ?? '').trim().toLowerCase();
    if (!s) return null;
    const wl = await this.prisma.whiteLabel.findFirst({
      where: { slug: s, status: 'ACTIVE' },
      select: {
        slug: true,
        name: true,
        primaryColor: true,
        logoUrl: true,
        secondaryColor: true,
        backgroundColor: true,
        supportColor: true,
        instagram: true,
        contactEmail: true,
        // Módulos habilitados → el panel gatea secciones (ej. Referidos) por
        // marca. Solo los enabled.
        modules: { where: { enabled: true }, select: { module: true } },
      },
    });
    if (!wl) return null;
    return {
      slug: wl.slug,
      name: wl.name,
      primaryColor: wl.primaryColor,
      logoUrl: wl.logoUrl,
      secondaryColor: wl.secondaryColor,
      backgroundColor: wl.backgroundColor,
      supportColor: wl.supportColor,
      instagram: wl.instagram,
      contactEmail: wl.contactEmail,
      modules: wl.modules.map((m) => m.module),
    };
  }

  async createHotmartLink(dto: HotmartLinkDto, actorId?: string) {
    if (!dto.credits || dto.credits < 1) throw new BadRequestException('credits >= 1');
    if (!dto.label?.trim()) throw new BadRequestException('label requerido');
    if (!dto.url?.trim()) throw new BadRequestException('url requerida');
    const created = await this.prisma.hotmartCreditLink.create({
      data: {
        credits: dto.credits,
        label: dto.label.trim(),
        url: dto.url.trim(),
        price: dto.price !== null && dto.price !== undefined ? new Prisma.Decimal(dto.price) : null,
        currency: dto.currency ?? 'USD',
        position: dto.position ?? 0,
        isActive: dto.isActive ?? true,
        hotmartProductId: dto.hotmartProductId?.trim() || null,
      },
    });
    await this.logAction(actorId, 'superadmin.hotmart_link.create', `hotmartLink:${created.id}`, {
      label: created.label,
      credits: created.credits,
    });
    return created;
  }

  async updateHotmartLink(id: string, patch: Partial<HotmartLinkDto>, actorId?: string) {
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
    if (patch.hotmartProductId !== undefined) {
      data.hotmartProductId = patch.hotmartProductId?.trim() || null;
    }
    const updated = await this.prisma.hotmartCreditLink.update({ where: { id }, data });
    await this.logAction(actorId, 'superadmin.hotmart_link.update', `hotmartLink:${id}`, {
      label: updated.label,
      changed: Object.keys(patch),
    });
    return updated;
  }

  async removeHotmartLink(id: string, actorId?: string) {
    const existing = await this.prisma.hotmartCreditLink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    await this.prisma.hotmartCreditLink.delete({ where: { id } });
    await this.logAction(actorId, 'superadmin.hotmart_link.delete', `hotmartLink:${id}`, {
      label: existing.label,
      credits: existing.credits,
    });
    return { ok: true };
  }

  // ============================================================
  //                           MÓDULOS
  // ============================================================

  /** Matriz para /superadmin/modulos: filas = marcas, columnas =
   *  los 3 módulos. Si la marca no tiene una fila de
   *  WhiteLabelModule para un módulo, asumimos enabled=false. */
  async modulesMatrix() {
    const ALL_MODULES: ModuleKey[] = ['REFERRALS', 'ORDERS', 'GROW_BUSINESS_SMS', 'REVIEWS'];
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

  async updateIntegration(
    key: string,
    patch: { config?: Record<string, any>; status?: string },
    actorId?: string,
  ) {
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
    // Audit log con las KEYS del patch (NO los valores — pueden ser
    // secrets) y el status final. Nunca persistir el apiKey en log.
    await this.logAction(actorId, 'superadmin.integration.update', `integration:${key}`, {
      integrationKey: key,
      configKeys: patch.config ? Object.keys(patch.config) : [],
      statusFrom: existing.status,
      statusTo: updated.status,
    });
    return { ...updated, config: maskSensitiveConfig(updated.config as any) };
  }

  /** "Probar conexión" — por ahora marca como CONNECTED si tiene apiKey
   *  configurada, sin pegarle al endpoint real. En PR posterior se
   *  puede conectar al servicio real. */
  async testIntegration(key: string, actorId?: string) {
    const existing = await this.prisma.platformIntegration.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException();
    const cfg = (existing.config as any) || {};
    const ok = !!cfg.apiKey;
    await this.prisma.platformIntegration.update({
      where: { key },
      data: { status: ok ? 'CONNECTED' : 'DISCONNECTED' },
    });
    await this.logAction(actorId, 'superadmin.integration.test', `integration:${key}`, {
      integrationKey: key,
      result: ok ? 'CONNECTED' : 'DISCONNECTED',
    });
    return {
      ok,
      message: ok
        ? 'Conexión simulada exitosa. Falta wire al endpoint real.'
        : 'Falta API Key — completa el campo e inténtalo de nuevo.',
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

  /**
   * Creación directa de un administrador de plataforma. A diferencia de la
   * invitación, el usuario queda creado y habilitado de inmediato con la
   * contraseña definida — sin email ni paso de activación.
   */
  async createPlatformOwner(
    dto: { firstName: string; lastName?: string; email: string; password: string },
    actorId: string,
  ) {
    const email = dto.email.trim().toLowerCase();
    const fullName = `${(dto.firstName || '').trim()} ${(dto.lastName || '').trim()}`.trim();
    if (!email || !fullName) {
      throw new BadRequestException('Nombre y correo son requeridos');
    }
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }

    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email,
        fullName,
        role: 'PLATFORM_OWNER',
        passwordHash,
        isActive: true,
        passwordChangedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    await this.logAction(actorId, 'superadmin.owner.create', `user:${user.id}`, {
      email,
      fullName,
    });

    return user;
  }

  /** Cambia la contraseña de un PLATFORM_OWNER de inmediato. */
  async changeOwnerPassword(userId: string, password: string, actorId: string) {
    if (!password || password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.role !== 'PLATFORM_OWNER') {
      throw new BadRequestException('Solo se puede cambiar la contraseña de PLATFORM_OWNERs');
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: userId },
      // passwordChangedAt invalida los tokens viejos del admin afectado.
      data: { passwordHash, passwordChangedAt: new Date() },
    });

    await this.logAction(actorId, 'superadmin.owner.password_change', `user:${userId}`, {
      email: user.email,
    });

    return { ok: true };
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
      text: `Hola ${fullName}, te invitaron a administrar ${platformName}. Acepta tu invitación aquí: ${acceptUrl}. El enlace vence el ${expiresAt.toLocaleDateString('es-MX')}.`,
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
      throw new BadRequestException('No puedes desactivarte a ti mismo');
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
      // Defensa: no degradar silenciosamente a un user con tenant — perdería
      // acceso a su negocio. PLATFORM_OWNER no tiene tenantId.
      if (existing && existing.tenantId) {
        throw new ConflictException(
          'Este email ya está asociado a un negocio. Usa otro email para administrar la plataforma.',
        );
      }
      // Atomic accept: si dos POSTs llegan a la vez, sólo uno gana.
      const claim = await tx.platformOwnerInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new ConflictException('Invitación ya aceptada o revocada');
      }
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
        data: { acceptedById: u.id },
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
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:800;letter-spacing:-.4px">Eres administrador de la plataforma</h1>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">Te invitaron a administrar <strong>${escapeHtml(platformName)}</strong>. Vas a tener acceso completo al Master Admin: marcas blancas, créditos, módulos y cobros.</p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55">Para activar tu cuenta, haz clic aquí y define tu contraseña:</p>
      <p style="text-align:center;margin:24px 0 28px">
        <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:14px 26px;background:#15803d;color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Activar mi cuenta</a>
      </p>
      <p style="margin:0;font-size:12.5px;color:#6b7785">El enlace vence el ${expiresAt.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}. Si no esperabas esta invitación, ignora este correo.</p>
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
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:800;letter-spacing:-.4px">Eres administrador de la marca</h1>
    </div>
    <div style="padding:28px">
      <p style="margin:0 0 14px;font-size:15px;line-height:1.55">Hola <strong>${escapeHtml(fullName)}</strong>,</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">Te invitaron a administrar <strong>${escapeHtml(whiteLabelName)}</strong>. Vas a tener acceso completo al panel: negocios, clientes, branding y todos los datos de la marca.</p>
      <p style="margin:0 0 22px;font-size:15px;line-height:1.55">Para activar tu cuenta, haz clic aquí y define tu contraseña:</p>
      <p style="text-align:center;margin:24px 0 28px">
        <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:14px 26px;background:${escapeHtml(primaryColor)};color:white;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Activar mi cuenta</a>
      </p>
      <p style="margin:0;font-size:12.5px;color:#6b7785">El enlace vence el ${expiresAt.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}. Si no esperabas esta invitación, ignora este correo.</p>
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
