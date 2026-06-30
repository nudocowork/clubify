import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GrowBusinessService } from '../integrations/grow-business.service';

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
        _count: { select: { deliveries: true } },
      },
    });
    if (!c) throw new NotFoundException('Empresa no encontrada');
    return {
      ...this.serializeCompany(c),
      brandIds: c.brands.map((b) => b.whiteLabelId),
      tenantIds: c.tenants.map((t) => t.tenantId),
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
