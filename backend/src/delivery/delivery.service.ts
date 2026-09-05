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
import { CustomerOrderSmsService } from '../integrations/customer-order-sms.service';
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
    private customerOrderSms: CustomerOrderSmsService,
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
        brandSharePct: clampPct(dto.brandSharePct),
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
        brandSharePct:
          dto.brandSharePct === undefined ? undefined : clampPct(dto.brandSharePct),
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
      brandSharePct: c.brandSharePct ?? 0,
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

      // Negocio SIN empresa de domicilios vinculada → NO creamos seguimiento:
      // no hay a quién avisar ni con quién chatear. Antes se creaba el Delivery
      // con companyId=null, lo que encendía el "Chat del domicilio" fantasma en
      // negocios que ni siquiera tienen el sistema de domicilios (PDF454). Con
      // ≥1 empresa vinculada sí lo creamos (resolveDefaultCompany asigna la
      // única, o deja null para asignación manual en el portal).
      const activeCompanies = await this.prisma.deliveryCompanyTenant.count({
        where: { tenantId: order.tenantId, deliveryCompany: { isActive: true } },
      });
      if (activeCompanies === 0) return;

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
      // (El aviso a la empresa se hace por separado: "nuevo pedido" al crearse
      // y "listo para recoger" al pasar a READY — ver onDeliveryOrderCreated /
      // notifyCompanyReadyForPickup.)
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
      const d = await this.prisma.delivery.findUnique({
        where: { orderId },
        select: { id: true, status: true },
      });
      if (d && d.status === 'DELIVERED') {
        await this.ensureCommissionForDelivery(d.id).catch(() => null);
      }
    } catch (e) {
      this.logger.warn(
        `markDelivered order=${orderId} falló: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Genera la comisión de plataforma de un domicilio ENTREGADO (Fase 4).
   * Idempotente (DeliveryCommission.deliveryId @unique). Monto FIJO por empresa
   * (commissionPerDelivery), repartido marca/master según brandSharePct.
   * Best-effort: no propaga errores para no romper la transición.
   */
  async ensureCommissionForDelivery(deliveryId: string): Promise<void> {
    try {
      const existing = await this.prisma.deliveryCommission.findUnique({
        where: { deliveryId },
        select: { id: true },
      });
      if (existing) return;
      const d = await this.prisma.delivery.findUnique({
        where: { id: deliveryId },
        select: {
          id: true,
          orderId: true,
          status: true,
          deliveryCompanyId: true,
          deliveryCompany: {
            select: { commissionPerDelivery: true, brandSharePct: true },
          },
          order: { select: { tenant: { select: { whiteLabelId: true } } } },
        },
      });
      if (!d || d.status !== 'DELIVERED' || !d.deliveryCompanyId) return;
      const fee = d.deliveryCompany?.commissionPerDelivery
        ? Number(d.deliveryCompany.commissionPerDelivery)
        : 0;
      if (!(fee > 0)) return; // empresa sin comisión configurada → no genera
      const pct = clampPct(d.deliveryCompany?.brandSharePct ?? 0);
      const brand = Math.round(fee * pct) / 100;
      const master = Math.round((fee - brand) * 100) / 100;
      await this.prisma.deliveryCommission.create({
        data: {
          deliveryId: d.id,
          orderId: d.orderId,
          deliveryCompanyId: d.deliveryCompanyId,
          whiteLabelId: d.order?.tenant?.whiteLabelId ?? null,
          amount: new Prisma.Decimal(fee),
          brandAmount: new Prisma.Decimal(brand),
          masterAmount: new Prisma.Decimal(master),
        },
      });
      this.logger.log(
        `DeliveryCommission generada delivery=${d.id} fee=${fee} brand=${brand} master=${master}`,
      );
    } catch (e) {
      // P2002 (carrera, ya existe) u otros → ignorar.
      this.logger.warn(
        `ensureCommissionForDelivery delivery=${deliveryId} falló: ${(e as Error).message}`,
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

  /**
   * PDF245 P2 — al CREARSE un pedido a domicilio: crea el seguimiento (para que
   * aparezca en el panel de la empresa) y avisa a las empresas habilitadas
   * "Hay un nuevo pedido - #X. Revisa el panel.". Best-effort.
   */
  async onDeliveryOrderCreated(orderId: string): Promise<void> {
    try {
      await this.ensureForOrder(orderId);
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          code: true,
          fulfillment: true,
          mode: true,
          tenantId: true,
          tenant: { select: { brandName: true } },
        },
      });
      if (!order) return;
      const isDelivery =
        order.fulfillment === 'DELIVERY' || order.mode === 'DELIVERY';
      if (!isDelivery) return;

      const links = await this.prisma.deliveryCompanyTenant.findMany({
        where: { tenantId: order.tenantId, deliveryCompany: { isActive: true } },
        select: { deliveryCompany: { select: { whatsapp: true } } },
      });
      const phones = links
        .map((l) => l.deliveryCompany?.whatsapp)
        .filter((p): p is string => !!p && p.trim().length >= 6);
      if (phones.length === 0) return;

      const account = await this.resolveGrowAccount();
      if (!account) return;
      const body =
        `🛵 Hay un nuevo pedido - #${order.code}\n` +
        `Negocio: ${order.tenant?.brandName ?? '—'}\n` +
        `Revisa el panel.`;
      for (const phone of phones) {
        const wa = await this.growBusiness
          .sendWhatsAppWithCreds(
            { locationId: account.locationId, apiKey: account.apiKey },
            phone,
            body,
          )
          .catch(() => ({ ok: false as const }));
        if (!wa.ok) {
          await this.growBusiness
            .sendSmsWithCreds(
              {
                locationId: account.locationId,
                apiKey: account.apiKey,
                switchNumber: account.switchNumber,
              },
              phone,
              body,
            )
            .catch(() => null);
        }
      }
    } catch (e) {
      this.logger.warn(
        `onDeliveryOrderCreated order=${orderId} falló: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Aviso "listo para recoger" a la empresa asignada (o la default si aún no se
   * reclamó). Se llama cuando el pedido pasa a READY. Best-effort.
   */
  async notifyCompanyReadyForPickup(orderId: string): Promise<void> {
    try {
      const d = await this.prisma.delivery.findUnique({
        where: { orderId },
        select: { deliveryCompanyId: true, tenantId: true },
      });
      if (!d) return;
      const companyId =
        d.deliveryCompanyId ?? (await this.resolveDefaultCompany(d.tenantId));
      if (companyId) await this.notifyCompanyNewDelivery(companyId, orderId);
    } catch (e) {
      this.logger.warn(
        `notifyCompanyReadyForPickup order=${orderId} falló: ${(e as Error).message}`,
      );
    }
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

  // ─────────────── Master Admin: comisiones / reportes (Fase 4) ───────────────

  async commissionsSummary() {
    const [totAgg, pendAgg, paidAgg, splitAgg] = await Promise.all([
      this.prisma.deliveryCommission.aggregate({ _sum: { amount: true }, _count: true }),
      this.prisma.deliveryCommission.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
      }),
      this.prisma.deliveryCommission.aggregate({
        where: { status: 'PAID' },
        _sum: { amount: true },
      }),
      this.prisma.deliveryCommission.aggregate({
        _sum: { masterAmount: true, brandAmount: true },
      }),
    ]);
    const byCompanyRaw = await this.prisma.deliveryCommission.groupBy({
      by: ['deliveryCompanyId'],
      _sum: { amount: true, masterAmount: true, brandAmount: true },
      _count: true,
    });
    const ids = byCompanyRaw
      .map((r) => r.deliveryCompanyId)
      .filter((x): x is string => !!x);
    const companies = ids.length
      ? await this.prisma.deliveryCompany.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = Object.fromEntries(companies.map((c) => [c.id, c.name]));
    const byCompany = byCompanyRaw
      .map((r) => ({
        companyId: r.deliveryCompanyId,
        name: r.deliveryCompanyId
          ? (nameById[r.deliveryCompanyId] ?? '—')
          : 'Sin empresa',
        count: r._count,
        amount: Number(r._sum.amount ?? 0),
        master: Number(r._sum.masterAmount ?? 0),
        brand: Number(r._sum.brandAmount ?? 0),
      }))
      .sort((a, b) => b.amount - a.amount);
    return {
      totalAmount: Number(totAgg._sum.amount ?? 0),
      count: totAgg._count,
      pending: Number(pendAgg._sum.amount ?? 0),
      paid: Number(paidAgg._sum.amount ?? 0),
      masterTotal: Number(splitAgg._sum.masterAmount ?? 0),
      brandTotal: Number(splitAgg._sum.brandAmount ?? 0),
      byCompany,
    };
  }

  async listCommissions(opts: { status?: string; companyId?: string } = {}) {
    const where: any = {};
    if (opts.status === 'PENDING' || opts.status === 'PAID') where.status = opts.status;
    if (opts.companyId) where.deliveryCompanyId = opts.companyId;
    const rows = await this.prisma.deliveryCommission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        deliveryCompany: { select: { name: true } },
        delivery: {
          select: {
            order: {
              select: { code: true, tenant: { select: { brandName: true } } },
            },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      brandAmount: Number(r.brandAmount),
      masterAmount: Number(r.masterAmount),
      status: r.status,
      createdAt: r.createdAt,
      paidAt: r.paidAt,
      companyName: r.deliveryCompany?.name ?? '—',
      orderCode: r.delivery?.order?.code ?? null,
      businessName: r.delivery?.order?.tenant?.brandName ?? null,
    }));
  }

  async markCommissionPaid(id: string, paid: boolean, actorId?: string) {
    const c = await this.prisma.deliveryCommission.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!c) throw new NotFoundException('Comisión no encontrada');
    await this.prisma.deliveryCommission.update({
      where: { id },
      data: { status: paid ? 'PAID' : 'PENDING', paidAt: paid ? new Date() : null },
    });
    await this.logAction(actorId, 'delivery.commission.paid', `deliveryCommission:${id}`, {
      paid,
    });
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

  /** Resumen para el encabezado del portal (Fase 4). */
  async getPortalStats(user: AuthUser) {
    const companyId = this.assertCompanyUser(user);
    const [active, delivered, agg, pendingAgg] = await Promise.all([
      this.prisma.delivery.count({
        where: {
          deliveryCompanyId: companyId,
          status: { notIn: ['DELIVERED', 'CANCELLED'] },
        },
      }),
      this.prisma.delivery.count({
        where: { deliveryCompanyId: companyId, status: 'DELIVERED' },
      }),
      this.prisma.deliveryCommission.aggregate({
        where: { deliveryCompanyId: companyId },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.deliveryCommission.aggregate({
        where: { deliveryCompanyId: companyId, status: 'PENDING' },
        _sum: { amount: true },
      }),
    ]);
    return {
      activeCount: active,
      deliveredCount: delivered,
      commissionTotal: Number(agg._sum.amount ?? 0),
      commissionPending: Number(pendingAgg._sum.amount ?? 0),
      commissionCount: agg._count,
    };
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
      include: { order: { select: ORDER_SELECT }, vehicle: true },
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
          include: { order: { select: ORDER_SELECT }, vehicle: true },
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

  /**
   * Edita un domicilio propio: elige la MOTO de la flota (PDF245 P1) + ETA +
   * dirección. Al elegir moto, se copia el conductor/placa como snapshot en
   * courier*; la empresa solo escribe el "Tiempo estimado de entrega". El monto
   * del domicilio ya NO se pide acá (se acuerda con la empresa por fuera).
   */
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
      vehicleId?: string | null;
    },
  ) {
    const companyId = this.assertCompanyUser(user);
    const d = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, deliveryCompanyId: companyId },
      select: { id: true },
    });
    if (!d) throw new NotFoundException('Domicilio no encontrado');

    const data: Prisma.DeliveryUpdateInput = {};
    if (dto.vehicleId !== undefined) {
      if (dto.vehicleId) {
        const v = await this.prisma.deliveryVehicle.findFirst({
          where: { id: dto.vehicleId, deliveryCompanyId: companyId },
          select: { plate: true, driverName: true, driverPhone: true },
        });
        if (!v) throw new BadRequestException('Moto no encontrada en tu flota.');
        data.vehicle = { connect: { id: dto.vehicleId } };
        data.courierName = v.driverName;
        data.courierPhone = v.driverPhone ?? null;
        data.courierPlate = v.plate;
      } else {
        data.vehicle = { disconnect: true };
      }
    }
    // Campos sueltos (edición manual / compat) solo si NO se eligió una moto.
    if (data.vehicle === undefined) {
      if (dto.courierName !== undefined)
        data.courierName = dto.courierName.trim() || null;
      if (dto.courierPhone !== undefined)
        data.courierPhone = dto.courierPhone.trim() || null;
      if (dto.courierPlate !== undefined)
        data.courierPlate = dto.courierPlate.trim() || null;
    }
    if (dto.address !== undefined) data.address = dto.address.trim() || null;
    if (dto.etaMinutes !== undefined) data.etaMinutes = dto.etaMinutes ?? null;
    // deliveryValue ya no se pide al asignar; se acepta solo si llega explícito.
    if (dto.deliveryValue !== undefined) {
      data.deliveryValue =
        dto.deliveryValue == null ? null : new Prisma.Decimal(dto.deliveryValue);
    }

    await this.prisma.delivery.update({ where: { id: deliveryId }, data });
    return this.getPortalDelivery(user, deliveryId);
  }

  // ─────────────────── Flota de motos de la empresa (PDF245 P1) ───────────────────

  async listVehicles(user: AuthUser) {
    const companyId = this.assertCompanyUser(user);
    const vehicles = await this.prisma.deliveryVehicle.findMany({
      where: { deliveryCompanyId: companyId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
    return vehicles.map(serializeVehicle);
  }

  async createVehicle(
    user: AuthUser,
    dto: { plate: string; driverName: string; driverPhone?: string },
  ) {
    const companyId = this.assertCompanyUser(user);
    const plate = (dto.plate ?? '').trim();
    const driverName = (dto.driverName ?? '').trim();
    if (!plate) throw new BadRequestException('La placa es obligatoria.');
    if (!driverName) throw new BadRequestException('El nombre del conductor es obligatorio.');
    const v = await this.prisma.deliveryVehicle.create({
      data: {
        deliveryCompanyId: companyId,
        plate,
        driverName,
        driverPhone: dto.driverPhone?.trim() || null,
      },
    });
    return serializeVehicle(v);
  }

  async updateVehicle(
    user: AuthUser,
    vehicleId: string,
    dto: {
      plate?: string;
      driverName?: string;
      driverPhone?: string;
      isActive?: boolean;
    },
  ) {
    const companyId = this.assertCompanyUser(user);
    const owned = await this.prisma.deliveryVehicle.findFirst({
      where: { id: vehicleId, deliveryCompanyId: companyId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Moto no encontrada.');
    const v = await this.prisma.deliveryVehicle.update({
      where: { id: vehicleId },
      data: {
        plate: dto.plate === undefined ? undefined : dto.plate.trim(),
        driverName:
          dto.driverName === undefined ? undefined : dto.driverName.trim(),
        driverPhone:
          dto.driverPhone === undefined ? undefined : dto.driverPhone.trim() || null,
        isActive: dto.isActive === undefined ? undefined : dto.isActive,
      },
    });
    return serializeVehicle(v);
  }

  async removeVehicle(user: AuthUser, vehicleId: string) {
    const companyId = this.assertCompanyUser(user);
    const owned = await this.prisma.deliveryVehicle.findFirst({
      where: { id: vehicleId, deliveryCompanyId: companyId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Moto no encontrada.');
    // Borrado real. Los domicilios que la referencian conservan el snapshot
    // (courierName/courierPlate); el FK vehicleId queda en null (onDelete SetNull).
    await this.prisma.deliveryVehicle.delete({ where: { id: vehicleId } });
    return { ok: true };
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
      select: {
        id: true,
        status: true,
        courierName: true,
        etaMinutes: true,
        order: { select: { id: true, tenantId: true } },
      },
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
        'Asigna primero una moto de tu flota antes de marcar "Moto asignada".',
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
    if (next === 'DELIVERED') {
      await this.ensureCommissionForDelivery(deliveryId).catch(() => null);
    }
    // PDF 1256 F3: SMS al CLIENTE "tu pedido va en camino" (opt-in por negocio).
    // El servicio filtra por config + evento; best-effort.
    if (next === 'ON_THE_WAY' && d.order?.tenantId && d.order?.id) {
      this.customerOrderSms
        .notify(d.order.tenantId, d.order.id, 'on_the_way', {
          etaMinutes: d.etaMinutes,
        })
        .catch(() => null);
    }
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
    // Hace falta el numero COMPLETO, no un trozo.
    //
    // Con 7 digitos cualquiera listaba los pedidos de otra persona —y desde
    // ahi los productos, las notas y la direccion de envio—: bastaba conocer
    // parte del numero. Se piden al menos 8 digitos y se busca por la COLA
    // del numero, no por cualquier trozo: «3150621» ya no devuelve nada, y
    // «0621706» tampoco, porque no es el final de «+57 3150621706».
    //
    // 8 y no 10 porque no todos los paises tienen movil de 10 digitos y
    // dejar sin sus pedidos a un cliente legitimo seria peor.
    const digits = (phoneRaw || '').replace(/\D/g, '');
    if (digits.length < 8) return { orders: [] };
    const last = digits.length > 10 ? digits.slice(-10) : digits;

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId: tenant.id,
        customer: { phone: { endsWith: last } },
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
      include: { order: { select: ORDER_SELECT }, vehicle: true },
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

  // ───────── Chat DIRECTO negocio↔empresa por NEGOCIO (PDF 1254) ─────────
  // A diferencia del chat de arriba (por pedido), este es una conversación
  // continua entre un negocio y su empresa de domicilios, independiente de
  // cualquier pedido puntual.

  private async companyMsgThread(deliveryCompanyId: string, tenantId: string) {
    const msgs = await this.prisma.deliveryCompanyMessage.findMany({
      where: { deliveryCompanyId, tenantId },
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

  private async assertCompanyTenantLink(
    deliveryCompanyId: string,
    tenantId: string,
  ) {
    const link = await this.prisma.deliveryCompanyTenant.findUnique({
      where: { deliveryCompanyId_tenantId: { deliveryCompanyId, tenantId } },
      select: { id: true },
    });
    if (!link)
      throw new BadRequestException(
        'El negocio no está vinculado a esta empresa de domicilios.',
      );
  }

  /** Último mensaje por (company, tenant) para pintar la lista de chats. */
  private async lastCompanyMsg(deliveryCompanyId: string, tenantId: string) {
    return this.prisma.deliveryCompanyMessage.findFirst({
      where: { deliveryCompanyId, tenantId },
      orderBy: { createdAt: 'desc' },
      select: { body: true, createdAt: true, senderRole: true },
    });
  }

  // --- Lado EMPRESA (portal /domicilios): lista de chats, uno por negocio ---
  async companyBusinessChats(user: AuthUser) {
    const companyId = this.assertCompanyUser(user);
    const links = await this.prisma.deliveryCompanyTenant.findMany({
      where: { deliveryCompanyId: companyId },
      select: { tenant: { select: { id: true, brandName: true, slug: true } } },
    });
    const rows = await Promise.all(
      links.map(async (l) => {
        const last = await this.lastCompanyMsg(companyId, l.tenant.id);
        return {
          tenantId: l.tenant.id,
          brandName: l.tenant.brandName,
          slug: l.tenant.slug,
          lastMessage: last?.body ?? null,
          lastAt: last?.createdAt ?? null,
          lastSenderRole: last?.senderRole ?? null,
        };
      }),
    );
    rows.sort(
      (a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0),
    );
    return rows;
  }

  async companyBusinessChatList(user: AuthUser, tenantId: string) {
    const companyId = this.assertCompanyUser(user);
    await this.assertCompanyTenantLink(companyId, tenantId);
    return this.companyMsgThread(companyId, tenantId);
  }

  async companyBusinessChatPost(
    user: AuthUser,
    tenantId: string,
    body: string,
  ) {
    const companyId = this.assertCompanyUser(user);
    await this.assertCompanyTenantLink(companyId, tenantId);
    const text = this.cleanBody(body);
    const company = await this.prisma.deliveryCompany.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    await this.prisma.deliveryCompanyMessage.create({
      data: {
        deliveryCompanyId: companyId,
        tenantId,
        senderRole: 'COMPANY',
        senderName: company?.name ?? 'Domicilios',
        body: text,
      },
    });
    return this.companyMsgThread(companyId, tenantId);
  }

  // --- Lado NEGOCIO (/app): empresa(s) asignada(s) + chat directo ---
  private tenantIdOf(user: AuthUser): string {
    if (!user.tenantId) throw new BadRequestException('Sin negocio en sesión.');
    return user.tenantId;
  }

  async businessDeliveryCompanies(user: AuthUser) {
    const tenantId = this.tenantIdOf(user);
    const links = await this.prisma.deliveryCompanyTenant.findMany({
      where: { tenantId },
      select: { deliveryCompany: { select: { id: true, name: true } } },
    });
    const rows = await Promise.all(
      links.map(async (l) => {
        const last = await this.lastCompanyMsg(l.deliveryCompany.id, tenantId);
        return {
          companyId: l.deliveryCompany.id,
          name: l.deliveryCompany.name,
          lastMessage: last?.body ?? null,
          lastAt: last?.createdAt ?? null,
          lastSenderRole: last?.senderRole ?? null,
        };
      }),
    );
    rows.sort(
      (a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0),
    );
    return rows;
  }

  async businessCompanyChatList(user: AuthUser, companyId: string) {
    const tenantId = this.tenantIdOf(user);
    await this.assertCompanyTenantLink(companyId, tenantId);
    return this.companyMsgThread(companyId, tenantId);
  }

  async businessCompanyChatPost(
    user: AuthUser,
    companyId: string,
    body: string,
  ) {
    const tenantId = this.tenantIdOf(user);
    await this.assertCompanyTenantLink(companyId, tenantId);
    const text = this.cleanBody(body);
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { brandName: true },
    });
    await this.prisma.deliveryCompanyMessage.create({
      data: {
        deliveryCompanyId: companyId,
        tenantId,
        senderRole: 'BUSINESS',
        senderName: t?.brandName ?? 'Negocio',
        body: text,
      },
    });
    return this.companyMsgThread(companyId, tenantId);
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
    vehicleId: d.vehicleId ?? null,
    vehicle: d.vehicle
      ? {
          id: d.vehicle.id,
          plate: d.vehicle.plate,
          driverName: d.vehicle.driverName,
          driverPhone: d.vehicle.driverPhone ?? null,
          isActive: d.vehicle.isActive,
        }
      : null,
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

function serializeVehicle(v: any) {
  return {
    id: v.id,
    plate: v.plate,
    driverName: v.driverName,
    driverPhone: v.driverPhone ?? null,
    isActive: v.isActive,
    createdAt: v.createdAt,
  };
}

function clampPct(v: number | undefined | null): number {
  const n = Math.round(Number(v ?? 0));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export interface DeliveryCompanyInput {
  whiteLabelId?: string | null;
  name: string;
  logoUrl?: string;
  whatsapp?: string;
  city?: string;
  responsible?: string;
  brandSharePct?: number;
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
