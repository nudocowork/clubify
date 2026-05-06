import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ChannelType, MessageDirection, Order, Tenant, Customer } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuthUser } from '../common/decorators/current-user.decorator';

/**
 * Adapter de canales. En MVP soporta:
 *  - WhatsApp Link (wa.me): genera links, no envía nada al servidor
 *  - WhatsApp Cloud API: stub, requiere config
 *  - SMS Twilio: stub
 */
@Injectable()
export class ChannelsService {
  private logger = new Logger(ChannelsService.name);

  constructor(private prisma: PrismaService) {}

  /** Genera un link wa.me para que el cliente abra WhatsApp con un mensaje pre-llenado al dueño/caja. */
  generateWaMeOwner(tenant: Tenant, order: Order, customer: Customer): string {
    // Prioriza el número específico de pedidos (Pro feature). Fallback al
    // whatsappPhone genérico, luego al phone del tenant.
    const phone = (
      tenant.whatsappOrdersPhone ??
      tenant.whatsappPhone ??
      tenant.phone ??
      ''
    ).replace(/\D/g, '');
    if (!phone) return '';

    const items = (order.items as any[])
      .map(
        (i) =>
          `• ${i.qty}x ${i.name} — ${formatMoney(i.lineTotal, tenant.currency)}` +
          (i.note ? `\n   ↳ ${i.note}` : ''),
      )
      .join('\n');

    const fulfillment = {
      PICKUP: '🥡 Para llevar',
      DINE_IN: `🍽 Mesa ${order.tableNumber ?? ''}`.trim(),
      DELIVERY: '🛵 Domicilio',
    }[order.fulfillment];

    // Bloque de dirección para delivery — el cliente lo completó en el
    // checkout y queda guardado en order.deliveryAddress (Json).
    const addr = order.deliveryAddress as
      | {
          firstName?: string;
          lastName?: string;
          phone?: string;
          departamento?: string;
          municipio?: string;
          direccion?: string;
        }
      | null;
    const addressBlock =
      order.fulfillment === 'DELIVERY' && addr
        ? [
            '',
            '*📦 Dirección de envío:*',
            addr.firstName || addr.lastName
              ? `${[addr.firstName, addr.lastName].filter(Boolean).join(' ')}`
              : '',
            addr.phone ? `📞 ${addr.phone}` : '',
            [addr.municipio, addr.departamento].filter(Boolean).join(', '),
            addr.direccion ? `📍 ${addr.direccion}` : '',
          ].filter(Boolean)
        : [];

    const lines = [
      `🆕 *Pedido #${order.code}*`,
      `${customer.fullName} · ${customer.phone}`,
      '',
      items,
      '',
      `Subtotal: ${formatMoney(Number(order.subtotal), tenant.currency)}`,
      Number(order.discount) > 0
        ? `Descuento: -${formatMoney(Number(order.discount), tenant.currency)}`
        : '',
      `*Total: ${formatMoney(Number(order.total), tenant.currency)}*`,
      '',
      fulfillment,
      ...addressBlock,
      order.customerNote ? `📝 ${order.customerNote}` : '',
      '',
      `Ver pedido: ${process.env.APP_URL ?? 'http://localhost:3000'}/o/${order.code}`,
    ].filter(Boolean);

    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${phone}?text=${text}`;
  }

  /**
   * Genera un wa.me al courier (whatsappDeliveryPhone) con el resumen del
   * pedido + dirección. Se usa cuando el negocio acepta el pago de un
   * pedido DELIVERY y necesita despachar al motociclista.
   * Devuelve string vacío si no hay número de courier configurado.
   */
  generateWaMeCourier(tenant: Tenant, order: Order, customer: Customer): string {
    const phone = (tenant.whatsappDeliveryPhone ?? '').replace(/\D/g, '');
    if (!phone) return '';

    const items = (order.items as any[])
      .map(
        (i) =>
          `• ${i.qty}x ${i.name}` +
          (i.note ? `\n   ↳ ${i.note}` : ''),
      )
      .join('\n');

    const addr = order.deliveryAddress as
      | {
          firstName?: string;
          lastName?: string;
          phone?: string;
          departamento?: string;
          municipio?: string;
          direccion?: string;
        }
      | null;

    const lines = [
      `🛵 *Despacho domicilio · Pedido #${order.code}*`,
      `Cliente: ${customer.fullName} · ${customer.phone}`,
      '',
      items,
      '',
      `*Total: ${formatMoney(Number(order.total), tenant.currency)}*`,
      `Pago: ${order.paymentStatus === 'PAID' ? '✅ Cobrado' : '💵 Cobrar al cliente'}`,
      '',
      '*📍 Dirección:*',
      addr
        ? [addr.municipio, addr.departamento].filter(Boolean).join(', ')
        : '',
      addr?.direccion ? addr.direccion : '',
      addr?.phone ? `📞 ${addr.phone}` : '',
      '',
      `Origen: ${tenant.brandName}`,
    ].filter(Boolean);

    const text = encodeURIComponent(lines.join('\n'));
    return `https://wa.me/${phone}?text=${text}`;
  }

  /** Genera link para que el dueño abra WA con mensaje listo para enviar al cliente. */
  generateWaMeCustomer(tenant: Tenant, customer: Customer, body: string): string {
    const phone = (customer.phone ?? '').replace(/\D/g, '');
    if (!phone) return '';
    const text = encodeURIComponent(body);
    return `https://wa.me/${phone}?text=${text}`;
  }

  /**
   * Encola un mensaje para enviar. En MVP solo loguea + persiste como QUEUED.
   * Cuando se conecte Meta Cloud / Twilio, este método los enviará realmente.
   */
  async enqueueMessage(opts: {
    tenantId: string;
    customerId?: string;
    channel: ChannelType;
    body: string;
    ruleId?: string;
    templateId?: string;
    metadata?: any;
  }) {
    return this.prisma.message.create({
      data: {
        tenantId: opts.tenantId,
        customerId: opts.customerId,
        channel: opts.channel,
        direction: MessageDirection.OUT,
        body: opts.body,
        ruleId: opts.ruleId,
        templateId: opts.templateId,
        status: 'QUEUED',
        metadata: opts.metadata ?? {},
      },
    });
  }

  // ============ Configs ============

  private tid(user: AuthUser, override?: string) {
    if (user.role === 'SUPER_ADMIN') {
      if (!override) throw new ForbiddenException('tenantId required');
      return override;
    }
    if (!user.tenantId) throw new ForbiddenException();
    return user.tenantId;
  }

  listConfigs(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.channelConfig.findMany({
      where: { tenantId: tid },
      orderBy: { createdAt: 'asc' },
    });
  }

  upsertConfig(
    user: AuthUser,
    body: { type: ChannelType; config: any; isActive?: boolean; isDefault?: boolean },
    override?: string,
  ) {
    const tid = this.tid(user, override);
    return this.prisma.channelConfig.create({
      data: {
        tenantId: tid,
        type: body.type,
        config: body.config,
        isActive: body.isActive ?? true,
        isDefault: body.isDefault ?? false,
      },
    });
  }

  // ============ Mensajes ============

  listMessages(user: AuthUser, override?: string) {
    const tid = this.tid(user, override);
    return this.prisma.message.findMany({
      where: { tenantId: tid },
      include: { customer: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}

function formatMoney(n: number, currency: string) {
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}
