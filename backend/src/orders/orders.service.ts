import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Fulfillment,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { customAlphabet } from 'nanoid';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ChannelsService } from '../channels/channels.service';
import { PromotionsService } from '../promotions/promotions.service';
import { AutomationsService } from '../automations/automations.service';
import { OrdersGateway } from './orders.gateway';
import { EmailService } from '../email/email.service';
import {
  orderConfirmedTemplate,
  orderCreatedTemplate,
  orderReadyTemplate,
} from '../email/templates/templates';

const codeGen = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 4);

export type OrderItem = {
  productId: string;
  variantId?: string | null;
  extras: { id: string; name: string; price: number }[];
  qty: number;
  name: string;
  unitPrice: number;
  lineTotal: number;
  note?: string;
};

export type CreateOrderDto = {
  tenantSlug: string;
  customer: { fullName: string; phone: string; email?: string };
  items: { productId: string; variantId?: string; extraIds?: string[]; qty: number; note?: string }[];
  fulfillment: Fulfillment;
  tableNumber?: string;
  deliveryAddress?: any;
  customerNote?: string;
  locationId?: string;
};

@Injectable()
export class OrdersService {
  private logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private channels: ChannelsService,
    private promotions: PromotionsService,
    private automations: AutomationsService,
    private gateway: OrdersGateway,
    private email: EmailService,
  ) {}

  private async broadcast(orderId: string) {
    const o = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
      },
    });
    if (o) this.gateway.broadcastOrderUpsert(o.tenantId, o);
  }

  // ============= público (cliente final) =============

  async createPublic(dto: CreateOrderDto) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      include: { cards: { where: { isActive: true, autoStampOnOrder: true }, take: 1 } },
    });
    if (!tenant || tenant.status === 'SUSPENDED')
      throw new NotFoundException('Negocio no disponible');

    if (!dto.items?.length) throw new BadRequestException('Carrito vacío');

    // Resolver productos y precios actuales (anti-tampering)
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { tenantId: tenant.id, id: { in: productIds }, isAvailable: true },
      include: { variants: true, extras: true },
    });
    const map = new Map(products.map((p) => [p.id, p]));

    const items: OrderItem[] = [];
    let subtotal = 0;
    for (const i of dto.items) {
      const p = map.get(i.productId);
      if (!p) throw new BadRequestException(`Producto ${i.productId} no disponible`);
      let unit = Number(p.basePrice);
      let variantName = '';
      if (i.variantId) {
        const v = p.variants.find((x) => x.id === i.variantId);
        if (!v) throw new BadRequestException('Variante inválida');
        unit += Number(v.priceDelta);
        variantName = ` (${v.name})`;
      }
      const extras = (i.extraIds ?? []).map((eid) => {
        const e = p.extras.find((x) => x.id === eid);
        if (!e) throw new BadRequestException('Extra inválido');
        unit += Number(e.price);
        return { id: e.id, name: e.name, price: Number(e.price) };
      });
      const qty = Math.max(1, Math.min(50, i.qty));
      const lineTotal = unit * qty;
      subtotal += lineTotal;
      items.push({
        productId: p.id,
        variantId: i.variantId ?? null,
        extras,
        qty,
        name: p.name + variantName,
        unitPrice: unit,
        lineTotal,
        note: i.note,
      });
    }

    // Aplicar promos automáticas
    const { discount, applied } = await this.promotions.computeForCart(
      tenant.id,
      subtotal,
      items,
    );
    const total = Math.max(0, subtotal - discount);

    // Customer match-or-create por phone
    const phone = dto.customer.phone.trim();
    let customer = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId: tenant.id, phone } },
    }).catch(() => null);
    if (!customer) {
      customer = await this.prisma.customer.create({
        data: {
          tenantId: tenant.id,
          fullName: dto.customer.fullName,
          phone,
          email: dto.customer.email,
        },
      });
    } else if (customer.fullName !== dto.customer.fullName) {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: { fullName: dto.customer.fullName },
      });
    }

    // Generar código único
    let code = codeGen();
    while (await this.prisma.order.findUnique({ where: { code } })) {
      code = codeGen();
    }

    const order = await this.prisma.order.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        code,
        items: items as any,
        subtotal,
        discount,
        total,
        appliedPromos: applied as any,
        fulfillment: dto.fulfillment,
        tableNumber: dto.tableNumber,
        deliveryAddress: dto.deliveryAddress,
        customerNote: dto.customerNote,
        locationId: dto.locationId,
        events: {
          create: { type: 'CREATED', metadata: { source: 'public' } },
        },
      },
    });

    // Generar wa.me link al dueño
    const link = this.channels.generateWaMeOwner(tenant, order, customer);
    await this.prisma.order.update({
      where: { id: order.id },
      data: { whatsappLink: link },
    });

    // Emit event para automations
    this.automations.emit('ORDER_CREATED', {
      tenantId: tenant.id,
      orderId: order.id,
      customerId: customer.id,
      total,
    }).catch(() => null);

    await this.prisma.event.create({
      data: {
        tenantId: tenant.id,
        customerId: customer.id,
        type: 'order.created',
        payload: { orderId: order.id, total, channel: 'WHATSAPP_LINK' },
      },
    });

    this.broadcast(order.id).catch(() => null);

    // Email transaccional al cliente (best-effort)
    if (customer.email) {
      const trackingUrl = `${process.env.APP_URL ?? 'http://localhost:4848'}/o/${order.code}`;
      const tpl = orderCreatedTemplate({
        tenant: {
          brandName: tenant.brandName,
          logoUrl: tenant.logoUrl,
          primaryColor: tenant.primaryColor,
          whatsappPhone: tenant.whatsappPhone,
          slug: tenant.slug,
        },
        customerName: customer.fullName,
        code: order.code,
        total,
        items: items.map((i) => ({
          name: i.name,
          qty: i.qty,
          lineTotal: i.lineTotal,
        })),
        trackingUrl,
      });
      this.email
        .send({
          to: customer.email,
          subject: tpl.subject,
          html: tpl.html,
          text: tpl.text,
        })
        .catch(() => null);
    }

    return {
      ...order,
      whatsappLink: link,
    };
  }

  async getPublicByCode(code: string) {
    const o = await this.prisma.order.findUnique({
      where: { code },
      include: {
        tenant: {
          select: { brandName: true, primaryColor: true, logoUrl: true, slug: true },
        },
        customer: { select: { fullName: true, phone: true } },
      },
    });
    if (!o) throw new NotFoundException();
    return o;
  }

  // ============= privado (panel tenant) =============

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  list(user: AuthUser, override?: string, status?: OrderStatus) {
    const tid = this.tid(user, override);
    return this.prisma.order.findMany({
      where: { tenantId: tid, ...(status ? { status } : {}) },
      include: {
        customer: { select: { fullName: true, phone: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async board(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const all = await this.prisma.order.findMany({
      where: {
        tenantId: tid,
        OR: [
          { createdAt: { gte: since } },
          { status: { in: ['PENDING', 'CONFIRMED', 'READY'] } },
        ],
      },
      include: {
        customer: { select: { fullName: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const byStatus: Record<OrderStatus, typeof all> = {
      PENDING: [],
      CONFIRMED: [],
      READY: [],
      DELIVERED: [],
      CANCELLED: [],
    };
    for (const o of all) byStatus[o.status].push(o);
    return byStatus;
  }

  async get(user: AuthUser, id: string) {
    const o = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        events: { orderBy: { createdAt: 'desc' } },
        location: true,
      },
    });
    if (!o) throw new NotFoundException();
    if (user.role !== 'SUPER_ADMIN' && o.tenantId !== user.tenantId) {
      throw new ForbiddenException();
    }
    return o;
  }

  async setStatus(user: AuthUser, id: string, next: OrderStatus) {
    const o = await this.get(user, id);
    if (o.status === next) return o;

    const stamp: Record<string, Date | null> = {};
    if (next === 'CONFIRMED') stamp.confirmedAt = new Date();
    if (next === 'READY') stamp.readyAt = new Date();
    if (next === 'DELIVERED') stamp.deliveredAt = new Date();
    if (next === 'CANCELLED') stamp.cancelledAt = new Date();

    const updated = await this.prisma.order.update({
      where: { id },
      data: { status: next, ...stamp },
    });

    await this.prisma.orderEvent.create({
      data: {
        orderId: id,
        type: next === 'CANCELLED' ? 'CANCELLED' : 'STATUS_CHANGED',
        metadata: { from: o.status, to: next },
        actorId: user.id,
      },
    });

    // Si se confirma, intentar auto-sello + automation
    if (next === 'CONFIRMED') {
      await this.autoStampOnConfirm(o.tenantId, o.customerId, o.id).catch(() => null);
      this.automations.emit('ORDER_CONFIRMED', {
        tenantId: o.tenantId,
        orderId: id,
        customerId: o.customerId,
        total: Number(o.total),
      }).catch(() => null);
    }
    if (next === 'DELIVERED') {
      this.automations.emit('ORDER_DELIVERED', {
        tenantId: o.tenantId,
        orderId: id,
        customerId: o.customerId,
      }).catch(() => null);
    }

    await this.prisma.event.create({
      data: {
        tenantId: o.tenantId,
        customerId: o.customerId,
        type: `order.${next.toLowerCase()}`,
        payload: { orderId: id },
      },
    });

    this.broadcast(id).catch(() => null);

    // Emails transaccionales para cambios clave
    if (next === 'CONFIRMED' || next === 'READY') {
      this.sendStatusEmail(o.tenantId, o.customerId, o.code, next).catch(
        () => null,
      );
    }

    return updated;
  }

  private async sendStatusEmail(
    tenantId: string,
    customerId: string,
    code: string,
    next: 'CONFIRMED' | 'READY',
  ) {
    const [tenant, customer] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId } }),
      this.prisma.customer.findUnique({ where: { id: customerId } }),
    ]);
    if (!tenant || !customer?.email) return;
    const trackingUrl = `${process.env.APP_URL ?? 'http://localhost:4848'}/o/${code}`;
    const tplArgs = {
      tenant: {
        brandName: tenant.brandName,
        logoUrl: tenant.logoUrl,
        primaryColor: tenant.primaryColor,
        whatsappPhone: tenant.whatsappPhone,
        slug: tenant.slug,
      },
      customerName: customer.fullName,
      code,
      trackingUrl,
    };
    const tpl =
      next === 'CONFIRMED'
        ? orderConfirmedTemplate(tplArgs)
        : orderReadyTemplate(tplArgs);
    await this.email.send({
      to: customer.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
  }

  /** Suma sello al cliente automáticamente si tiene una tarjeta del tenant. */
  private async autoStampOnConfirm(tenantId: string, customerId: string, orderId: string) {
    const card = await this.prisma.card.findFirst({
      where: { tenantId, isActive: true, autoStampOnOrder: true, type: 'STAMPS' },
    });
    if (!card) return;

    let pass = await this.prisma.pass.findUnique({
      where: { cardId_customerId: { cardId: card.id, customerId } },
    });
    if (!pass) {
      // Auto-emitir
      const { sign } = await import('jsonwebtoken');
      const { nanoid } = await import('nanoid');
      const serial = `CLB-${nanoid(10).toUpperCase()}`;
      const authToken = nanoid(32);
      const tmp = await this.prisma.pass.create({
        data: {
          tenantId,
          cardId: card.id,
          customerId,
          serialNumber: serial,
          qrToken: 'placeholder',
          authToken,
        },
      });
      const qrToken = sign(
        { pid: tmp.id, tid: tenantId },
        process.env.QR_HMAC_SECRET ?? 'dev-qr',
        { algorithm: 'HS256' },
      );
      pass = await this.prisma.pass.update({
        where: { id: tmp.id },
        data: { qrToken },
      });
    }

    const amount = card.autoStampAmount ?? 1;
    const required = card.stampsRequired ?? 10;
    const newCount = pass.stampsCount + amount;
    const completed = newCount >= required;

    await this.prisma.$transaction([
      this.prisma.stamp.create({
        data: {
          tenantId,
          passId: pass.id,
          customerId,
          orderId,
          action: 'STAMP',
          amount: new Prisma.Decimal(amount),
          note: 'Auto por pedido confirmado',
        },
      }),
      this.prisma.pass.update({
        where: { id: pass.id },
        data: {
          stampsCount: newCount,
          lastActivityAt: new Date(),
          status: completed ? 'COMPLETED' : pass.status,
        },
      }),
    ]);

    if (completed) {
      this.automations.emit('PASS_COMPLETED', {
        tenantId,
        passId: pass.id,
        customerId,
        cardId: card.id,
      }).catch(() => null);
    }
  }
}
