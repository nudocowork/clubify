import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

const SETTING_TEMPLATE_KEY = 'admin.supplierMessageTemplate';

const DEFAULT_TEMPLATE = `*Pedido {dispatchDay} / {brandName}*

Hola {supplierName}

Estamos requiriendo los siguientes productos:

*{dispatchDay}:*
{productList}

-----
📍 {brandName}
{address}`;

export type FrequentProductDto = {
  name: string;
  defaultQty: number;
  defaultUnit: string;
  dispatchDay?: string | null;
  supplierId?: string | null;
  notes?: string | null;
};

export type PurchaseOrderItemDto = {
  productName: string;
  qty: number;
  unit: string;
  supplierId?: string | null;
  dispatchDay?: string | null;
  notes?: string | null;
};

@Injectable()
export class PurchaseOrdersService {
  constructor(private prisma: PrismaService) {}

  // ─────────── Frequent products ───────────
  listFrequentProducts(tenantId: string) {
    return this.prisma.frequentProduct.findMany({
      where: { tenantId },
      include: { supplier: { select: { id: true, name: true, phone: true } } },
      orderBy: { name: 'asc' },
    });
  }

  createFrequentProduct(tenantId: string, dto: FrequentProductDto) {
    return this.prisma.frequentProduct.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        defaultQty: dto.defaultQty,
        defaultUnit: dto.defaultUnit,
        dispatchDay: dto.dispatchDay || null,
        supplierId: dto.supplierId || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async updateFrequentProduct(
    tenantId: string,
    id: string,
    dto: Partial<FrequentProductDto>,
  ) {
    const fp = await this.prisma.frequentProduct.findFirst({
      where: { id, tenantId },
    });
    if (!fp) throw new NotFoundException();
    return this.prisma.frequentProduct.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? fp.name,
        defaultQty: dto.defaultQty ?? fp.defaultQty,
        defaultUnit: dto.defaultUnit ?? fp.defaultUnit,
        dispatchDay: dto.dispatchDay !== undefined ? dto.dispatchDay : fp.dispatchDay,
        supplierId: dto.supplierId !== undefined ? dto.supplierId : fp.supplierId,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : fp.notes,
      },
    });
  }

  async removeFrequentProduct(tenantId: string, id: string) {
    const fp = await this.prisma.frequentProduct.findFirst({
      where: { id, tenantId },
    });
    if (!fp) throw new NotFoundException();
    await this.prisma.frequentProduct.delete({ where: { id } });
    return { ok: true };
  }

  // ─────────── Purchase orders (historial) ───────────
  listOrders(tenantId: string) {
    return this.prisma.purchaseOrder.findMany({
      where: { tenantId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createOrder(
    tenantId: string,
    createdById: string | null,
    items: PurchaseOrderItemDto[],
  ) {
    if (!items.length) {
      throw new NotFoundException('Sin items');
    }
    // Snapshot supplier name+phone para que sobreviva eliminación
    const supplierIds = Array.from(
      new Set(items.map((i) => i.supplierId).filter(Boolean) as string[]),
    );
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds }, tenantId },
          select: { id: true, name: true, phone: true },
        })
      : [];
    const sMap = new Map(suppliers.map((s) => [s.id, s]));

    return this.prisma.purchaseOrder.create({
      data: {
        tenantId,
        createdById,
        items: {
          create: items.map((i) => ({
            productName: i.productName.trim(),
            qty: i.qty,
            unit: i.unit,
            supplierId: i.supplierId || null,
            supplierName: i.supplierId ? sMap.get(i.supplierId)?.name ?? null : null,
            supplierPhone: i.supplierId ? sMap.get(i.supplierId)?.phone ?? null : null,
            dispatchDay: i.dispatchDay || null,
            notes: i.notes?.trim() || null,
          })),
        },
      },
      include: { items: true },
    });
  }

  // ─────────── Stats / KPIs ───────────
  async stats(tenantId: string) {
    const [frequentCount, suppliersCount, ordersCount, dispatchDays] =
      await Promise.all([
        this.prisma.frequentProduct.count({ where: { tenantId } }),
        this.prisma.supplier.count({ where: { tenantId, isActive: true } }),
        this.prisma.purchaseOrder.count({ where: { tenantId } }),
        this.prisma.frequentProduct.findMany({
          where: { tenantId, dispatchDay: { not: null } },
          select: { dispatchDay: true },
          distinct: ['dispatchDay'],
        }),
      ]);

    // Top proveedores por count de items pedidos (proxy de "gasto" hasta
    // que se conecte el módulo Compras con precios).
    const topRaw = await this.prisma.purchaseOrderItem.groupBy({
      by: ['supplierId', 'supplierName'],
      where: {
        order: { tenantId },
        supplierId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    });
    const top = topRaw.map((t) => ({
      supplierId: t.supplierId,
      supplierName: t.supplierName ?? '—',
      count: t._count._all,
    }));

    return {
      frequentCount,
      suppliersCount,
      ordersCount,
      dispatchDaysCount: dispatchDays.length,
      topSuppliers: top,
    };
  }

  // ─────────── Template ───────────
  async getTemplate() {
    const s = await this.prisma.setting.findUnique({
      where: { key: SETTING_TEMPLATE_KEY },
    });
    return { template: s?.value ?? DEFAULT_TEMPLATE, default: DEFAULT_TEMPLATE };
  }

  async setTemplate(value: string) {
    await this.prisma.setting.upsert({
      where: { key: SETTING_TEMPLATE_KEY },
      update: { value },
      create: { key: SETTING_TEMPLATE_KEY, value },
    });
    return { ok: true, template: value };
  }
}
