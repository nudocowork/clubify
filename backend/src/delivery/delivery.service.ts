import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, DeliveryStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GrowBusinessService } from '../integrations/grow-business.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Red de Domicilios — Fase 1 (2026-06-29).
 *
 * Gestiona las EMPRESAS de domicilios (las crea el Master Admin) y el
 * SEGUIMIENTO logístico de cada pedido (`Delivery`, 1:1 con `Order`).
 *
 * El ciclo de cocina (recibido → preparando → listo) vive en `Order.status`;
 * acá viven los estados del repartidor (esperando → moto asignada → recogido →
 * en camino → entregado) sin tocar el flujo existente de pedidos.
 *
 * Fase 1: registro + asignación de empresas a marcas/negocios + creación del
 * seguimiento al marcar el pedido "listo" + aviso a la empresa. El portal de
 * la empresa (Fase 2), el widget del cliente + chat (Fase 3) y las comisiones
 * (Fase 4) llegan después. El campo `commissionPerDelivery` ya se guarda.
 */
@Injectable()
export class DeliveryService {
  private logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private growBusiness: GrowBusinessService,
  ) {}

  private async logAction(
    actorId: string | undefined,
    action: string,
    resource: string,
    metadata: any = {},
  ) {
    if (!actorId) return;
    try {
      await this.audit.log({ actorId, action, resource, metadata });
    } catch (e) {
      console.warn('audit log fail', (e as Error).message);
    }
  }

  // ───────────────────────── Master Admin: CRUD ─────────────────────────

  /** Lista empresas con conteos de marcas/negocios habilitados y domicilios. */
  async listCompanies() {
    const items = await this.prisma.deliveryCompany.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        whiteLabel: { select: { id: true, name: true } },
        _count: { select: { brands: true, tenants: true, deliveries: true } },
      },
    });
    return items.map((c) => this.serializeCompany(c));
  }

  /** Detalle de una empresa con sus marcas y negocios habilitados. */
  async getCompany(id: string) {
    const c = await this.prisma.deliveryCompany.findUnique({
      where: { id },
      include: {
        whiteLabel: { select: { id: true, name: true } },
        brands: { select: { whiteLabelId: true } },
        tenants: { select: { tenantId: true } },
        admins: {
          select: { id: true, email: true, fullName: true, isActive: true },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { deliveries: true } },
      },
    });
    if (!c) throw new NotFoundException('Empresa no encontrada');
    return {
      ...this.serializeCompany(c),
      brandIds: c.brands.map((b) => b.whiteLabelId),
      tenantIds: c.tenants.map((t) => t.tenantId),
      admins: c.admins,
    };
  }

  /** Datos para poblar los selectores del Master Admin (marcas + negocios). */
  async assignableData() {
    const [brands, tenants] = await Promise.all([
      this.prisma.whiteLabel.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.tenant.findMany({
        orderBy: { brandName: 'asc' },
        select: { id: true, brandName: true, slug: true, whiteLabelId: true },
      }),
    ]);
    return { brands, tenants };
  }

  async createCompany(dto: DeliveryCompanyInput, actorId?: string) {
    if (!dto.name?.trim()) throw new BadRequestException('Nombre requerido');
    const created = await this.prisma.deliveryCompany.create({
      data: {
        whiteLabelId: dto.whiteLabelId ?? null,
        name: dto.name.trim(),
        logoUrl: dto.logoUrl?.trim() || null,
        whatsapp: dto.whatsapp?.trim() || null,
        city: dto.city?.trim() || null,
        responsible: dto.responsible?.trim() || null,
        email: dto.email?.trim() || null,
        commissionPerDelivery:
          dto.commissionPerDelivery == null
            ? null
            : new Prisma.Decimal(dto.commissionPerDelivery),
        isActive: dto.isActive ?? true,
      },
    });
    if (dto.brandIds) await this.setBrands(created.id, dto.brandIds);
    if (dto.tenantIds) await this.setTenants(created.id, dto.tenantIds);
    await this.logAction(
      actorId,
      'delivery.company.create',
      `deliveryCompany:${created.id}`,
      { name: created.name },
    );
    return this.getCompany(created.id);
  }

  async updateCompany(
    id: string,
    dto: Partial<DeliveryCompanyInput>,
    actorId?: string,
  ) {
    const existing = await this.prisma.deliveryCompany.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Empresa no encontrada');
    await this.prisma.deliveryCompany.update({
      where: { id },
      data: {
        whiteLabelId:
          dto.whiteLabelId === undefined ? undefined : dto.whiteLabelId ?? null,
        name: dto.name === undefined ? undefined : dto.name.trim(),
        logoUrl: dto.logoUrl === undefined ? undefined : dto.logoUrl?.trim() || null,
        whatsapp:
          dto.whatsapp === undefined ? undefined : dto.whatsapp?.trim() || null,
        city: dto.city === undefined ? undefined : dto.city?.trim() || null,
        responsible:
          dto.responsible === undefined
            ? undefined
            : dto.responsible?.trim() || null,
        email: dto.email === undefined ? undefined : dto.email?.trim() || null,
        commissionPerDelivery:
          dto.commissionPerDelivery === undefined
            ? undefined
            : dto.commissionPerDelivery == null
              ? null
              : new Prisma.Decimal(dto.commissionPerDelivery),
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
      },
    });
    if (dto.brandIds !== undefined) await this.setBrands(id, dto.brandIds);
    if (dto.tenantIds !== undefined) await this.setTenants(id, dto.tenantIds);
    await this.logAction(
      actorId,
      'delivery.company.update',
      `deliveryCompany:${id}`,
      { changes: Object.keys(dto) },
    );
    return this.getCompany(id);
  }

  async deleteCompany(id: string, actorId?: string) {
    const existing = await this.prisma.deliveryCompany.findUnique({
      where: { id },
      select: { id: true, name: true, _count: { select: { deliveries: true } } },
    });
    if (!existing) throw new NotFoundException('Empresa no encontrada');
    // Si ya tiene domicilios históricos, desactivamos en vez de borrar para
    // no romper el historial (los Delivery quedan con deliveryCompanyId null).
    if (existing._count.deliveries > 0) {
      await this.prisma.deliveryCompany.update({
        where: { id },
        data: { isActive: false },
      });
      await this.logAction(
        actorId,
        'delivery.company.deactivate',
        `deliveryCompany:${id}`,
        { name: existing.name, reason: 'has_deliveries' },
      );
      return { ok: true, deactivated: true };
    }
    await this.prisma.deliveryCompany.delete({ where: { id } });
    await this.logAction(
      actorId,
      'delivery.company.delete',
      `deliveryCompany:${id}`,
      { name: existing.name },
    );
    return { ok: true, deactivated: false };
  }

  /** Reemplaza el set de marcas habilitadas de una empresa. */
  private async setBrands(companyId: string, whiteLabelIds: string[]) {
    const ids = Array.from(new Set(whiteLabelIds.filter(Boolean)));
    await this.prisma.$transaction([
      this.prisma.deliveryCompanyBrand.deleteMany({
        where: { deliveryCompanyId: companyId },
      }),
      ...(ids.length
        ? [
            this.prisma.deliveryCompanyBrand.createMany({
              data: ids.map((whiteLabelId) => ({
                deliveryCompanyId: companyId,
                whiteLabelId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  /** Reemplaza el set de negocios habilitados de una empresa. */
  private async setTenants(companyId: string, tenantIds: string[]) {
    const ids = Array.from(new Set(tenantIds.filter(Boolean)));
    await this.prisma.$transaction([
      this.prisma.deliveryCompanyTenant.deleteMany({
        where: { deliveryCompanyId: companyId },
      }),
      ...(ids.length
        ? [
            this.prisma.deliveryCompanyTenant.createMany({
              data: ids.map((tenantId) => ({
                deliveryCompanyId: companyId,
                tenantId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  private serializeCompany(c: any) {
    return {
      id: c.id,
      whiteLabelId: c.whiteLabelId,
      whiteLabelName: c.whiteLabel?.name ?? null,
      name: c.name,
      logoUrl: c.logoUrl,
      whatsapp: c.whatsapp,
      city: c.city,
      responsible: c.responsible,
      email: c.email,
      commissionPerDelivery:
        c.commissionPerDelivery == null ? null : Number(c.commissionPerDelivery),
      isActive: c.isActive,
      brandsCount: c._count?.brands ?? undefined,
      tenantsCount: c._count?.tenants ?? undefined,
      deliveriesCount: c._count?.deliveries ?? undefined,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  // ───────────────────── Ciclo de vida (desde Orders) ─────────────────────

  /**
   * Elige la empresa por defecto para un negocio: si tiene UNA sola empresa
   * activa habilitada, la asigna automáticamente. Si tiene varias o ninguna,
   * devuelve null (se asignará a mano más adelante / en el portal).
   */
  private async resolveDefaultCompany(tenantId: string): Promise<string | null> {
    const links = await this.prisma.deliveryCompanyTenant.findMany({
      where: { tenantId, deliveryCompany: { isActive: true } },
      select: { deliveryCompanyId: true },
      take: 2,
    });
    return links.length === 1 ? links[0].deliveryCompanyId : null;
  }

  /**
   * Crea (o devuelve) el seguimiento logístico de un pedido cuando pasa a
   * "listo". Idempotente por `orderId`. Best-effort: no propaga errores para
   * no romper la transición del pedido.
   */
  async ensureForOrder(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          tenantId: true,
          fulfillment: true,
          mode: true,
          deliveryAddress: true,
          deliveryAmount: true,
          delivery: { select: { id: true } },
        },
      });
      if (!order) return;
      // Solo aplica a pedidos de domicilio.
      const isDelivery =
        order.fulfillment === 'DELIVERY' || order.mode === 'DELIVERY';
      if (!isDelivery) return;
      if (order.delivery) return; // ya existe

      const companyId = await this.resolveDefaultCompany(order.tenantId);
      const created = await this.prisma.delivery.create({
        data: {
          orderId: order.id,
          tenantId: order.tenantId,
          deliveryCompanyId: companyId,
          status: 'WAITING_COURIER',
          address: addressToText(order.deliveryAddress),
          deliveryValue:
            order.deliveryAmount == null
              ? null
              : new Prisma.Decimal(order.deliveryAmount),
        },
      });
      if (companyId) {
        await this.notifyCompanyNewDelivery(companyId, order.id).catch(() => null);
      }
      this.logger.log(
        `Delivery creado order=${order.id} company=${companyId ?? 'sin-asignar'} id=${created.id}`,
      );
    } catch (e) {
      this.logger.warn(
        `ensureForOrder order=${orderId} falló: ${(e as Error).message}`,
      );
    }
  }

  /** Marca el seguimiento como entregado cuando el pedido se entrega. */
  async markDelivered(orderId: string): Promise<void> {
    try {
      await this.prisma.delivery.updateMany({
        where: { orderId, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(
        `markDelivered order=${orderId} falló: ${(e as Error).message}`,
      );
    }
  }

  /** Cancela el seguimiento cuando el pedido se cancela. */
  async markCancelled(orderId: string): Promise<void> {
    try {
      await this.prisma.delivery.updateMany({
        where: { orderId, status: { notIn: ['DELIVERED', 'CANCELLED'] } },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    } catch (e) {
      this.logger.warn(
        `markCancelled order=${orderId} falló: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Avisa a la empresa de domicilios (por su WhatsApp; fallback SMS) que tiene
   * un pedido listo para recoger. Usa la subcuenta global de Grow Business.
   * Best-effort.
   */
  private async notifyCompanyNewDelivery(
    companyId: string,
    orderId: string,
  ): Promise<void> {
    const company = await this.prisma.deliveryCompany.findUnique({
      where: { id: companyId },
      select: { whatsapp: true, name: true },
    });
    if (!company?.whatsapp) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        code: true,
        deliveryAddress: true,
        tenant: { select: { brandName: true } },
        customer: { select: { fullName: true, phone: true } },
      },
    });
    if (!order) return;
    const account = await this.resolveGrowAccount();
    if (!account) return;

    const addr = addressToText(order.deliveryAddress) ?? '—';
    const body =
      `📦 Nuevo domicilio para recoger\n\n` +
      `Negocio: ${order.tenant?.brandName ?? '—'}\n` +
      `Pedido: #${order.code}\n` +
      `Cliente: ${order.customer?.fullName ?? '—'} (${order.customer?.phone ?? '—'})\n` +
      `Dirección: ${addr}`;

    const wa = await this.growBusiness
      .sendWhatsAppWithCreds(
        { locationId: account.locationId, apiKey: account.apiKey },
        company.whatsapp,
        body,
      )
      .catch((e) => ({ ok: false as const, message: (e as Error).message }));
    if (wa.ok) return;
    await this.growBusiness
      .sendSmsWithCreds(
        {
          locationId: account.locationId,
          apiKey: account.apiKey,
          switchNumber: account.switchNumber,
        },
        company.whatsapp,
        body,
      )
      .catch(() => null);
  }

  /** Resuelve la subcuenta global de Grow Business (igual que prereg alerts). */
  private async resolveGrowAccount(): Promise<{
    locationId: string;
    apiKey: string;
    switchNumber: number | null;
  } | null> {
    const general = await this.prisma.growBusinessAccount.findFirst({
      where: { purpose: 'GENERAL', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { locationId: true, apiKey: true, switchNumber: true },
    });
    if (general) return general;
    return this.prisma.growBusinessAccount.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { locationId: true, apiKey: true, switchNumber: true },
    });
  }

  // ──────────── Master Admin: cuentas de login de la empresa (Fase 2) ────────────

  /** Crea una cuenta de login (role=DELIVERY_COMPANY) para una empresa. */
  async createCompanyAdmin(
    companyId: string,
    dto: { email: string; fullName: string; password: string },
    actorId?: string,
  ) {
    const company = await this.prisma.deliveryCompany.findUnique({
      where: { id: companyId },
      select: { id: true, name: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const email = dto.email?.trim().toLowerCase();
    const fullName = dto.fullName?.trim();
    if (!email || !fullName) {
      throw new BadRequestException('Email y nombre son requeridos');
    }
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Ya existe una cuenta con ese email.');
    }
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email,
        fullName,
        role: 'DELIVERY_COMPANY',
        deliveryCompanyId: companyId,
        passwordHash,
        isActive: true,
        passwordChangedAt: new Date(),
      },
      select: { id: true, email: true, fullName: true, isActive: true },
    });
    await this.logAction(
      actorId,
      'delivery.company_admin.create',
      `deliveryCompany:${companyId}`,
      { email, fullName },
    );
    return user;
  }

  /** Cambia la contraseña de una cuenta de la empresa. */
  async setCompanyAdminPassword(
    companyId: string,
    userId: string,
    password: string,
    actorId?: string,
  ) {
    if (!password || password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deliveryCompanyId: companyId, role: 'DELIVERY_COMPANY' },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Cuenta no encontrada');
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    await this.logAction(
      actorId,
      'delivery.company_admin.password',
      `deliveryCompany:${companyId}`,
      { userId },
    );
    return { ok: true };
  }

  /** Activa/desactiva una cuenta de la empresa. */
  async toggleCompanyAdmin(
    companyId: string,
    userId: string,
    isActive: boolean,
    actorId?: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deliveryCompanyId: companyId, role: 'DELIVERY_COMPANY' },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Cuenta no encontrada');
    await this.prisma.user.update({ where: { id: userId }, data: { isActive } });
    await this.logAction(
      actorId,
      'delivery.company_admin.toggle',
      `deliveryCompany:${companyId}`,
      { userId, isActive },
    );
    return { ok: true };
  }

  // ─────────────────────── Portal de la empresa (Fase 2) ───────────────────────

  private assertCompanyUser(user: AuthUser): string {
    if (user.role !== 'DELIVERY_COMPANY' || !user.deliveryCompanyId) {
      throw new BadRequestException('Sesión sin empresa de domicilios.');
    }
    return user.deliveryCompanyId;
  }

  /** Contexto del portal: datos de la empresa para el encabezado. */
  async getPortalContext(user: AuthUser) {
    const companyId = this.assertCompanyUser(user);
    const company = await this.prisma.deliveryCompany.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        city: true,
        whatsapp: true,
        isActive: true,
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  /** IDs de negocios habilitados para la empresa (para reclamar domicilios). */
  private async enabledTenantIds(companyId: string): Promise<string[]> {
    const links = await this.prisma.deliveryCompanyTenant.findMany({
      where: { deliveryCompanyId: companyId },
      select: { tenantId: true },
    });
    return links.map((l) => l.tenantId);
  }

  /**
   * Lista los domicilios del portal: los de la empresa (cualquier estado) +
   * los SIN asignar (reclamables) de los negocios habilitados que estén
   * esperando repartidor.
   */
  async listPortalDeliveries(user: AuthUser, statusFilter?: string) {
    const companyId = this.assertCompanyUser(user);
    const enabled = await this.enabledTenantIds(companyId);

    const mine = await this.prisma.delivery.findMany({
      where: {
        deliveryCompanyId: companyId,
        ...(statusFilter ? { status: statusFilter as DeliveryStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { order: { select: ORDER_SELECT } },
    });

    // Reclamables: sin empresa, esperando repartidor, de un negocio habilitado.
    const claimable = enabled.length
      ? await this.prisma.delivery.findMany({
          where: {
            deliveryCompanyId: null,
            status: 'WAITING_COURIER',
            tenantId: { in: enabled },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
          include: { order: { select: ORDER_SELECT } },
        })
      : [];

    return {
      mine: mine.map((d) => serializeDelivery(d, false)),
      claimable: claimable.map((d) => serializeDelivery(d, true)),
    };
  }

  /** Reclama un domicilio sin asignar de un negocio habilitado. */
  async claimDelivery(user: AuthUser, deliveryId: string) {
    const companyId = this.assertCompanyUser(user);
    const enabled = await this.enabledTenantIds(companyId);
    const d = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, deliveryCompanyId: true, tenantId: true },
    });
    if (!d) throw new NotFoundException('Domicilio no encontrado');
    if (d.deliveryCompanyId) {
      throw new BadRequestException('Este domicilio ya tiene empresa asignada.');
    }
    if (!enabled.includes(d.tenantId)) {
      throw new BadRequestException('Tu empresa no está habilitada para este negocio.');
    }
    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { deliveryCompanyId: companyId },
    });
    return { ok: true };
  }

  /** Edita los datos del repartidor / dirección / precio de un domicilio propio. */
  async updatePortalDelivery(
    user: AuthUser,
    deliveryId: string,
    dto: {
      courierName?: string;
      courierPhone?: string;
      courierPlate?: string;
      address?: string;
      deliveryValue?: number | null;
      etaMinutes?: number | null;
    },
  ) {
    const companyId = this.assertCompanyUser(user);
    const d = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deliveryCompanyId: companyId },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Domicilio no encontrado');
    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        courierName:
          dto.courierName === undefined ? undefined : dto.courierName.trim() || null,
        courierPhone:
          dto.courierPhone === undefined ? undefined : dto.courierPhone.trim() || null,
        courierPlate:
          dto.courierPlate === undefined ? undefined : dto.courierPlate.trim() || null,
        address: dto.address === undefined ? undefined : dto.address.trim() || null,
        deliveryValue:
          dto.deliveryValue === undefined
            ? undefined
            : dto.deliveryValue == null
              ? null
              : new Prisma.Decimal(dto.deliveryValue),
        etaMinutes:
          dto.etaMinutes === undefined ? undefined : dto.etaMinutes ?? null,
      },
    });
    return this.getPortalDelivery(user, deliveryId);
  }

  /** Avanza el estado logístico respetando la máquina de estados. */
  async transitionPortalStatus(
    user: AuthUser,
    deliveryId: string,
    next: DeliveryStatus,
  ) {
    const companyId = this.assertCompanyUser(user);
    const d = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deliveryCompanyId: companyId },
      select: { id: true, status: true, courierName: true },
    });
    if (!d) throw new NotFoundException('Domicilio no encontrado');

    const TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
      WAITING_COURIER: ['COURIER_ASSIGNED', 'CANCELLED'],
      COURIER_ASSIGNED: ['PICKED_UP', 'CANCELLED'],
      PICKED_UP: ['ON_THE_WAY', 'CANCELLED'],
      ON_THE_WAY: ['DELIVERED', 'CANCELLED'],
      DELIVERED: [],
      CANCELLED: [],
    };
    if (!TRANSITIONS[d.status].includes(next)) {
      throw new BadRequestException(`Transición inválida: ${d.status} → ${next}`);
    }
    if (next === 'COURIER_ASSIGNED' && !d.courierName) {
      throw new BadRequestException(
        'Asigna primero el nombre del repartidor antes de marcar "Moto asignada".',
      );
    }

    const stamp: Record<string, Date> = {};
    if (next === 'COURIER_ASSIGNED') stamp.assignedAt = new Date();
    if (next === 'PICKED_UP') stamp.pickedUpAt = new Date();
    if (next === 'ON_THE_WAY') stamp.onTheWayAt = new Date();
    if (next === 'DELIVERED') stamp.deliveredAt = new Date();
    if (next === 'CANCELLED') stamp.cancelledAt = new Date();

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { status: next, ...stamp },
    });
    return this.getPortalDelivery(user, deliveryId);
  }

  // ───────────────────── Público: seguimiento del cliente (Fase 3A) ─────────────────────

  /**
   * "Mis pedidos" por teléfono en el storefront de un negocio (sin login).
   * Scopeado al tenant (slug) para evitar enumeración cross-tenant. Devuelve
   * los pedidos recientes de ese teléfono con su estado + seguimiento.
   */
  async listPublicByPhone(slug: string, phoneRaw: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status === 'SUSPENDED') return { orders: [] };
    const digits = (phoneRaw || '').replace(/\D/g, '');
    const last = digits.slice(-10);
    if (last.length < 7) return { orders: [] };

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId: tenant.id,
        customer: { phone: { contains: last } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        code: true,
        status: true,
        fulfillment: true,
        mode: true,
        total: true,
        createdAt: true,
        delivery: {
          select: { status: true, etaMinutes: true, courierName: true },
        },
      },
    });
    return {
      orders: orders.map((o) => ({
        code: o.code,
        orderStatus: o.status,
        isDelivery: o.fulfillment === 'DELIVERY' || o.mode === 'DELIVERY',
        total: o.total == null ? null : Number(o.total),
        createdAt: o.createdAt,
        delivery: o.delivery
          ? {
              status: o.delivery.status,
              etaMinutes: o.delivery.etaMinutes,
              courierName: o.delivery.courierName,
            }
          : null,
      })),
    };
  }

  /** Devuelve un domicilio propio serializado. */
  async getPortalDelivery(user: AuthUser, deliveryId: string) {
    const companyId = this.assertCompanyUser(user);
    const d = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deliveryCompanyId: companyId },
      include: { order: { select: ORDER_SELECT } },
    });
    if (!d) throw new NotFoundException('Domicilio no encontrado');
    return serializeDelivery(d, false);
  }

  // ─────────────────── Chat del domicilio (Fase 3B, 3 vías) ───────────────────

  private async chatList(orderId: string) {
    const msgs = await this.prisma.deliveryMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      take: 300,
    });
    return msgs.map((m) => ({
      id: m.id,
      senderRole: m.senderRole,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt,
    }));
  }

  private cleanBody(body: string): string {
    const text = (body || '').trim().slice(0, 1000);
    if (!text) throw new BadRequestException('Mensaje vacío.');
    return text;
  }

  // --- Cliente (público, por código de pedido) ---
  async customerChatList(code: string) {
    const o = await this.prisma.order.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!o) throw new NotFoundException('Pedido no encontrado');
    return this.chatList(o.id);
  }

  async customerChatPost(code: string, body: string) {
    const text = this.cleanBody(body);
    const o = await this.prisma.order.findUnique({
      where: { code },
      select: { id: true, customer: { select: { fullName: true } } },
    });
    if (!o) throw new NotFoundException('Pedido no encontrado');
    await this.prisma.deliveryMessage.create({
      data: {
        orderId: o.id,
        senderRole: 'CUSTOMER',
        senderName: o.customer?.fullName ?? 'Cliente',
        body: text,
      },
    });
    return this.chatList(o.id);
  }

  // --- Negocio (usuario del tenant) ---
  private async assertBusinessOrder(user: AuthUser, orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, tenantId: true, tenant: { select: { brandName: true } } },
    });
    if (!o) throw new NotFoundException('Pedido no encontrado');
    if (user.role !== 'SUPER_ADMIN' && o.tenantId !== user.tenantId) {
      throw new BadRequestException('Pedido de otro negocio.');
    }
    return o;
  }

  async businessChatList(user: AuthUser, orderId: string) {
    const o = await this.assertBusinessOrder(user, orderId);
    return this.chatList(o.id);
  }

  async businessChatPost(user: AuthUser, orderId: string, body: string) {
    const text = this.cleanBody(body);
    const o = await this.assertBusinessOrder(user, orderId);
    await this.prisma.deliveryMessage.create({
      data: {
        orderId: o.id,
        senderRole: 'BUSINESS',
        senderName: o.tenant?.brandName ?? 'Negocio',
        body: text,
      },
    });
    return this.chatList(o.id);
  }

  // --- Empresa de domicilios (portal) ---
  private async assertCompanyDelivery(user: AuthUser, deliveryId: string) {
    const companyId = this.assertCompanyUser(user);
    const d = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deliveryCompanyId: companyId },
      select: {
        id: true,
        orderId: true,
        deliveryCompany: { select: { name: true } },
      },
    });
    if (!d) throw new NotFoundException('Domicilio no encontrado');
    return d;
  }

  async companyChatList(user: AuthUser, deliveryId: string) {
    const d = await this.assertCompanyDelivery(user, deliveryId);
    return this.chatList(d.orderId);
  }

  async companyChatPost(user: AuthUser, deliveryId: string, body: string) {
    const text = this.cleanBody(body);
    const d = await this.assertCompanyDelivery(user, deliveryId);
    await this.prisma.deliveryMessage.create({
      data: {
        orderId: d.orderId,
        senderRole: 'COMPANY',
        senderName: d.deliveryCompany?.name ?? 'Domicilios',
        body: text,
      },
    });
    return this.chatList(d.orderId);
  }
}

const ORDER_SELECT = {
  code: true,
  total: true,
  deliveryAmount: true,
  deliveryAddress: true,
  createdAt: true,
  status: true,
  customer: { select: { fullName: true, phone: true } },
  tenant: { select: { brandName: true, slug: true } },
} as const;

function serializeDelivery(d: any, claimable: boolean) {
  return {
    id: d.id,
    status: d.status,
    courierName: d.courierName,
    courierPhone: d.courierPhone,
    courierPlate: d.courierPlate,
    etaMinutes: d.etaMinutes,
    address: d.address ?? addressToText(d.order?.deliveryAddress),
    deliveryValue: d.deliveryValue == null ? null : Number(d.deliveryValue),
    assignedAt: d.assignedAt,
    pickedUpAt: d.pickedUpAt,
    onTheWayAt: d.onTheWayAt,
    deliveredAt: d.deliveredAt,
    cancelledAt: d.cancelledAt,
    createdAt: d.createdAt,
    claimable,
    order: d.order
      ? {
          code: d.order.code,
          total: d.order.total == null ? null : Number(d.order.total),
          status: d.order.status,
          createdAt: d.order.createdAt,
          customerName: d.order.customer?.fullName ?? null,
          customerPhone: d.order.customer?.phone ?? null,
          businessName: d.order.tenant?.brandName ?? null,
          businessSlug: d.order.tenant?.slug ?? null,
        }
      : null,
  };
}

export interface DeliveryCompanyInput {
  whiteLabelId?: string | null;
  name: string;
  logoUrl?: string;
  whatsapp?: string;
  city?: string;
  responsible?: string;
  email?: string;
  commissionPerDelivery?: number | null;
  isActive?: boolean;
  brandIds?: string[];
  tenantIds?: string[];
}

/** Normaliza el JSON de dirección del pedido a texto plano legible. */
function addressToText(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  if (typeof raw === 'object') {
    const parts = [
      raw.direccion || raw.address || raw.street,
      raw.municipio || raw.city,
      raw.departamento || raw.state,
    ].filter((x) => typeof x === 'string' && x.trim());
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}
